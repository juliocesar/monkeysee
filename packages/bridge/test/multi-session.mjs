// Multi-session verification WITHOUT a browser.
//
// Spawns TWO real bridges against the same ports — a LEADER (wins the extension port) and a
// FOLLOWER (proxies its RPCs to the leader over the control port) — plus a single fake
// extension. Drives each bridge as its own MCP client and asserts:
//   - the follower's tool calls round-trip (the core regression: B is not "dead on arrival"),
//   - per-session tab isolation (A's default action carries A's tab, B's carries B's),
//   - leader handoff: kill the leader, the follower re-elects and keeps its own tab.

import { WebSocket } from 'ws'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE = resolve(__dirname, '../dist/index.js')
const PORT = '8797' // dedicated test extension port
const CONTROL_PORT = '8796' // dedicated test control port

let failures = 0
function check(name, cond) {
  if (cond) console.log(`  ✓ ${name}`)
  else {
    console.error(`  ✗ ${name}`)
    failures++
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

function textOf(result) {
  return (result.content ?? []).map(c => c.text ?? '').join('\n')
}

function tabIdOf(result) {
  const m = /"tabId":\s*(\d+)/.exec(textOf(result))
  return m ? Number(m[1]) : null
}

// A reconnecting fake extension. Echoes the tabId it received in each result, maps an
// open_tab url to a stable tabId, and re-dials whichever bridge currently owns the port
// (so it follows a leader handoff just like the real extension does).
function startFakeExtension() {
  let ws = null
  let stopped = false
  const baseState = {
    url: 'https://example.com/',
    title: 'Example',
    viewport: { w: 1280, h: 800, scrollX: 0, scrollY: 0, dpr: 2 },
    elements: [],
    loading: false,
  }
  const tabForUrl = url => {
    if (/a\.example/.test(url ?? '')) return 101
    if (/b\.example/.test(url ?? '')) return 202
    return 7
  }
  const connect = () => {
    if (stopped) return
    ws = new WebSocket(`ws://localhost:${PORT}`)
    ws.on('open', () => {
      ws.send(
        JSON.stringify({ type: 'hello', extensionVersion: '0.0.1', protocolVersion: '0.0.1' }),
      )
    })
    ws.on('message', raw => {
      let req
      try {
        req = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (!req || !req.id) return
      let res
      switch (req.method) {
        case 'open_tab':
          res = { id: req.id, ok: true, result: { tabId: tabForUrl(req.params?.url) } }
          break
        case 'get_state':
          // The session injects its currentTabId; echo it back as the resolved PageState.tabId.
          res = {
            id: req.id,
            ok: true,
            result: { ...baseState, tabId: req.tabId ?? 7 },
          }
          break
        default:
          res = { id: req.id, ok: true, result: { ok: true, tabId: req.tabId ?? null } }
      }
      ws.send(JSON.stringify(res))
    })
    ws.on('close', () => {
      if (!stopped) setTimeout(connect, 100)
    })
    ws.on('error', () => {
      try {
        ws.close()
      } catch {
        // ignore; close handler reconnects
      }
    })
  }
  connect()
  return {
    stop() {
      stopped = true
      try {
        ws?.close()
      } catch {
        // ignore
      }
    },
  }
}

function spawnBridge(name) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [BRIDGE],
    env: { ...process.env, MONKEYSEE_WS_PORT: PORT, MONKEYSEE_CONTROL_PORT: CONTROL_PORT },
    stderr: 'inherit',
  })
  const client = new Client({ name, version: '0.0.0' })
  return { transport, client }
}

// Retry a tool call until it succeeds (or times out). The follower may still be electing,
// and after a handoff the new leader needs a moment to re-bind and the fake extension to
// reconnect — both surface as transient errors the agent would normally retry through.
async function callUntilOk(client, name, args, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await client.callTool({ name, arguments: args })
    if (!last.isError) return last
    await sleep(150)
  }
  return last
}

async function main() {
  // 1) Leader first: spawn, connect, and give it a moment to win the extension port.
  const a = spawnBridge('session-A')
  await a.client.connect(a.transport)
  console.log('session A (leader) connected')
  await sleep(400)

  const ext = startFakeExtension()
  await sleep(400)

  // 2) Follower: same ports. Its open_tab must round-trip via the leader's relay.
  const b = spawnBridge('session-B')
  await b.client.connect(b.transport)
  console.log('session B (follower) connected')

  // A opens its own tab; B opens its own tab.
  const aOpen = await callUntilOk(a.client, 'open_tab', { url: 'https://a.example/' })
  check('A open_tab round-trips', !aOpen.isError)
  check('A adopts tab 101', tabIdOf(aOpen) === 101)

  const bOpen = await callUntilOk(b.client, 'open_tab', { url: 'https://b.example/' })
  check('B (follower) open_tab round-trips — not "extension not connected"', !bOpen.isError)
  check('B adopts tab 202', tabIdOf(bOpen) === 202)

  // 3) Isolation: each session's default-target get_state carries ITS OWN tab.
  const aState = await callUntilOk(a.client, 'get_state', {})
  check('A get_state succeeds', !aState.isError)
  check('A default action targets tab 101', tabIdOf(aState) === 101)

  const bState = await callUntilOk(b.client, 'get_state', {})
  check('B get_state succeeds', !bState.isError)
  check('B default action targets tab 202', tabIdOf(bState) === 202)

  // 4) Leader handoff: kill A (terminal A closed). B must re-elect and keep tab 202.
  console.log('killing leader A ...')
  await a.transport.close()

  const bAfter = await callUntilOk(b.client, 'get_state', {}, 12_000)
  check('B still works after leader death (re-elected)', !bAfter.isError)
  check('B currentTabId survived handoff (still 202)', tabIdOf(bAfter) === 202)

  ext.stop()
  await b.client.close()

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => {
  console.error('multi-session harness crashed:', err)
  process.exit(1)
})
