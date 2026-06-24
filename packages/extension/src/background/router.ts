import type {
  FormsState,
  PageState,
  RpcError,
  RpcMethod,
  RpcRequest,
  RpcResponse,
} from 'monkeysee-protocol'
import { FRAME_STRIDE } from 'monkeysee-protocol'
import type { ContentMethod, ContentRequest, ContentResponse } from '../shared/messages'
import { isLoading, onceSettled } from './nav'
import * as dbg from './debugger-backend'
import * as shot from './screenshot'

const DEFAULT_STATE_LIMIT = 200
const DEFAULT_FORMS_LIMIT = 150

class RouterError extends Error {
  constructor(public readonly rpc: RpcError) {
    super(rpc.message)
  }
}

// Visual focus hint only: the tab the extension last brought to front (open_tab/switch_tab).
// It is NOT the routing default — the bridge injects each session's own `tabId` per request,
// so this global must never decide routing for a session that omits one (that would let one
// session's tab leak into another's default action). See MULTI_SESSION_PLAN §3.7.
let controlledTabId: number | null = null

const CONTENT_METHODS = new Set<ContentMethod>([
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

/** Mutating actions subject to the domain allowlist when enforcement is on. */
const GATED_METHODS = new Set<RpcMethod>([
  'click',
  'type',
  'select_option',
  'fill_progressive',
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
    case 'screenshot': {
      const tabId = await resolveTab(req)
      return { imageBase64: await shot.capture(tabId) }
    }
    case 'list_tabs': {
      const tabs = await chrome.tabs.query({})
      return {
        controlledTabId,
        tabs: tabs
          .filter(t => typeof t.id === 'number')
          .map(t => ({
            tabId: t.id as number,
            url: t.url ?? '',
            title: t.title ?? '',
            active: t.active === true,
            controlled: t.id === controlledTabId,
          })),
      }
    }
    case 'switch_tab': {
      const tabId = requireTabId(req)
      try {
        await chrome.tabs.get(tabId)
      } catch {
        throw new RouterError({ code: 'not_found', message: `Tab ${tabId} does not exist.` })
      }
      controlledTabId = tabId
      await bringTabToFront(tabId)
      return { tabId }
    }
    case 'close_tab': {
      const tabId = requireTabId(req)
      try {
        await chrome.tabs.remove(tabId)
      } catch {
        throw new RouterError({
          code: 'not_found',
          message: `Tab ${tabId} could not be closed (already gone?).`,
        })
      }
      if (controlledTabId === tabId) controlledTabId = null
      return { ok: true, closed: tabId }
    }
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

/** Tab-management actions name their target explicitly; there is no "default" tab to fall back to. */
function requireTabId(req: RpcRequest): number {
  if (typeof req.tabId !== 'number') {
    throw new RouterError({ code: 'not_found', message: 'A tabId is required for this action.' })
  }
  return req.tabId
}

async function resolveTab(req: RpcRequest): Promise<number> {
  const tabId = await pickTab(req)
  // Keep the controlled tab the visible one in its window (cheap, no focus steal).
  void chrome.tabs.update(tabId, { active: true }).catch(() => undefined)
  return tabId
}

async function pickTab(req: RpcRequest): Promise<number> {
  // The bridge injects the session's own tabId; an established session always lands here.
  if (typeof req.tabId === 'number') return req.tabId
  // Fallback for a session that has never opened/switched a tab: resolve the active tab
  // fresh each time. We deliberately do NOT persist it into `controlledTabId` — that global
  // is shared across sessions and persisting here would make one session's default action
  // hit whatever tab another session last touched.
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (active?.id !== undefined) return active.id
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

/** Decode the frame a handle index belongs to (indices are `frameId * FRAME_STRIDE + n`). */
function frameOf(params: Record<string, unknown>): number {
  // Single-index actions carry `index`; fill_progressive carries a `fields` array — route it
  // to the frame of its first field (a progressive fill operates within one frame's form).
  const index =
    typeof params.index === 'number'
      ? params.index
      : (params.fields as Array<{ index?: number }> | undefined)?.[0]?.index
  return typeof index === 'number' ? Math.floor(index / FRAME_STRIDE) : 0
}

/** Forward a DOM method to the content script, aggregating frame partials. */
async function forwardToContent(
  tabId: number,
  method: ContentMethod,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (method === 'get_state') {
    const loading = isLoading(tabId)
    const limit = (params.limit as number | undefined) ?? DEFAULT_STATE_LIMIT
    const frames = await sameOriginFrames(tabId)
    const partials = (
      await Promise.all(
        frames.map(frameId =>
          sendToContent(tabId, 'get_state', { ...params, loading }, frameId).catch(() => null),
        ),
      )
    ).filter((p): p is PageState => p !== null)
    const state = aggregate(partials, tabId, loading, limit)
    if (params.withScreenshot) state.screenshot = await shot.captureWithMarks(tabId, state)
    return state
  }
  if (method === 'get_forms') {
    const loading = isLoading(tabId)
    const limit = (params.limit as number | undefined) ?? DEFAULT_FORMS_LIMIT
    const allFrames = await getAllFramesSafe(tabId)
    const frameIds = sameOriginFrameIds(allFrames)
    const partials = (
      await Promise.all(
        frameIds.map(frameId =>
          sendToContent(tabId, 'get_forms', { ...params, loading }, frameId).catch(() => null),
        ),
      )
    ).filter((p): p is FormsState => p !== null)
    // Cross-origin frames can't be read; surface the gap so the agent knows the list may
    // be incomplete (skippedFrames > 0) rather than assuming it saw every field.
    const skipped = Math.max(0, nonErrorFrameCount(allFrames) - frameIds.length)
    return aggregateForms(partials, tabId, loading, limit, skipped)
  }
  // Index-based actions route to the element's own frame; spatial actions stay on the top.
  return sendToContent(tabId, method, params, frameOf(params))
}

/**
 * Frames to index: the top frame plus every same-origin descendant. Cross-origin frames
 * are skipped (deferred past M2) — their geometry can't be placed in the top viewport.
 */
async function sameOriginFrames(tabId: number): Promise<number[]> {
  return sameOriginFrameIds(await getAllFramesSafe(tabId))
}

async function getAllFramesSafe(
  tabId: number,
): Promise<chrome.webNavigation.GetAllFrameResultDetails[]> {
  try {
    return (await chrome.webNavigation.getAllFrames({ tabId })) ?? []
  } catch {
    return []
  }
}

function sameOriginFrameIds(frames: chrome.webNavigation.GetAllFrameResultDetails[]): number[] {
  if (frames.length === 0) return [0]
  const top = frames.find(f => f.frameId === 0)
  const topOrigin = originOf(top?.url)
  return frames
    .filter(f => !f.errorOccurred)
    .filter(f => f.frameId === 0 || sameOrigin(f.url, topOrigin))
    .map(f => f.frameId)
    .sort((a, b) => a - b)
}

/** Count of readable (non-errored) frames; at least 1 (the top) when enumeration failed. */
function nonErrorFrameCount(frames: chrome.webNavigation.GetAllFrameResultDetails[]): number {
  return frames.length === 0 ? 1 : frames.filter(f => !f.errorOccurred).length
}

function originOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** about:blank / about:srcdoc / data: inherit the embedder's origin — treat as same-origin. */
function sameOrigin(url: string, topOrigin: string | null): boolean {
  if (!url || url === 'about:blank' || url === 'about:srcdoc' || url.startsWith('data:')) {
    return true
  }
  return originOf(url) === topOrigin
}

function aggregate(
  partials: PageState[],
  tabId: number,
  loading: boolean,
  limit: number,
): PageState {
  const base = partials.find(p => p.url) ?? partials[0]
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
  // Prefer in-viewport elements when capping across frames; indices stay stable identifiers.
  const elements = partials
    .flatMap(p => p.elements)
    .sort((a, b) => (a.inViewport === b.inViewport ? 0 : a.inViewport ? -1 : 1))
    .slice(0, Math.max(1, limit))
  return { ...base, tabId, loading, elements }
}

/**
 * Merge each frame's forms/orphans. Indices are already frame-encoded so they stay globally
 * unique; we just concatenate, take the top frame's url/title, and apply the total field cap
 * (each frame already ranked + limited internally). `skippedFrames` flags unread cross-origin
 * frames so the agent knows the list may be incomplete.
 */
function aggregateForms(
  partials: FormsState[],
  tabId: number,
  loading: boolean,
  limit: number,
  skippedFrames: number,
): FormsState {
  const base = partials.find(p => p.url) ?? partials[0]
  let budget = Math.max(1, limit)
  const forms: FormsState['forms'] = []
  for (const g of partials.flatMap(p => p.forms)) {
    if (budget <= 0) break
    const fields = g.fields.slice(0, budget)
    budget -= fields.length
    forms.push({ ...g, fields })
  }
  const orphans = partials.flatMap(p => p.orphans).slice(0, Math.max(0, budget))
  return {
    tabId,
    url: base?.url ?? '',
    title: base?.title ?? '',
    forms,
    orphans,
    loading,
    skippedFrames: skippedFrames > 0 ? skippedFrames : undefined,
  }
}

/** Send to a specific frame's content script; inject and retry once if no receiver is present. */
async function sendToContent(
  tabId: number,
  method: ContentMethod | 'ping' | 'wait_quiet' | 'locate',
  params: unknown,
  frameId = 0,
): Promise<unknown> {
  const msg: ContentRequest = { channel: 'monkeysee', method, params, frameId }
  const opts = { frameId }
  try {
    return unwrap(await chrome.tabs.sendMessage<ContentRequest, ContentResponse>(tabId, msg, opts))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (
      !message.includes('Receiving end does not exist') &&
      !message.includes('Could not establish')
    ) {
      throw e
    }
    await injectContent(tabId, frameId)
    return unwrap(await chrome.tabs.sendMessage<ContentRequest, ContentResponse>(tabId, msg, opts))
  }
}

function unwrap(res: ContentResponse | undefined): unknown {
  if (!res) throw new RouterError({ code: 'internal', message: 'No response from content script.' })
  if (res.ok) return res.result
  throw new RouterError(res.error)
}

async function injectContent(tabId: number, frameId = 0): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    files: ['content.js'],
  })
}

// ---- Trusted-input (debugger) backend ----

async function useDebuggerBackend(): Promise<boolean> {
  const { backend } = await chrome.storage.local.get('backend')
  return backend === 'debugger'
}

/** Resolve an index to viewport coordinates via the content script (scrolls into view). */
async function locateForDebugger(tabId: number, index: number): Promise<{ x: number; y: number }> {
  const frameId = Math.floor(index / FRAME_STRIDE)
  const r = (await sendToContent(tabId, 'locate', { index }, frameId)) as { x: number; y: number }
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
