// Popup script. Plain JS (not bundled) — runs on the extension popup page.

const dot = document.getElementById('dot')
const statusEl = document.getElementById('status')
const tabEl = document.getElementById('tab')
const enforceEl = document.getElementById('enforce')
const trustedEl = document.getElementById('trusted')
const allowlistEl = document.getElementById('allowlist')
const savedEl = document.getElementById('saved')

chrome.runtime.sendMessage({ channel: 'monkeysee-popup' }, res => {
  const connected = res && res.connected
  dot.classList.toggle('on', !!connected)
  if (res && res.incompatible) {
    const i = res.incompatible
    statusEl.textContent = `incompatible bridge (bridge protocol ${i.bridgeProtocolVersion}, extension ${i.extensionProtocolVersion}) — update the older side`
  } else {
    statusEl.textContent = connected ? 'connected to bridge' : 'bridge not connected'
  }
})

chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
  const tab = tabs && tabs[0]
  tabEl.textContent = tab && tab.url ? new URL(tab.url).hostname : '—'
})

chrome.storage.local.get(['enforce', 'allowlist', 'backend'], stored => {
  enforceEl.checked = !!stored.enforce
  trustedEl.checked = stored.backend === 'debugger'
  allowlistEl.value = Array.isArray(stored.allowlist) ? stored.allowlist.join('\n') : ''
})

// Persist the backend toggle immediately so it takes effect without "Save".
trustedEl.addEventListener('change', () => {
  chrome.storage.local.set({ backend: trustedEl.checked ? 'debugger' : 'content' })
})

document.getElementById('save').addEventListener('click', () => {
  const allowlist = allowlistEl.value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
  chrome.storage.local.set(
    { enforce: enforceEl.checked, allowlist, backend: trustedEl.checked ? 'debugger' : 'content' },
    () => {
      savedEl.textContent = 'saved'
      setTimeout(() => (savedEl.textContent = ''), 1500)
    },
  )
})
