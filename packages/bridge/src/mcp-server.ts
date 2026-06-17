import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PROTOCOL_VERSION } from 'monkeysee-protocol'
import { registerTools } from './tools'
import type { Session } from './session'

/** Build the MCP server and register the full tool surface against a per-client Session. */
export function createMcpServer(session: Session): McpServer {
  const server = new McpServer({
    name: 'monkeysee-browser',
    version: PROTOCOL_VERSION,
  })
  registerTools(server, session)
  return server
}
