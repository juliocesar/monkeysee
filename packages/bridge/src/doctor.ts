// `monkeysee-bridge doctor` — the diagnostic that earns its keep AFTER the Chrome step.
// It opens the WS port and waits for the extension's `hello`, then reports whether the
// bridge <-> extension link is actually live (the green-dot state). Unlike a check bolted
// onto `init`, this is run once you've loaded the extension and something isn't working.
import { WebSocketServer } from 'ws'
import { PROTOCOL_VERSION, isProtocolCompatible } from 'monkeysee-protocol'

const DEFAULT_WAIT_MS = 8000

export async function runDoctor(): Promise<void> {
  const port = Number(process.env.MONKEYSEE_WS_PORT ?? '8787')
  const waitMs = Number(process.env.MONKEYSEE_DOCTOR_WAIT_MS ?? String(DEFAULT_WAIT_MS))
  const host = '127.0.0.1'
  console.log(`[monkeysee] checking the bridge <-> extension link on ws://${host}:${port} ...`)

  let wss: WebSocketServer
  try {
    wss = await listen(host, port)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      // The port being taken means a bridge is already running — almost certainly the one
      // your MCP client launched. We can't introspect that process, so say so plainly.
      console.log(`[monkeysee] a bridge is already listening on ${host}:${port}.`)
      console.log('  That is expected if your MCP client (Claude Code / Codex) launched one.')
      console.log(
        "  I can't inspect that process from here; check the extension popup for the green dot.",
      )
      return
    }
    console.error(`[monkeysee] could not open ${host}:${port}: ${(err as Error).message}`)
    process.exitCode = 1
    return
  }

  const hello = await waitForHello(wss, waitMs)
  wss.close()

  if (!hello) {
    console.log(`[monkeysee] DOWN: no extension connected within ${Math.round(waitMs / 1000)}s.`)
    console.log('  Fix: open Chrome, go to chrome://extensions, and Load unpacked the MonkeySee')
    console.log(
      '  extension (run `monkeysee-bridge init` to print its path). It reconnects on its own.',
    )
    process.exitCode = 1
    return
  }
  if (!isProtocolCompatible(hello.protocol, PROTOCOL_VERSION)) {
    console.log(
      '[monkeysee] INCOMPATIBLE: the extension connected but its protocol does not match.',
    )
    console.log(`  extension protocol ${hello.protocol} vs bridge protocol ${PROTOCOL_VERSION}.`)
    console.log('  Update whichever side is older, then re-run this check.')
    process.exitCode = 1
    return
  }
  console.log(
    `[monkeysee] OK: extension connected, v${hello.version} (protocol ${hello.protocol}).`,
  )
  console.log('  The bridge <-> extension link is healthy.')
}

function listen(host: string, port: number): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host, port })
    wss.once('listening', () => resolve(wss))
    wss.once('error', reject)
  })
}

interface Hello {
  version: string
  protocol: string
}

function waitForHello(wss: WebSocketServer, timeoutMs: number): Promise<Hello | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    wss.on('connection', ws => {
      ws.on('message', data => {
        let msg: unknown
        try {
          msg = JSON.parse(data.toString())
        } catch {
          return
        }
        if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'hello') {
          const ev = msg as { extensionVersion?: string; protocolVersion?: string }
          clearTimeout(timer)
          resolve({
            version: ev.extensionVersion ?? 'unknown',
            protocol: ev.protocolVersion ?? 'unknown',
          })
        }
      })
    })
  })
}
