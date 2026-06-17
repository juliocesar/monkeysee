// End-to-end bridge verification WITHOUT a browser.
//
// Spawns the real bridge (MCP over stdio + WS server), connects a *fake extension*
// WS client that answers RpcRequests with canned data, then drives the bridge as a
// real MCP client and asserts the full path: tool call -> WS RPC -> correlation ->
// result, plus stale_handle error mapping and not-connected behavior.

import { WebSocket } from 'ws'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE = resolve(__dirname, '../dist/index.js')
const PORT = '8799' // dedicated test extension port
const CONTROL_PORT = '8798' // dedicated test control port (never collide with a real bridge)

// A 1x1 transparent PNG; stands in for a captured viewport in the browser-free harness.
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

let failures = 0
function check(name, cond) {
  if (cond) console.log(`  ✓ ${name}`)
  else {
    console.error(`  ✗ ${name}`)
    failures++
  }
}

// A fake extension: connects to the bridge WS and answers RpcRequests.
function startFakeExtension() {
  const ws = new WebSocket(`ws://localhost:${PORT}`)
  const fakeState = {
    tabId: 7,
    url: 'https://en.wikipedia.org/wiki/Wales',
    title: 'Wales - Wikipedia',
    viewport: { w: 1280, h: 800, scrollX: 0, scrollY: 0, dpr: 2 },
    elements: [
      {
        index: 0,
        frameId: 0,
        role: 'searchbox',
        name: 'Search Wikipedia',
        box: [10, 10, 200, 30],
        inViewport: true,
      },
      {
        index: 1,
        frameId: 0,
        role: 'link',
        name: 'Wales',
        box: [10, 60, 80, 20],
        inViewport: true,
      },
    ],
    loading: false,
  }
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'hello', extensionVersion: '0.0.1', protocolVersion: '0.0.1' }))
  })
  ws.on('message', raw => {
    let req
    try {
      req = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (!req.id) return
    let res
    switch (req.method) {
      case 'get_state': {
        // Mirror the extension: withScreenshot rides a base64 PNG along on the PageState.
        const withShot = req.params && req.params.withScreenshot
        res = {
          id: req.id,
          ok: true,
          result: withShot ? { ...fakeState, screenshot: TINY_PNG } : fakeState,
        }
        break
      }
      case 'screenshot':
        res = { id: req.id, ok: true, result: { imageBase64: TINY_PNG } }
        break
      case 'extract_text':
        res = {
          id: req.id,
          ok: true,
          result: { text: 'Wales is a country that is part of the United Kingdom.' },
        }
        break
      case 'click':
        // Simulate a stale handle to exercise error mapping.
        res = {
          id: req.id,
          ok: false,
          error: { code: 'stale_handle', message: 'Element 1 is gone.' },
        }
        break
      case 'open_tab':
        res = { id: req.id, ok: true, result: { tabId: 7 } }
        break
      case 'list_tabs':
        res = {
          id: req.id,
          ok: true,
          result: {
            controlledTabId: 7,
            tabs: [
              {
                tabId: 7,
                url: 'https://en.wikipedia.org/wiki/Wales',
                title: 'Wales - Wikipedia',
                active: true,
                controlled: true,
              },
              {
                tabId: 8,
                url: 'https://example.com/',
                title: 'Example',
                active: false,
                controlled: false,
              },
            ],
          },
        }
        break
      case 'switch_tab':
        // Echo the targeted tab so the test can assert the envelope tabId was threaded.
        res = { id: req.id, ok: true, result: { tabId: req.tabId } }
        break
      default:
        // Echo tabId so tabId-targeting through the RPC envelope is observable.
        res = { id: req.id, ok: true, result: { ok: true, tabId: req.tabId } }
    }
    ws.send(JSON.stringify(res))
  })
  return ws
}

