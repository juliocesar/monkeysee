import { initNav } from './nav'
import { initDebugger } from './debugger-backend'
import { handleRequest } from './router'
import { WsClient } from './ws-client'

const WS_URL = 'ws://localhost:8787'

initNav()
initDebugger()

const client = new WsClient(WS_URL, handleRequest)
client.start()

// Expose connection status to the popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (
    msg &&
    typeof msg === 'object' &&
    (msg as { channel?: string }).channel === 'monkeysee-popup'
  ) {
    sendResponse({ connected: client.isConnected(), incompatible: client.getIncompatible() })
    return true
  }
  return false
})

console.log('[monkeysee] service worker started')
