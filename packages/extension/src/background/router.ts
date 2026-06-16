import type { PageState, RpcError, RpcMethod, RpcRequest, RpcResponse } from '@monkeysee/protocol'
import type { ContentMethod, ContentRequest, ContentResponse } from '../shared/messages'
import { isLoading, onceSettled } from './nav'
import * as dbg from './debugger-backend'

class RouterError extends Error {
  constructor(public readonly rpc: RpcError) {
    super(rpc.message)
  }
}

let controlledTabId: number | null = null

const CONTENT_METHODS = new Set<ContentMethod>([
  'get_state',
  'extract_text',
  'click',
  'type',
  'select_option',
  'hover',
  'focus',
  'click_at',
  'scroll',
  'scroll_to',
  'drag',
  'press',
  'type_text',
])

/** Mutating actions subject to the domain allowlist when enforcement is on. */
const GATED_METHODS = new Set<RpcMethod>([
  'click',
  'type',
  'select_option',
  'click_at',
  'drag',
  'press',
  'type_text',
])

/** Actions that the trusted (debugger) backend can perform when enabled. */
const DEBUGGER_METHODS = new Set<RpcMethod>([
  'click',
  'type',
  'type_text',
  'press',
  'click_at',
  'drag',
])

export function getControlledTabId(): number | null {
  return controlledTabId
}

export async function handleRequest(req: RpcRequest): Promise<RpcResponse> {
  try {
    const result = await route(req)
    return { id: req.id, ok: true, result }
  } catch (e) {
    const error: RpcError =
      e instanceof RouterError
        ? e.rpc
        : { code: 'internal', message: e instanceof Error ? e.message : String(e) }
    return { id: req.id, ok: false, error }
  }
}

async function route(req: RpcRequest): Promise<unknown> {
  const params = (req.params ?? {}) as Record<string, unknown>

  switch (req.method) {
    case 'open_tab': {
      const tab = await chrome.tabs.create({ url: params.url as string, active: true })
      if (tab.id !== undefined) controlledTabId = tab.id
      if (tab.windowId !== undefined) await focusWindow(tab.windowId)
      return { tabId: controlledTabId }
    }
    case 'navigate': {
      const tabId = await resolveTab(req)
      await chrome.tabs.update(tabId, { url: params.url as string })
      await bringTabToFront(tabId)
      return { tabId }
    }
    case 'go_back': {
      const tabId = await resolveTab(req)
      await chrome.tabs.goBack(tabId)
      await bringTabToFront(tabId)
      return { tabId }
    }
    case 'go_forward': {
      const tabId = await resolveTab(req)
      await chrome.tabs.goForward(tabId)
      await bringTabToFront(tabId)
      return { tabId }
    }
    case 'wait_for_load': {
      const tabId = await resolveTab(req)
      const timeoutMs = (params.timeoutMs as number | undefined) ?? 10_000
      const start = Date.now()
      const settle = await onceSettled(tabId, timeoutMs)
      if (settle === 'timeout') {
        throw new RouterError({
          code: 'timeout',
          message: `wait_for_load timed out after ${timeoutMs}ms`,
        })
      }
      const remaining = Math.max(1_000, timeoutMs - (Date.now() - start))
      await sendToContent(tabId, 'wait_quiet', { quietMs: 500, timeoutMs: remaining })
      return { ok: true, loading: isLoading(tabId) }
    }
    case 'screenshot':
      throw new RouterError({
        code: 'internal',
        message: 'screenshot is an M2 feature, not yet implemented.',
      })
    default: {
      if (CONTENT_METHODS.has(req.method as ContentMethod)) {
        const tabId = await resolveTab(req)
        await enforceAllowlist(tabId, req.method)
        if (DEBUGGER_METHODS.has(req.method) && (await useDebuggerBackend())) {
          const viaDebugger = await tryDebugger(tabId, req.method, params)
          if (viaDebugger) return viaDebugger.result
          // attach/CDP failure — fall through to the content-script backend
        }
        return forwardToContent(tabId, req.method as ContentMethod, params)
      }
      throw new RouterError({ code: 'internal', message: `Unknown method ${req.method}` })
    }
  }
}

async function resolveTab(req: RpcRequest): Promise<number> {
  const tabId = await pickTab(req)
  // Keep the controlled tab the visible one in its window (cheap, no focus steal).
  void chrome.tabs.update(tabId, { active: true }).catch(() => undefined)
  return tabId
}

async function pickTab(req: RpcRequest): Promise<number> {
  if (typeof req.tabId === 'number') return req.tabId
  if (controlledTabId !== null) {
    // Confirm the tab still exists.
    try {
      await chrome.tabs.get(controlledTabId)
      return controlledTabId
    } catch {
      controlledTabId = null
    }
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (active?.id !== undefined) {
    controlledTabId = active.id
    return active.id
  }
  throw new RouterError({ code: 'not_found', message: 'No controlled or active tab available.' })
}

/** Pull the OS window holding `tabId` to the foreground (best-effort). */
async function focusWindow(windowId: number): Promise<void> {
  try {
    await chrome.windows.update(windowId, { focused: true })
  } catch {
    // best-effort
  }
}

/** Activate the tab and bring its window forward — used on navigation moments. */
async function bringTabToFront(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId)
    await chrome.tabs.update(tabId, { active: true })
    if (tab.windowId !== undefined) await focusWindow(tab.windowId)
  } catch {
    // best-effort
  }
}

