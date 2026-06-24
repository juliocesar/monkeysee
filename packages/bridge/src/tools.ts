import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { PageState, RpcMethod } from 'monkeysee-protocol'
import type { FormsState } from 'monkeysee-protocol'
import {
  GetStateParams,
  GetFormsParams,
  FillFieldsParams,
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
import { RpcCallError } from './ws-server'
import type { Session } from './session'

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
  session: Session,
  method: RpcMethod,
  args: unknown,
  opts?: { timeoutMs?: number },
): Promise<CallToolResult> {
  try {
    const { tabId, params } = splitTab(args)
    const result = await session.call(method, params, { ...opts, tabId })
    return textResult(result)
  } catch (e) {
    return errorResult(describeError(e))
  }
}

/**
 * Map every actionable index in a FormsState to its current `checked` state — both the
 * fields themselves (checkbox / switch / custom) and each radio-group option (which carries
 * its own clickable index). Used by `fill_fields` to make `checked` idempotent.
 */
function currentCheckedByIndex(forms: FormsState): Map<number, boolean> {
  const map = new Map<number, boolean>()
  const visit = (f: FormsState['forms'][number]['fields'][number]): void => {
    if (typeof f.checked === 'boolean') map.set(f.index, f.checked)
    for (const o of f.options ?? []) {
      if (typeof o.index === 'number') map.set(o.index, o.selected)
    }
  }
  for (const group of forms.forms) for (const f of group.fields) visit(f)
  for (const f of forms.orphans) visit(f)
  return map
}

/**
 * Generous upper bound for how long a progressive fill can take in the content script, so the
 * RPC call doesn't time out mid-animation. Scales with typed characters and field count per
 * pace, with headroom on top of the bridge's normal 30s default.
 */
function progressiveTimeoutMs(
  fields: Array<{ value?: string }>,
  pace: 'fast' | 'normal' | 'slow',
): number {
  const perChar = pace === 'slow' ? 60 : pace === 'normal' ? 32 : 16
  const perField = pace === 'slow' ? 1_500 : pace === 'normal' ? 1_000 : 700
  const chars = fields.reduce((n, f) => n + (typeof f.value === 'string' ? f.value.length : 0), 0)
  return Math.max(30_000, 15_000 + chars * perChar + fields.length * perField)
}

const OBSERVE = 'Observation'
const SEMANTIC = 'Semantic action (operates on an index from get_state)'
const SPATIAL = 'Spatial/raw action (CSS px, viewport-relative)'
const NAV = 'Navigation / lifecycle'
const TABS = 'Tab management (multi-tab control)'

