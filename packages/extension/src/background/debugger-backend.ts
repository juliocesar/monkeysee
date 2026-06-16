/**
 * Trusted-input backend (M1). Dispatches real input via the Chrome DevTools Protocol
 * (`chrome.debugger` → `Input.dispatch*`), so events carry `isTrusted: true` and pass
 * the checks that reject synthetic events. Attach is lazy and per-tab; the content-script
 * backend remains the fallback when attaching is not possible (e.g. DevTools is open).
 */

const CDP_VERSION = '1.3'
const attached = new Set<number>()
let platformOs: string | null = null

async function getOs(): Promise<string> {
  if (!platformOs) platformOs = (await chrome.runtime.getPlatformInfo()).os
  return platformOs
}

export function initDebugger(): void {
  chrome.debugger.onDetach.addListener(source => {
    if (source.tabId !== undefined) attached.delete(source.tabId)
  })
  chrome.tabs.onRemoved.addListener(tabId => attached.delete(tabId))
}

export function isAttached(tabId: number): boolean {
  return attached.has(tabId)
}

async function ensureAttached(tabId: number): Promise<void> {
  if (attached.has(tabId)) return
  try {
    await chrome.debugger.attach({ tabId }, CDP_VERSION)
    attached.add(tabId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Already attached by us in a prior SW lifetime — treat as attached.
    if (/already attached/i.test(msg) && /this extension/i.test(msg)) {
      attached.add(tabId)
      return
    }
    throw new Error(`debugger attach failed: ${msg}`)
  }
}

async function send(tabId: number, method: string, params: Record<string, unknown>): Promise<void> {
  await chrome.debugger.sendCommand({ tabId }, method, params)
}

export async function detach(tabId: number): Promise<void> {
  if (!attached.has(tabId)) return
  try {
    await chrome.debugger.detach({ tabId })
  } catch {
    // ignore
  }
  attached.delete(tabId)
}

// ---- Mouse ----

export async function clickAt(tabId: number, x: number, y: number): Promise<void> {
  await ensureAttached(tabId)
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
}

export async function drag(
  tabId: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Promise<void> {
  await ensureAttached(tabId)
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 })
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: x1,
    y: y1,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
    button: 'left',
    buttons: 1,
  })
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: x2,
    y: y2,
    button: 'left',
    buttons: 1,
  })
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: x2,
    y: y2,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
}

// ---- Keyboard ----

interface KeyDef {
  code: string
  vk: number
  text?: string
}

const KEY_TABLE: Record<string, KeyDef> = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Tab: { code: 'Tab', vk: 9 },
  Escape: { code: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', vk: 8 },
  Delete: { code: 'Delete', vk: 46 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  Home: { code: 'Home', vk: 36 },
  End: { code: 'End', vk: 35 },
  PageUp: { code: 'PageUp', vk: 33 },
  PageDown: { code: 'PageDown', vk: 34 },
  ' ': { code: 'Space', vk: 32, text: ' ' },
}

function modifierMask(mods: string[]): number {
  let m = 0
  if (mods.includes('Alt')) m |= 1
  if (mods.includes('Control')) m |= 2
  if (mods.includes('Meta')) m |= 4
  if (mods.includes('Shift')) m |= 8
  return m
}

export async function pressKey(
  tabId: number,
  key: string,
  modifiers: string[] = [],
): Promise<void> {
  await ensureAttached(tabId)
  const mask = modifierMask(modifiers)
  const entry = KEY_TABLE[key]
  const isPrintable = !entry && [...key].length === 1
  const keyParams = entry
    ? { key, code: entry.code, windowsVirtualKeyCode: entry.vk, nativeVirtualKeyCode: entry.vk }
    : { key }

  await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', modifiers: mask, ...keyParams })
  // Emit the character for keys that produce text (and printable single chars), unless a
  // non-text modifier (Ctrl/Meta/Alt) is held — those are shortcuts, not text entry.
  const textOnly = mask === 0 || mask === 8 // none, or Shift only
  if (textOnly) {
    if (entry?.text) {
      await send(tabId, 'Input.dispatchKeyEvent', { type: 'char', key, text: entry.text })
    } else if (isPrintable) {
      await send(tabId, 'Input.dispatchKeyEvent', { type: 'char', key, text: key })
    }
  }
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', modifiers: mask, ...keyParams })
}

/** Insert text into the focused element as trusted input. */
export async function insertText(tabId: number, text: string): Promise<void> {
  await ensureAttached(tabId)
  await send(tabId, 'Input.insertText', { text })
}

/** Select-all in the focused field (platform-aware modifier), to replace its value. */
export async function selectAll(tabId: number): Promise<void> {
  await ensureAttached(tabId)
  const os = await getOs()
  const mask = os === 'mac' ? 4 : 2 // Meta on macOS, Control elsewhere
  const params = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 }
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', modifiers: mask, ...params })
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', modifiers: mask, ...params })
}
