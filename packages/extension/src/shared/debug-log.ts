import type { DebugEntry } from 'monkeysee-protocol'

/**
 * Dev-only latency/step logging for the extension. The extension cannot write to the
 * filesystem, so entries are shipped to the bridge (a Node process) over the existing WS and
 * appended to the shared NDJSON log there. Two contexts share this module:
 *
 * - **Service worker**: registers a `sink` (via `setDebugSink`) that forwards entries to the
 *   bridge through the `WsClient`. Its own spans go straight out.
 * - **Content script**: no sink → hops entries to the SW with `chrome.runtime.sendMessage`
 *   (`monkeysee-log` channel); the SW forwards them on.
 *
 * `__MONKEYSEE_DEV__` is injected by esbuild `define` (true under `pnpm dev`, false in a
 * released/bundled build), so all of this is inert — and dead-code eliminable — in prod.
 */

declare const __MONKEYSEE_DEV__: boolean
export const DEBUG = typeof __MONKEYSEE_DEV__ !== 'undefined' && __MONKEYSEE_DEV__

// Service workers have no `window`; content scripts run in the page and do. Evaluated once
// per bundling context, so it is correct in each.
const COMP: DebugEntry['comp'] = typeof window === 'undefined' ? 'sw' : 'content'

type Sink = (entry: DebugEntry) => void
let sink: Sink | null = null

/** The SW calls this to route entries to the bridge over the WS. */
export function setDebugSink(fn: Sink): void {
  sink = fn
}

function emit(entry: DebugEntry): void {
  if (!DEBUG) return
  if (sink) {
    sink(entry)
    return
  }
  // Content script (or SW before its sink is set): forward to the SW, which owns the WS.
  try {
    void chrome.runtime.sendMessage({ channel: 'monkeysee-log', entry })
  } catch {
    // No receiver (SW asleep) — drop it; dev-only diagnostics, not correctness.
  }
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100
}

/** A point-in-time event (no duration). */
export function point(
  ev: string,
  fields: { id?: string; method?: string; dur?: number; data?: Record<string, unknown> } = {},
): void {
  if (!DEBUG) return
  emit({ t: Date.now(), comp: COMP, ev, ...fields })
}

/**
 * Time a span (sync or async) and emit `{ ev, id, method, dur, data:{...,ok} }` when it
 * settles. `id` should be the RPC id so the span joins the bridge/SW/content timeline.
 */
export async function span<T>(
  ev: string,
  fields: { id?: string; method?: string; data?: Record<string, unknown> },
  fn: () => T | Promise<T>,
): Promise<T> {
  if (!DEBUG) return fn()
  const start = performance.now()
  let ok = true
  try {
    return await fn()
  } catch (e) {
    ok = false
    throw e
  } finally {
    emit({
      t: Date.now(),
      comp: COMP,
      ev,
      id: fields.id,
      method: fields.method,
      dur: round(performance.now() - start),
      data: { ...fields.data, ok },
    })
  }
}
