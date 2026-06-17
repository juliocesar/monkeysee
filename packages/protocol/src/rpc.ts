import type { PageState } from './state.js'

export type RpcMethod =
  | 'open_tab'
  | 'navigate'
  | 'go_back'
  | 'go_forward'
  | 'wait_for_load'
  | 'get_state'
  | 'extract_text'
  | 'screenshot'
  | 'click'
  | 'type'
  | 'select_option'
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

/** Unsolicited SW -> bridge messages (e.g. connection hello). */
export type RpcEvent = { type: 'hello'; extensionVersion: string; protocolVersion: string }

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
