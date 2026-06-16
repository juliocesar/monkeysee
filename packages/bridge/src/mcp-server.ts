import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PROTOCOL_VERSION } from '@monkeysee/protocol'
import { registerTools } from './tools'
import type { WsServer } from './ws-server'

/** Build the MCP server and register the full tool surface. */
export function createMcpServer(ws: WsServer): McpServer {
  const server = new McpServer({
    name: 'monkeysee-browser',
    version: PROTOCOL_VERSION,
  })
  registerTools(server, ws)
  return server
}
