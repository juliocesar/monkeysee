import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { PageState, RpcMethod } from 'monkeysee-protocol'
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
  ListTabsParams,
  SwitchTabParams,
  CloseTabParams,
  NavigateParams,
  ExtractTextParams,
  WaitForLoadParams,
  GoBackParams,
  GoForwardParams,
  ScreenshotParams,
  DoneParams,
} from 'monkeysee-protocol'
import { RpcCallError, type WsServer } from './ws-server'

function textResult(data: unknown): CallToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  return { content: [{ type: 'text', text }] }
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function imageResult(base64: string): CallToolResult {
  return { content: [{ type: 'image', data: base64, mimeType: 'image/png' }] }
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

/**
 * Pull an optional `tabId` target out of tool args; the rest are the RPC params. `tabId`
 * rides on the RpcRequest envelope (the extension routes by it), not inside `params`.
 */
function splitTab(args: unknown): { tabId: number | undefined; params: Record<string, unknown> } {
  const { tabId, ...params } = (args ?? {}) as Record<string, unknown>
  return { tabId: typeof tabId === 'number' ? tabId : undefined, params }
}

/** Forward tool args straight to the extension over RPC and return the JSON result. */
async function forward(
  ws: WsServer,
  method: RpcMethod,
  args: unknown,
  opts?: { timeoutMs?: number },
): Promise<CallToolResult> {
  try {
    const { tabId, params } = splitTab(args)
    const result = await ws.call(method, params, { ...opts, tabId })
    return textResult(result)
  } catch (e) {
    return errorResult(describeError(e))
  }
}

const OBSERVE = 'Observation'
const SEMANTIC = 'Semantic action (operates on an index from get_state)'
const SPATIAL = 'Spatial/raw action (CSS px, viewport-relative)'
const NAV = 'Navigation / lifecycle'
const TABS = 'Tab management (multi-tab control)'

export function registerTools(server: McpServer, ws: WsServer): void {
  // ---- Observation ----
  server.registerTool(
    'get_state',
    {
      description: `${OBSERVE}: read the current page as an indexed list of visible elements with roles, names, and bounding boxes. This is your primary "look at the page". Returns a PageState. Pass withScreenshot:true to also get a viewport image with numbered marks at each element.`,
      inputSchema: GetStateParams.shape,
    },
    async args => {
      try {
        const { tabId, params } = splitTab(args)
        const state = (await ws.call('get_state', params, { tabId })) as PageState & {
          screenshot?: string
        }
        const { screenshot, ...rest } = state
        const content: CallToolResult['content'] = [
          { type: 'text', text: JSON.stringify(rest, null, 2) },
        ]
        if (screenshot) content.push({ type: 'image', data: screenshot, mimeType: 'image/png' })
        return { content }
      } catch (e) {
        return errorResult(describeError(e))
      }
    },
  )

  server.registerTool(
    'screenshot',
    {
      description: `${OBSERVE}: capture the controlled tab's visible viewport as a PNG image. Use when the indexed element list is not enough and you need to see the page.`,
      inputSchema: ScreenshotParams.shape,
    },
    async args => {
      try {
        const { tabId } = splitTab(args)
        const r = (await ws.call('screenshot', {}, { tabId })) as { imageBase64: string }
        return imageResult(r.imageBase64)
      } catch (e) {
        return errorResult(describeError(e))
      }
    },
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

  // ---- Tab management (multi-tab control) ----
  // Every observation/action/navigation tool also accepts an optional `tabId` to target a
  // specific tab from list_tabs without changing which tab is controlled.
  server.registerTool(
    'list_tabs',
    {
      description: `${TABS}: list all open tabs as { tabId, url, title, active, controlled }, plus the current controlledTabId. Use this to discover tabs to switch to or target via a tool's optional \`tabId\`.`,
      inputSchema: ListTabsParams.shape,
    },
    async () => forward(ws, 'list_tabs', {}),
  )

  server.registerTool(
    'switch_tab',
    {
      description: `${TABS}: make \`tabId\` the controlled tab (where default-target actions go) and bring it to the front.`,
      inputSchema: SwitchTabParams.shape,
    },
    async args => forward(ws, 'switch_tab', args),
  )

  server.registerTool(
    'close_tab',
    {
      description: `${TABS}: close the tab with \`tabId\`. If it was the controlled tab, control falls back to the active tab on the next action.`,
      inputSchema: CloseTabParams.shape,
    },
    async args => forward(ws, 'close_tab', args),
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
