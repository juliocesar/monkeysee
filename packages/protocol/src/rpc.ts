import type { PageState } from './state.js'

export type RpcMethod =
  | 'open_tab'
  | 'list_tabs'
  | 'switch_tab'
  | 'close_tab'
  | 'navigate'
  | 'go_back'
  | 'go_forward'
  | 'wait_for_load'
  | 'get_state'
  | 'get_forms'
  | 'extract_text'
  | 'screenshot'
  | 'click'
  | 'type'
  | 'select_option'
  | 'fill_progressive'
  | 'hover'
  | 'focus'
  | 'click_at'
  | 'scroll'
  | 'scroll_to'
  | 'drag'
  | 'press'
  | 'type_text'

export interface RpcRequest {
  id: string
  method: RpcMethod
  /** Optional explicit target; defaults to the controlled tab. */
  tabId?: number
  params: unknown
}

export type RpcResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: RpcError }

export interface RpcError {
  code: 'stale_handle' | 'not_found' | 'navigation' | 'timeout' | 'blocked' | 'internal'
  message: string
}

/**
 * One structured debug/latency record. **Dev builds only** — logging is compiled out of
 * released artifacts and the bridge only writes the file when its own dev flag is on.
 * Written as NDJSON (one JSON object per line) so it is trivial to slice for analysis.
 */
export interface DebugEntry {
  /** Wall clock (`Date.now()`), used only to order events across processes in the file. */
  t: number
  /** Which process emitted it. */
  comp: 'bridge' | 'sw' | 'content'
  /** Event / span name, e.g. `rpc`, `route`, `sendToContent`, `content`. */
  ev: string
  /** RPC correlation id (`r<n>` / `f<n>`) tying one call across processes, when known. */
  id?: string
  /** RPC / DOM method, when relevant. */
  method?: string
  /** Span duration in ms (measured with `performance.now()` within one process). */
  dur?: number
  /** Arbitrary structured extras: counts, frameId, payload sizes, ok/error flags. */
  data?: Record<string, unknown>
}

/** Unsolicited SW -> bridge messages (connection hello, or a dev-only debug log entry). */
export type RpcEvent =
  | { type: 'hello'; extensionVersion: string; protocolVersion: string }
  | { type: 'log'; entry: DebugEntry }

/**
 * Bridge -> SW message refusing a connection whose protocol major does not match the
 * bridge's. Sent just before the bridge drops the socket, so the extension can surface a
 * clear "incompatible bridge" status instead of a bare disconnect.
 */
export type BridgeEvent = {
  type: 'incompatible'
  bridgeProtocolVersion: string
  extensionProtocolVersion: string
}

export type { PageState }
