#!/usr/bin/env node
// Dev-only: turn the MonkeySee NDJSON debug log into a ranked latency report so slow steps,
// long waits, and heavy fan-out are obvious. Reads the shared file the bridge writes.
//
//   node scripts/analyze-debug-log.mjs [path] [--all] [--session <sess>]
//
// Default path: $MONKEYSEE_DEBUG_FILE or <os tmpdir>/monkeysee-debug.log
// By default it analyzes only the latest run (from the last `session-start`); --all overrides.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flags = new Set(args.filter(a => a.startsWith('--')))
const sessionArg = (() => {
  const i = args.indexOf('--session')
  return i >= 0 ? args[i + 1] : null
})()

/** Newest `monkeysee-*.log` in the temp dir — the last run, since each run gets its own file. */
function latestLog() {
  const dir = tmpdir()
  const matches = readdirSync(dir)
    .filter(f => f.startsWith('monkeysee-') && f.endsWith('.log'))
    .map(f => join(dir, f))
    .map(p => ({ p, m: statSync(p).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  return matches[0]?.p ?? null
}

const path =
  args.find(a => !a.startsWith('--') && a !== sessionArg) ??
  process.env.MONKEYSEE_DEBUG_FILE ??
  latestLog()

if (!path) {
  console.error(
    `No monkeysee-*.log found in ${tmpdir()}. Run under \`pnpm dev\` (or MONKEYSEE_DEBUG=1) first.`,
  )
  process.exit(1)
}

let raw
try {
  raw = readFileSync(path, 'utf8')
} catch {
  console.error(`No debug log at ${path}. Run under \`pnpm dev\` (or MONKEYSEE_DEBUG=1) first.`)
  process.exit(1)
}

let rows = raw
  .split('\n')
  .filter(Boolean)
  .flatMap(l => {
    try {
      return [JSON.parse(l)]
    } catch {
      return []
    }
  })

// Scope to a single run so timings aren't mixed across sessions.
if (!flags.has('--all')) {
  if (sessionArg) {
    rows = rows.filter(r => r.sess === sessionArg)
  } else {
    let lastStart = 0
    rows.forEach((r, i) => {
      if (r.ev === 'session-start') lastStart = i
    })
    rows = rows.slice(lastStart)
  }
}

if (rows.length === 0) {
  console.error('No entries to analyze.')
  process.exit(1)
}

const fmt = ms => (ms == null ? '  -  ' : `${ms.toFixed(1)}ms`.padStart(8))
const pct = (arr, p) => {
  if (arr.length === 0) return null
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

// ---- Per-call reconstruction (join across processes by RPC id) ----
const byId = new Map()
for (const r of rows) {
  if (!r.id) continue
  if (!byId.has(r.id)) byId.set(r.id, [])
  byId.get(r.id).push(r)
}

const pick = (spans, comp, ev) => spans.find(s => s.comp === comp && s.ev === ev)
const calls = []
for (const [id, spans] of byId) {
  const rpc = pick(spans, 'bridge', 'rpc') ?? pick(spans, 'bridge', 'control.rpc')
  const route = pick(spans, 'sw', 'route')
  const method = rpc?.method ?? route?.method ?? spans.find(s => s.method)?.method ?? '?'
  const total = rpc?.dur ?? route?.dur ?? 0
  calls.push({ id, method, total, spans, rpc, route })
}
calls.sort((a, b) => b.total - a.total)

// ---- Aggregate by method ----
const byMethod = new Map()
for (const c of calls) {
  if (!byMethod.has(c.method)) byMethod.set(c.method, [])
  byMethod.get(c.method).push(c.total)
}

console.log(`\nMonkeySee latency report  —  ${path}`)
console.log(
  `run: sess=${rows[0].sess ?? '?'}  role=${rows[0].role ?? '?'}  calls=${calls.length}\n`,
)

console.log('Per method (bridge round-trip):')
console.log('  method                 n     p50      p90      max')
const methodRows = [...byMethod.entries()]
  .map(([m, ds]) => ({ m, n: ds.length, p50: pct(ds, 50), p90: pct(ds, 90), max: Math.max(...ds) }))
  .sort((a, b) => b.max - a.max)
for (const r of methodRows) {
  console.log(
    `  ${r.m.padEnd(20)} ${String(r.n).padStart(3)}  ${fmt(r.p50)} ${fmt(r.p90)} ${fmt(r.max)}`,
  )
}

// ---- Composite tool spans (fill_fields / done: one MCP call, several RPCs) ----
const tools = rows.filter(r => r.comp === 'bridge' && r.ev === 'tool' && r.dur != null)
if (tools.length) {
  console.log('\nComposite tool calls (whole MCP handler, decomposes into rpc spans):')
  for (const t of tools.sort((a, b) => b.dur - a.dur)) {
    const extra = t.data
      ? Object.entries(t.data)
          .filter(([k]) => k !== 'ok')
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')
      : ''
    console.log(`  ${(t.method ?? '?').padEnd(20)} ${fmt(t.dur)}   ${extra}`)
  }
}

// ---- Slowest individual calls, with sub-span breakdown ----
const topN = Number(process.env.TOP ?? 12)
console.log(
  `\nSlowest ${Math.min(topN, calls.length)} calls (bridge rpc | sw route | content, + sub-spans):`,
)
for (const c of calls.slice(0, topN)) {
  const content = c.spans.filter(s => s.comp === 'content' && s.ev === 'content')
  const contentDur = content.reduce((n, s) => n + (s.dur ?? 0), 0)
  console.log(
    `\n  #${c.id}  ${c.method.padEnd(16)} rpc=${fmt(c.total)} route=${fmt(c.route?.dur)} content=${fmt(contentDur)}`,
  )
  const subs = c.spans
    .filter(s => s !== c.rpc && s !== c.route && s.dur != null)
    .sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))
  for (const s of subs) {
    const extra = s.data
      ? Object.entries(s.data)
          .filter(([k]) => k !== 'ok')
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')
      : ''
    console.log(`      ${s.comp.padEnd(7)} ${s.ev.padEnd(16)} ${fmt(s.dur)}   ${extra}`)
  }
}

console.log('')