/** Forward a DOM method to the content script, aggregating frame partials. */
async function forwardToContent(
  tabId: number,
  method: ContentMethod,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (method === 'get_state') {
    const loading = isLoading(tabId)
    // M0: single frame. M2: query all frames and merge.
    const partial = (await sendToContent(tabId, 'get_state', { ...params, loading })) as PageState
    return aggregate([partial], tabId, loading)
  }
  return sendToContent(tabId, method, params)
}

function aggregate(partials: PageState[], tabId: number, loading: boolean): PageState {
  const base = partials[0]
  if (!base) {
    return {
      tabId,
      url: '',
      title: '',
      viewport: { w: 0, h: 0, scrollX: 0, scrollY: 0, dpr: 1 },
      elements: [],
      loading,
    }
  }
  return { ...base, tabId, loading, elements: partials.flatMap(p => p.elements) }
}

/** Send to content; inject the script and retry once if no receiver is present. */
async function sendToContent(
  tabId: number,
  method: ContentMethod | 'ping' | 'wait_quiet' | 'locate',
  params: unknown,
): Promise<unknown> {
  const msg: ContentRequest = { channel: 'monkeysee', method, params, frameId: 0 }
  try {
    return unwrap(await chrome.tabs.sendMessage<ContentRequest, ContentResponse>(tabId, msg))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (
      !message.includes('Receiving end does not exist') &&
      !message.includes('Could not establish')
    ) {
      throw e
    }
    await injectContent(tabId)
    return unwrap(await chrome.tabs.sendMessage<ContentRequest, ContentResponse>(tabId, msg))
  }
}

function unwrap(res: ContentResponse | undefined): unknown {
  if (!res) throw new RouterError({ code: 'internal', message: 'No response from content script.' })
  if (res.ok) return res.result
  throw new RouterError(res.error)
}

async function injectContent(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
}

// ---- Trusted-input (debugger) backend ----

async function useDebuggerBackend(): Promise<boolean> {
  const { backend } = await chrome.storage.local.get('backend')
  return backend === 'debugger'
}

/** Resolve an index to viewport coordinates via the content script (scrolls into view). */
async function locateForDebugger(tabId: number, index: number): Promise<{ x: number; y: number }> {
  const r = (await sendToContent(tabId, 'locate', { index })) as { x: number; y: number }
  return r
}

/**
 * Run an action through the trusted CDP backend. Returns the result on success, or
 * `null` to signal the caller should fall back to the content backend (attach/CDP
 * failure). A `stale_handle`/`blocked` RouterError propagates instead of falling back.
 */
async function tryDebugger(
  tabId: number,
  method: RpcMethod,
  params: Record<string, unknown>,
): Promise<{ result: unknown } | null> {
  try {
    switch (method) {
      case 'click_at':
        await dbg.clickAt(tabId, params.x as number, params.y as number)
        break
      case 'drag':
        await dbg.drag(
          tabId,
          params.x1 as number,
          params.y1 as number,
          params.x2 as number,
          params.y2 as number,
        )
        break
      case 'press':
        await dbg.pressKey(tabId, params.key as string, (params.modifiers as string[]) ?? [])
        break
      case 'type_text':
        await dbg.insertText(tabId, params.text as string)
        break
      case 'click': {
        const { x, y } = await locateForDebugger(tabId, params.index as number)
        await dbg.clickAt(tabId, x, y)
        break
      }
      case 'type': {
        const { x, y } = await locateForDebugger(tabId, params.index as number)
        await dbg.clickAt(tabId, x, y)
        await dbg.selectAll(tabId)
        await dbg.insertText(tabId, params.text as string)
        break
      }
      default:
        return null
    }
    return { result: { ok: true, backend: 'debugger' } }
  } catch (e) {
    // A genuine element/permission error must reach the agent — don't mask it.
    if (e instanceof RouterError) throw e
    console.warn('[monkeysee] debugger backend failed, falling back to content script', e)
    return null
  }
}

interface AllowlistConfig {
  enforce: boolean
  allowlist: string[]
}

async function enforceAllowlist(tabId: number, method: RpcMethod): Promise<void> {
  if (!GATED_METHODS.has(method)) return
  const { enforce, allowlist } = await getAllowlist()
  if (!enforce) return
  let host = ''
  try {
    const tab = await chrome.tabs.get(tabId)
    host = tab.url ? new URL(tab.url).hostname : ''
  } catch {
    host = ''
  }
  const allowed = allowlist.some(d => host === d || host.endsWith(`.${d}`))
  if (!allowed) {
    throw new RouterError({
      code: 'blocked',
      message: `Action blocked: ${host || 'this page'} is not in the allowlist. Add it in the MonkeySee popup.`,
    })
  }
}

async function getAllowlist(): Promise<AllowlistConfig> {
  const stored = await chrome.storage.local.get(['enforce', 'allowlist'])
  return {
    enforce: Boolean(stored.enforce),
    allowlist: Array.isArray(stored.allowlist) ? (stored.allowlist as string[]) : [],
  }
}
