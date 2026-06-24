import type { RpcError } from 'monkeysee-protocol'

/** RPC methods the content script handles directly (they need DOM access). */
export type ContentMethod =
  | 'get_state'
  | 'get_forms'
  | 'extract_text'
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

/** Internal control messages the content script also answers. */
export type ContentControl = 'ping' | 'wait_quiet' | 'locate'

/**
 * Message the service worker sends to a content script. `frameId` is assigned by
 * the SW (it knows which frame it is targeting), so the content script never has to
 * discover its own frame. Always 0 in M0.
 */
export interface ContentRequest {
  /** Discriminator so we never react to unrelated runtime messages. */
  channel: 'monkeysee'
  method: ContentMethod | ContentControl
  params: unknown
  frameId: number
}

export type ContentResponse = { ok: true; result: unknown } | { ok: false; error: RpcError }

export function isContentRequest(msg: unknown): msg is ContentRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { channel?: unknown }).channel === 'monkeysee'
  )
}
