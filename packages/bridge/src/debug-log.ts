import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { DebugEntry } from 'monkeysee-protocol'

/**
 * Dev-only latency/step logging for the bridge, and the single writer for the whole system:
 * the extension (which cannot touch the filesystem) ships its own `DebugEntry`s over the WS
 * and they are appended to the same file via `logRemote`. Everything lands in one NDJSON file
 * so a tool call can be reconstructed across bridge -> SW -> content by its RPC `id`.
 *
 * Enabled iff (a) the build was compiled with the dev flag (esbuild `define`, set under
 * `pnpm dev`), or (b) `MONKEYSEE_DEBUG=1`. `MONKEYSEE_DEBUG=0` force-disables. A released
 * artifact is built without the flag, so this is inert (and the file never appears) in prod.
 */

// Injected by esbuild `define` at build time; `typeof` guard keeps `tsc` and any
// non-esbuild consumer happy (treated as not-dev).
declare const __MONKEYSEE_DEV__: boolean
const COMPILED_DEV = typeof __MONKEYSEE_DEV__ !== 'undefined' && __MONKEYSEE_DEV__

function resolveEnabled(): boolean {
  const env = process.env.MONKEYSEE_DEBUG
  if (env === '1') return true
  if (env === '0') return false
  return COMPILED_DEV
}

const ENABLED = resolveEnabled()

/**
 * Default log path: `<tmpdir>/monkeysee-<cwd basename>-<timestamp>.log`. The cwd basename ties
 * the file to the project the bridge was launched from; the timestamp makes every run its own
 * file (no cross-run mixing). `MONKEYSEE_DEBUG_FILE` overrides it wholesale.
 */
function defaultFile(): string {
  const dir = basename(process.cwd()).replace(/[^a-zA-Z0-9_.-]/g, '-') || 'root'
  const ts = new Date().toISOString().replace(/[:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return join(tmpdir(), `monkeysee-${dir}-${ts}.log`)
}

const FILE = process.env.MONKEYSEE_DEBUG_FILE ?? (ENABLED ? defaultFile() : '')

/** Session id + role stamped onto every line so a shared file is attributable per process. */
let ctx: { sess: string; role: string } = { sess: '????????', role: 'electing' }
let started = false

export function debugEnabled(): boolean {
  return ENABLED
}

export function debugFilePath(): string {
  return FILE
}

/** Set/refresh the session id and role (leader/follower) written on each line. */
export function setDebugContext(next: Partial<{ sess: string; role: string }>): void {
  ctx = { ...ctx, ...next }
}

function append(entry: DebugEntry): void {
  try {
    appendFileSync(FILE, JSON.stringify({ ...entry, sess: ctx.sess, role: ctx.role }) + '\n')
  } catch {
    // Never let logging break the bridge.
  }
}

/** Append one entry originating in this bridge process. No-op unless enabled. */
export function log(entry: DebugEntry): void {
  if (!ENABLED) return
  if (!started) {
    started = true
    append({ t: Date.now(), comp: 'bridge', ev: 'session-start', data: { pid: process.pid } })
  }
  append(entry)
}

/** Append an entry relayed from the extension over the WS (already carries comp/t/id). */
export function logRemote(entry: DebugEntry): void {
  log(entry)
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100
}

/**
 * Time an async span and emit `{ ev, id, method, dur, data:{...,ok} }` when it settles.
 * Returns the wrapped promise untouched (errors still propagate).
 */
export async function span<T>(
  ev: string,
  fields: { id?: string; method?: string; data?: Record<string, unknown> },
  fn: () => Promise<T>,
): Promise<T> {
  if (!ENABLED) return fn()
  const start = performance.now()
  let ok = true
  let code: string | undefined
  try {
    return await fn()
  } catch (e) {
    ok = false
    code = (e as { rpc?: { code?: string } } | undefined)?.rpc?.code
    throw e
  } finally {
    log({
      t: Date.now(),
      comp: 'bridge',
      ev,
      id: fields.id,
      method: fields.method,
      dur: round(performance.now() - start),
      data: { ...fields.data, ok, ...(code ? { code } : {}) },
    })
  }
}
