import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { PageState, RpcMethod } from '@monkeysee/protocol'
import {
  GetStateParams,
  ClickParams,
  TypeParams,
  SelectOptionParams,
  HoverParams,
  FocusParams,
  ClickAtParams,
  ScrollParams,
  ScrollToParams,
  DragParams,
  PressParams,
  TypeTextParams,
  OpenTabParams,
  NavigateParams,
  ExtractTextParams,
  WaitForLoadParams,
  GoBackParams,
  GoForwardParams,
  DoneParams,
} from '@monkeysee/protocol'
import { RpcCallError, type WsServer } from './ws-server'

function textResult(data: unknown): CallToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  return { content: [{ type: 'text', text }] }
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function describeError(e: unknown): string {
  if (e instanceof RpcCallError) {
    let msg = `[${e.rpc.code}] ${e.rpc.message}`
    if (e.rpc.code === 'stale_handle') {
      msg += ' — the page changed. Call get_state to re-read it, then retry with a fresh index.'
    }
    return msg
  }
  return e instanceof Error ? e.message : String(e)
}

/** Forward params straight to the extension over RPC and return the JSON result. */
async function forward(
  ws: WsServer,
  method: RpcMethod,
  params: unknown,
  opts?: { timeoutMs?: number },
): Promise<CallToolResult> {
  try {
    const result = await ws.call(method, params, opts)
    return textResult(result)
  } catch (e) {
    return errorResult(describeError(e))
  }
}

const OBSERVE = 'Observation'
const SEMANTIC = 'Semantic action (operates on an index from get_state)'
const SPATIAL = 'Spatial/raw action (CSS px, viewport-relative)'
const NAV = 'Navigation / lifecycle'

export function registerTools(server: McpServer, ws: WsServer): void {
  // ---- Observation ----
  server.registerTool(
    'get_state',
    {
      description: `${OBSERVE}: read the current page as an indexed list of visible elements with roles, names, and bounding boxes. This is your primary "look at the page". Returns a PageState.`,
      inputSchema: GetStateParams.shape,
    },
    async args => forward(ws, 'get_state', args),
  )

  server.registerTool(
    'extract_text',
    {
      description: `${OBSERVE}: read the human-readable text of the page (or the subtree at the given element index). Use this when the task ends in reading content.`,
      inputSchema: ExtractTextParams.shape,
    },
    async args => forward(ws, 'extract_text', args),
  )

  // ---- Semantic actions ----
  server.registerTool(
    'click',
    {
      description: `${SEMANTIC}: click the element at \`index\`.`,
      inputSchema: ClickParams.shape,
    },
    async args => forward(ws, 'click', args),
  )

  server.registerTool(
    'type',
    {
      description: `${SEMANTIC}: focus the input/textarea/contenteditable at \`index\` and set its value to \`text\`.`,
      inputSchema: TypeParams.shape,
    },
    async args => forward(ws, 'type', args),
  )

  server.registerTool(
    'select_option',
    {
      description: `${SEMANTIC}: choose \`value\` in the <select> at \`index\`.`,
      inputSchema: SelectOptionParams.shape,
    },
    async args => forward(ws, 'select_option', args),
  )

  server.registerTool(
    'hover',
    {
      description: `${SEMANTIC}: hover the element at \`index\`.`,
      inputSchema: HoverParams.shape,
    },
    async args => forward(ws, 'hover', args),
  )

  server.registerTool(
    'focus',
    {
      description: `${SEMANTIC}: focus the element at \`index\`.`,
      inputSchema: FocusParams.shape,
    },
    async args => forward(ws, 'focus', args),
  )

  // ---- Spatial / raw actions ----
  server.registerTool(
    'click_at',
    {
      description: `${SPATIAL}: click at viewport coordinates (x, y).`,
      inputSchema: ClickAtParams.shape,
    },
    async args => forward(ws, 'click_at', args),
  )

  server.registerTool(
    'scroll',
    {
      description: `${SPATIAL}: scroll the page in a direction by an optional amount (default ~ one viewport).`,
      inputSchema: ScrollParams.shape,
    },
    async args => forward(ws, 'scroll', args),
  )

  server.registerTool(
    'scroll_to',
    {
      description: `${SPATIAL}: scroll the element at \`index\` into view.`,
      inputSchema: ScrollToParams.shape,
    },
    async args => forward(ws, 'scroll_to', args),
  )

  server.registerTool(
    'drag',
    {
      description: `${SPATIAL}: drag from (x1, y1) to (x2, y2).`,
      inputSchema: DragParams.shape,
    },
    async args => forward(ws, 'drag', args),
  )

  server.registerTool(
    'press',
    {
      description: `${SPATIAL}: press a key (e.g. 'Enter', 'Tab', 'Escape') on the focused element, with optional modifiers.`,
      inputSchema: PressParams.shape,
    },
    async args => forward(ws, 'press', args),
  )

  server.registerTool(
    'type_text',
    {
      description: `${SPATIAL}: type text into the currently focused element, character by character.`,
      inputSchema: TypeTextParams.shape,
    },
    async args => forward(ws, 'type_text', args),
  )

  // ---- Navigation / lifecycle ----
  server.registerTool(
    'open_tab',
    {
      description: `${NAV}: open a new tab at \`url\` and make it the controlled tab.`,
      inputSchema: OpenTabParams.shape,
    },
    async args => forward(ws, 'open_tab', args),
  )

  server.registerTool(
    'navigate',
    {
      description: `${NAV}: navigate the controlled tab to \`url\`.`,
      inputSchema: NavigateParams.shape,
    },
    async args => forward(ws, 'navigate', args),
  )

  server.registerTool(
    'go_back',
    {
      description: `${NAV}: navigate the controlled tab back in history.`,
      inputSchema: GoBackParams.shape,
    },
    async args => forward(ws, 'go_back', args),
  )

  server.registerTool(
    'go_forward',
    {
      description: `${NAV}: navigate the controlled tab forward in history.`,
      inputSchema: GoForwardParams.shape,
    },
    async args => forward(ws, 'go_forward', args),
  )

  server.registerTool(
    'wait_for_load',
    {
      description: `${NAV}: wait until the controlled tab has finished navigating and the DOM has settled, or timeoutMs elapses (default 10s).`,
      inputSchema: WaitForLoadParams.shape,
    },
    async args => {
      const timeoutMs = args.timeoutMs ?? 10_000
      // Give the RPC a little headroom past its own internal timeout.
      return forward(ws, 'wait_for_load', args, { timeoutMs: timeoutMs + 5_000 })
    },
  )

  // ---- Control: done is handled locally by the bridge ----
  server.registerTool(
    'done',
    {
      description:
        'Control: declare the task complete with your `answer`. The bridge grounds it by attaching the current tab URL and a short page snippet.',
      inputSchema: DoneParams.shape,
    },
    async args => {
      let url = ''
      let snippet = ''
      try {
        const state = (await ws.call('get_state', { limit: 1 })) as PageState
        url = state.url
      } catch {
        // best-effort grounding
      }
      try {
        const text = (await ws.call('extract_text', {})) as { text?: string }
        snippet = (text.text ?? '').trim().slice(0, 500)
      } catch {
        // best-effort grounding
      }
      return textResult({ answer: args.answer, url, snippet })
    },
  )
}
