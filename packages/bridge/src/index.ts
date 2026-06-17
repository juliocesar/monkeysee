import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { RpcCallError, WsServer } from './ws-server'
import { Session, type RpcBackend } from './session'
import { ControlClient } from './control-client'
import { startControlServer } from './control-server'
import { createMcpServer } from './mcp-server'
import { runInit } from './init'
import { runDoctor } from './doctor'

// stdout is the MCP JSON-RPC channel. ALL human-facing logging goes to stderr.
const EXT_PORT = Number(process.env.MONKEYSEE_WS_PORT ?? '8787')
const CTRL_PORT = Number(process.env.MONKEYSEE_CONTROL_PORT ?? '8788')
const SESSION_ID = randomUUID().slice(0, 8)

/** Backend used before election settles — calls fail fast with a clear, retryable error. */
const electingBackend: RpcBackend = {
  call: () =>
    Promise.reject(
      new RpcCallError({ code: 'internal', message: 'bridge electing leader, retry shortly' }),
    ),
}

function isAddrInUse(e: unknown): boolean {
  return (e as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE'
}

/** Small randomized delay to avoid a thundering-herd when followers re-elect together. */
function delay(): Promise<void> {
  const ms = 50 + Math.floor(Math.random() * 200)
  return new Promise(resolve => setTimeout(resolve, ms))
}

// The live leader resources (if this process is the leader) so shutdown can release both.
let leaderWs: WsServer | null = null
let leaderControl: { close(): void } | null = null
let follower: ControlClient | null = null

function dropLeaderResources(): void {
  leaderControl?.close()
  leaderControl = null
  leaderWs?.close()
  leaderWs = null
}

async function main(): Promise<void> {
  const session = new Session(electingBackend)
  const server = createMcpServer(session)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[monkeysee] MCP server connected over stdio (session ${SESSION_ID})`)

  // The unpacked extension is bundled next to this bin (dist/extension). Point the
  // user at it so they can chrome://extensions -> Load unpacked. stderr only.
  const extPath = fileURLToPath(new URL('./extension', import.meta.url))
  if (existsSync(extPath)) {
    console.error(`[monkeysee] extension: ${extPath}`)
    console.error('[monkeysee] load it via chrome://extensions -> Load unpacked')
  }

  const shutdown = () => {
    console.error('[monkeysee] shutting down')
    follower?.close()
    dropLeaderResources()
    void server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await electAndServe(session)
}

/**
 * Win the extension port (8787) → become LEADER (own the extension link + control relay).
 * Lose it → become FOLLOWER (proxy RPCs to the leader over 8788). The MCP server starts
 * once and never restarts; only the session's backend swaps on a role change, so the same
 * Claude Code keeps its tools live and its `currentTabId` intact across a leader handoff.
 */
async function electAndServe(session: Session): Promise<void> {
  const ws = new WsServer(EXT_PORT)
  try {
    await ws.listen()
  } catch (e) {
    if (isAddrInUse(e)) return becomeFollower(session)
    throw e
  }

  // LEADER: own the extension link and the follower relay.
  let control: { close(): void }
  try {
    control = await startControlServer(ws, CTRL_PORT)
  } catch (e) {
    // 8787 won but 8788 is held by a stale leader: never run two leaders. Release the
    // extension port and retry election after a jittered delay.
    if (isAddrInUse(e)) {
      ws.close()
      await delay()
      return electAndServe(session)
    }
    throw e
  }

  follower?.close()
  follower = null
  leaderWs = ws
  leaderControl = control
  session.setBackend(ws)
  console.error(`[monkeysee] role=leader (session ${SESSION_ID})`)
}

async function becomeFollower(session: Session): Promise<void> {
  dropLeaderResources()
  const client = new ControlClient(`ws://127.0.0.1:${CTRL_PORT}`, {
    onClose: () => {
      // The leader vanished — re-run election. The winner binds 8787; losers reconnect.
      void electAndServe(session)
    },
  })
  try {
    await client.connect()
  } catch {
    // Leader vanished mid-startup (control port closed before we connected). Re-elect.
    await delay()
    return electAndServe(session)
  }
  follower = client
  session.setBackend(client)
  console.error(`[monkeysee] role=follower (session ${SESSION_ID})`)
}

// Subcommands wire the server into a client (`init`) or check the live link (`doctor`),
// then exit. Any other invocation (incl. no args, how MCP clients launch us) runs the
// server over stdio.
const subcommand = process.argv[2]
if (subcommand === 'init') {
  runInit(process.argv.slice(3))
} else if (subcommand === 'doctor') {
  runDoctor().catch(err => {
    console.error('[monkeysee] doctor failed', err)
    process.exit(1)
  })
} else {
  main().catch(err => {
    console.error('[monkeysee] fatal', err)
    process.exit(1)
  })
}
