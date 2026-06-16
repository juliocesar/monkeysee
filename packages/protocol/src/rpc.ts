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

export type { PageState }
