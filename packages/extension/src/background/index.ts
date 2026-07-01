import type { DebugEntry } from 'monkeysee-protocol'
import { initNav } from './nav'
import { initDebugger } from './debugger-backend'
import { handleRequest } from './router'
import { WsClient } from './ws-client'
import { DEBUG, setDebugSink } from '../shared/debug-log'

const WS_URL = 'ws://localhost:8787'

initNav()
initDebugger()

const client = new WsClient(WS_URL, handleRequest)
client.start()

// Dev only: the SW owns the WS, so it ships every extension-side span (its own + the content
// script's, relayed over the `monkeysee-log` channel) to the bridge, which writes the file.
if (DEBUG) setDebugSink(entry => client.send({ type: 'log', entry }))

// Expose connection status to the popup; relay content-script debug entries to the bridge.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const channel = (msg as { channel?: string } | null)?.channel
  if (channel === 'monkeysee-log') {
    if (DEBUG) client.send({ type: 'log', entry: (msg as { entry: DebugEntry }).entry })
    return false
  }
  if (channel === 'monkeysee-popup') {
    sendResponse({ connected: client.isConnected(), incompatible: client.getIncompatible() })
    return true
  }
  return false
})

console.log('[monkeysee] service worker started')
