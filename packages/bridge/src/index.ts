import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { WsServer } from './ws-server'
import { createMcpServer } from './mcp-server'
import { runInit } from './init'
import { runDoctor } from './doctor'

// stdout is the MCP JSON-RPC channel. ALL human-facing logging goes to stderr.
const port = Number(process.env.MONKEYSEE_WS_PORT ?? '8787')

async function main(): Promise<void> {
  const ws = new WsServer(port)
  const server = createMcpServer(ws)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[monkeysee] MCP server connected over stdio')

  // The unpacked extension is bundled next to this bin (dist/extension). Point the
  // user at it so they can chrome://extensions -> Load unpacked. stderr only.
  const extPath = fileURLToPath(new URL('./extension', import.meta.url))
  if (existsSync(extPath)) {
    console.error(`[monkeysee] extension: ${extPath}`)
    console.error('[monkeysee] load it via chrome://extensions -> Load unpacked')
  }

  const shutdown = () => {
    console.error('[monkeysee] shutting down')
    ws.close()
    void server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
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