function textOf(result) {
  return (result.content ?? []).map(c => c.text ?? '').join('\n')
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [BRIDGE],
    env: { ...process.env, MONKEYSEE_WS_PORT: PORT, MONKEYSEE_CONTROL_PORT: CONTROL_PORT },
    stderr: 'inherit',
  })
  const client = new Client({ name: 'e2e-test', version: '0.0.0' })
  await client.connect(transport)
  console.log('MCP client connected to bridge')

  // 1) not-connected behavior: call before the fake extension attaches.
  const notConnected = await client.callTool({ name: 'get_state', arguments: {} })
  check('get_state before extension connects returns an error', notConnected.isError === true)
  check(
    'not-connected error tells the user to open Chrome',
    /not connected|extension/i.test(textOf(notConnected)),
  )

  // 1b) protocol enforcement: an extension with a mismatched major is refused and dropped.
  const refusal = await new Promise(resolve => {
    const bad = new WebSocket(`ws://localhost:${PORT}`)
    let event = null
    bad.on('open', () =>
      bad.send(
        JSON.stringify({ type: 'hello', extensionVersion: '9.9.9', protocolVersion: '99.0.0' }),
      ),
    )
    bad.on('message', raw => {
      try {
        event = JSON.parse(raw.toString())
      } catch {
        // ignore
      }
    })
    bad.on('close', () => resolve(event))
    setTimeout(() => {
      try {
        bad.close()
      } catch {
        // ignore
      }
      resolve(event)
    }, 1500)
  })
  check('incompatible extension receives a refusal event', refusal?.type === 'incompatible')
  check(
    'refusal reports the bridge protocol version',
    typeof refusal?.bridgeProtocolVersion === 'string',
  )
  const stillNotConnected = await client.callTool({ name: 'get_state', arguments: {} })
  check('bridge does not serve an extension it refused', stillNotConnected.isError === true)

  // Attach the fake extension and wait for the handshake to register.
  const ext = startFakeExtension()
  await new Promise((res, rej) => {
    ext.once('open', () => setTimeout(res, 200))
    ext.once('error', rej)
  })

  // 2) tool listing
  const tools = await client.listTools()
  const names = tools.tools.map(t => t.name)
  check(
    'all expected tools are registered',
    [
      'get_state',
      'extract_text',
      'click',
      'type',
      'open_tab',
      'list_tabs',
      'switch_tab',
      'close_tab',
      'navigate',
      'wait_for_load',
      'screenshot',
      'done',
    ].every(n => names.includes(n)),
  )

  // 3) get_state round-trips the PageState
  const state = await client.callTool({ name: 'get_state', arguments: { limit: 50 } })
  check('get_state succeeds', !state.isError)
  check('get_state returns the page url', textOf(state).includes('en.wikipedia.org/wiki/Wales'))
  check('get_state returns indexed elements', textOf(state).includes('"role": "searchbox"'))

  // 4) stale_handle maps to an actionable error
  const click = await client.callTool({ name: 'click', arguments: { index: 1 } })
  check('click stale handle is an error', click.isError === true)
  check('stale_handle message tells agent to re-read', /get_state/i.test(textOf(click)))

  // 4b) screenshot returns an MCP image content block
  const shot = await client.callTool({ name: 'screenshot', arguments: {} })
  check('screenshot succeeds', !shot.isError)
  const shotImg = (shot.content ?? []).find(c => c.type === 'image')
  check('screenshot returns an image block', !!shotImg && shotImg.data === TINY_PNG)
  check('screenshot image is png', !!shotImg && shotImg.mimeType === 'image/png')

  // 4c) get_state withScreenshot returns the PageState text AND a marked image
  const shotState = await client.callTool({
    name: 'get_state',
    arguments: { withScreenshot: true },
  })
  check('get_state withScreenshot still returns the url', textOf(shotState).includes('wiki/Wales'))
  check(
    'get_state withScreenshot does not leak base64 into the text block',
    !textOf(shotState).includes(TINY_PNG),
  )
  check(
    'get_state withScreenshot attaches an image block',
    (shotState.content ?? []).some(c => c.type === 'image' && c.data === TINY_PNG),
  )

  // 4d) multi-tab: list_tabs enumerates open tabs
  const list = await client.callTool({ name: 'list_tabs', arguments: {} })
  check('list_tabs succeeds', !list.isError)
  check('list_tabs enumerates multiple tabs', textOf(list).includes('example.com'))

  // 4e) switch_tab threads the target through the RPC envelope (not the params body)
  const switched = await client.callTool({ name: 'switch_tab', arguments: { tabId: 8 } })
  check('switch_tab succeeds', !switched.isError)
  check('switch_tab targets the requested tab', textOf(switched).includes('"tabId": 8'))

  // 4f) an optional tabId on a normal tool reaches the extension as the RPC target
  const targeted = await client.callTool({
    name: 'navigate',
    arguments: { url: 'https://example.com/', tabId: 8 },
  })
  check('navigate accepts an explicit tabId', !targeted.isError)
  check(
    'explicit tabId reaches the extension as the RPC target',
    textOf(targeted).includes('"tabId": 8'),
  )

  // 5) done grounds the answer with url + snippet
  const done = await client.callTool({
    name: 'done',
    arguments: { answer: 'Found the Wales article.' },
  })
  const doneText = textOf(done)
  check('done returns the answer', doneText.includes('Found the Wales article.'))
  check('done grounds with url', doneText.includes('en.wikipedia.org/wiki/Wales'))
  check('done grounds with snippet', /Wales is a country/.test(doneText))

  ext.close()
  await client.close()

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => {
  console.error('e2e harness crashed:', err)
  process.exit(1)
})
