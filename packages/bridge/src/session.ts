import type { RpcMethod } from 'monkeysee-protocol'

/**
 * Backend that actually delivers an RPC to the extension. Throws RpcCallError on failure.
 * The leader's backend is the `WsServer` itself; a follower's is a `ControlClient`.
 */
export interface RpcBackend {
  call(
    method: RpcMethod,
    params: unknown,
    opts: { tabId?: number; timeoutMs?: number },
  ): Promise<unknown>
}

// Methods whose default target is "my current tab" when no explicit tabId is given.
const DEFAULTS_TO_CURRENT_TAB = new Set<RpcMethod>([
  'navigate',
  'go_back',
  'go_forward',
  'wait_for_load',
  'screenshot',
  'get_state',
  'get_forms',
  'extract_text',
  'click',
  'type',
  'select_option',
  'fill_progressive',
  'hover',
  'focus',
  'click_at',
  'scroll',
  'scroll_to',
  'drag',
  'press',
  'type_text',
])
// switch_tab / close_tab / open_tab / list_tabs carry their own targeting; never inject.

/**
 * Per-session executor the MCP tools call through. Holds this session's `currentTabId`,
 * injects it into default-target requests that omit `tabId`, learns it from responses, and
 * rewrites `list_tabs` so it reflects *this* session's controlled tab. The backend may be
 * swapped (leader <-> follower handoff) without losing `currentTabId`.
 */
export class Session {
  currentTabId: number | null = null

  constructor(private backend: RpcBackend) {}

  /** Swap the underlying transport (leader<->follower handoff) while keeping currentTabId. */
  setBackend(b: RpcBackend): void {
    this.backend = b
  }

  async call(
    method: RpcMethod,
    params: unknown,
    opts: { tabId?: number; timeoutMs?: number } = {},
  ): Promise<unknown> {
    const explicit = typeof opts.tabId === 'number'
    const tabId = explicit
      ? opts.tabId
      : DEFAULTS_TO_CURRENT_TAB.has(method) && this.currentTabId !== null
        ? this.currentTabId
        : undefined

    const result = await this.backend.call(method, params, { tabId, timeoutMs: opts.timeoutMs })
    this.learnTab(method, explicit, opts.tabId, result)
    return method === 'list_tabs' ? this.rewriteListTabs(result) : result
  }

  private learnTab(
    method: RpcMethod,
    explicit: boolean,
    explicitTabId: number | undefined,
    result: unknown,
  ): void {
    // switch_tab is the explicit "make this my tab" verb → always adopt.
    if (method === 'switch_tab' && typeof explicitTabId === 'number') {
      this.currentTabId = explicitTabId
      return
    }
    if (method === 'close_tab' && explicitTabId === this.currentTabId) {
      this.currentTabId = null
      return
    }
    // For default-target calls (no explicit tabId), adopt the tab the extension resolved to.
    // open_tab/navigate/go_back/go_forward return { tabId }; get_state returns a PageState
    // whose .tabId is the resolved tab. Targeted (explicit) calls must NOT change the default.
    if (explicit) return
    const t = (result as { tabId?: unknown } | null)?.tabId
    if (typeof t === 'number') this.currentTabId = t
  }

  /**
   * `list_tabs` is global (the extension global is meaningless across sessions), so rewrite
   * its `controlledTabId` + per-tab `controlled` flag to reflect *this* session's tab.
   */
  private rewriteListTabs(result: unknown): unknown {
    if (!result || typeof result !== 'object') return result
    const r = result as { controlledTabId?: unknown; tabs?: unknown }
    if (!Array.isArray(r.tabs)) return result
    const tabs = r.tabs.map(t => {
      if (t && typeof t === 'object' && 'tabId' in t) {
        const tab = t as { tabId: unknown }
        return { ...tab, controlled: tab.tabId === this.currentTabId }
      }
      return t
    })
    return { ...r, controlledTabId: this.currentTabId, tabs }
  }
}