export function registerTools(server: McpServer, session: Session): void {
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
        const state = (await session.call('get_state', params, { tabId })) as PageState & {
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
        const r = (await session.call('screenshot', {}, { tabId })) as { imageBase64: string }
        return imageResult(r.imageBase64)
      } catch (e) {
        return errorResult(describeError(e))
      }
    },
  )

  server.registerTool(
    'get_forms',
    {
      description: `${OBSERVE}: read only the page's forms as a compact, grouped list of fields — kind, type, label, name, autocomplete, current value, checked state, select/radio options, and required/disabled flags. Covers native controls plus ARIA-role widgets and open shadow DOM. Each field's \`index\` is directly usable with type/click/select_option/focus; honor its \`interaction\`/\`requiresTrustedInput\` hints. Use this instead of get_state when the task is filling or reading a form — it is far cheaper and carries form-specific signal get_state omits.`,
      inputSchema: GetFormsParams.shape,
    },
    async args => forward(session, 'get_forms', args),
  )

  server.registerTool(
    'extract_text',
    {
      description: `${OBSERVE}: read the human-readable text of the page (or the subtree at the given element index). Use this when the task ends in reading content.`,
      inputSchema: ExtractTextParams.shape,
    },
    async args => forward(session, 'extract_text', args),
  )

  // ---- Semantic actions ----
  server.registerTool(
    'click',
    {
      description: `${SEMANTIC}: click the element at \`index\`.`,
      inputSchema: ClickParams.shape,
    },
    async args => forward(session, 'click', args),
  )

  server.registerTool(
    'type',
    {
      description: `${SEMANTIC}: focus the input/textarea/contenteditable at \`index\` and set its value to \`text\`.`,
      inputSchema: TypeParams.shape,
    },
    async args => forward(session, 'type', args),
  )

  server.registerTool(
    'select_option',
    {
      description: `${SEMANTIC}: choose \`value\` in the <select> at \`index\`.`,
      inputSchema: SelectOptionParams.shape,
    },
    async args => forward(session, 'select_option', args),
  )

  server.registerTool(
    'fill_fields',
    {
      description: `${SEMANTIC}: fill multiple form fields in one call (the batch counterpart to get_forms). Pass an array of { index, value? | option? | checked? } using indices from get_forms: \`value\` types into a text/contenteditable field, \`option\` chooses a <select>/dropdown value, \`checked\` sets a checkbox/radio (idempotent — applied only if its current state differs). One failed field does not abort the rest; the result is a per-field { index, ok, error? } array.
\`mode\` defaults to **progressive**: a human-watchable fill that smooth-scrolls each field into view, typewriters text, and opens dropdowns to click the option — use it by default, and especially when the run is being watched or recorded. Pass \`mode: 'batch'\` for an instant, no-animation fill when speed matters or the run is unattended/programmatic. \`pace\` ('fast' | 'normal' | 'slow', default 'fast') tunes the progressive animation and is ignored in batch mode.`,
      inputSchema: FillFieldsParams.shape,
    },
    async args => {
      const { tabId, params } = splitTab(args)
      const fields = params.fields as Array<{
        index: number
        value?: string
        checked?: boolean
        option?: string
      }>
      const mode = (params.mode as 'batch' | 'progressive' | undefined) ?? 'progressive'
      const pace = (params.pace as 'fast' | 'normal' | 'slow' | undefined) ?? 'fast'

      // Progressive: the content script runs the whole choreographed fill in one RPC, so it
      // may take several seconds — extend the call timeout past the 30s default to cover the
      // typing/scrolling/dropdown beats (slower paces and longer text take longer).
      if (mode === 'progressive') {
        try {
          const result = await session.call(
            'fill_progressive',
            { fields, pace },
            { tabId, timeoutMs: progressiveTimeoutMs(fields, pace) },
          )
          return textResult(result)
        } catch (e) {
          return errorResult(describeError(e))
        }
      }

      // Batch: decompose into individual instant actions. For idempotent `checked`, learn
      // current checked state once up front so we only click controls that need toggling
      // (re-running a fill stays a no-op).
      let checkedNow: Map<number, boolean> | null = null
      if (fields.some(f => typeof f.checked === 'boolean')) {
        try {
          const forms = (await session.call('get_forms', {}, { tabId })) as FormsState
          checkedNow = currentCheckedByIndex(forms)
        } catch {
          // best-effort: without it, a `checked` field falls back to an unconditional click
        }
      }

      const results: Array<{ index: number; ok: boolean; error?: string }> = []
      for (const f of fields) {
        try {
          if (typeof f.option === 'string') {
            await session.call('select_option', { index: f.index, value: f.option }, { tabId })
          } else if (typeof f.checked === 'boolean') {
            const isOn = checkedNow?.get(f.index)
            if (isOn === undefined || isOn !== f.checked) {
              await session.call('click', { index: f.index }, { tabId })
            }
          } else if (typeof f.value === 'string') {
            await session.call('type', { index: f.index, text: f.value }, { tabId })
          } else {
            throw new Error('field has none of value/option/checked')
          }
          results.push({ index: f.index, ok: true })
        } catch (e) {
          results.push({ index: f.index, ok: false, error: describeError(e) })
        }
      }
      return textResult({ results })
    },
  )

  server.registerTool(
    'hover',
    {
      description: `${SEMANTIC}: hover the element at \`index\`.`,
      inputSchema: HoverParams.shape,
    },
    async args => forward(session, 'hover', args),
  )

  server.registerTool(
    'focus',
    {
      description: `${SEMANTIC}: focus the element at \`index\`.`,
      inputSchema: FocusParams.shape,
    },
    async args => forward(session, 'focus', args),
  )

  // ---- Spatial / raw actions ----
  server.registerTool(
    'click_at',
    {
      description: `${SPATIAL}: click at viewport coordinates (x, y).`,
      inputSchema: ClickAtParams.shape,
    },
    async args => forward(session, 'click_at', args),
  )

  server.registerTool(
    'scroll',
    {
      description: `${SPATIAL}: scroll the page in a direction by an optional amount (default ~ one viewport).`,
      inputSchema: ScrollParams.shape,
    },
    async args => forward(session, 'scroll', args),
  )

  server.registerTool(
    'scroll_to',
    {
      description: `${SPATIAL}: scroll the element at \`index\` into view.`,
      inputSchema: ScrollToParams.shape,
    },
    async args => forward(session, 'scroll_to', args),
  )

  server.registerTool(
    'drag',
    {
      description: `${SPATIAL}: drag from (x1, y1) to (x2, y2).`,
      inputSchema: DragParams.shape,
    },
    async args => forward(session, 'drag', args),
  )

  server.registerTool(
    'press',
    {
      description: `${SPATIAL}: press a key (e.g. 'Enter', 'Tab', 'Escape') on the focused element, with optional modifiers.`,
      inputSchema: PressParams.shape,
    },
    async args => forward(session, 'press', args),
  )

  server.registerTool(
    'type_text',
    {
      description: `${SPATIAL}: type text into the currently focused element, character by character.`,
      inputSchema: TypeTextParams.shape,
    },
    async args => forward(session, 'type_text', args),
  )

  // ---- Navigation / lifecycle ----
  server.registerTool(
    'open_tab',
    {
      description: `${NAV}: open a new tab at \`url\` and make it the controlled tab.`,
      inputSchema: OpenTabParams.shape,
    },
    async args => forward(session, 'open_tab', args),
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
    async () => forward(session, 'list_tabs', {}),
  )

  server.registerTool(
    'switch_tab',
    {
      description: `${TABS}: make \`tabId\` the controlled tab (where default-target actions go) and bring it to the front.`,
      inputSchema: SwitchTabParams.shape,
    },
    async args => forward(session, 'switch_tab', args),
  )

  server.registerTool(
    'close_tab',
    {
      description: `${TABS}: close the tab with \`tabId\`. If it was the controlled tab, control falls back to the active tab on the next action.`,
      inputSchema: CloseTabParams.shape,
    },
    async args => forward(session, 'close_tab', args),
  )

  server.registerTool(
    'navigate',
    {
      description: `${NAV}: navigate the controlled tab to \`url\`.`,
      inputSchema: NavigateParams.shape,
    },
    async args => forward(session, 'navigate', args),
  )

  server.registerTool(
    'go_back',
    {
      description: `${NAV}: navigate the controlled tab back in history.`,
      inputSchema: GoBackParams.shape,
    },
    async args => forward(session, 'go_back', args),
  )

  server.registerTool(
    'go_forward',
    {
      description: `${NAV}: navigate the controlled tab forward in history.`,
      inputSchema: GoForwardParams.shape,
    },
    async args => forward(session, 'go_forward', args),
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
      return forward(session, 'wait_for_load', args, { timeoutMs: timeoutMs + 5_000 })
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
        const state = (await session.call('get_state', { limit: 1 })) as PageState
        url = state.url
      } catch {
        // best-effort grounding
      }
      try {
        const text = (await session.call('extract_text', {})) as { text?: string }
        snippet = (text.text ?? '').trim().slice(0, 500)
      } catch {
        // best-effort grounding
      }
      return textResult({ answer: args.answer, url, snippet })
    },
  )
}
