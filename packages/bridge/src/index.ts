import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { WsServer } from './ws-server'
import { createMcpServer } from './mcp-server'

// stdout is the MCP JSON-RPC channel. ALL human-facing logging goes to stderr.
const port = Number(process.env.MONKEYSEE_WS_PORT ?? '8787')

async function main(): Promise<void> {
  const ws = new WsServer(port)
  const server = createMcpServer(ws)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[monkeysee] MCP server connected over stdio')

  const shutdown = () => {
    console.error('[monkeysee] shutting down')
    ws.close()
    void server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => {
  console.error('[monkeysee] fatal', err)
  process.exit(1)
})
