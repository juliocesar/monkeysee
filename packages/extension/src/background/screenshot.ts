/**
 * Visual fallback (M2). Captures the controlled tab's visible viewport as a PNG via
 * `chrome.tabs.captureVisibleTab` and, for set-of-marks, overlays numbered boxes at each
 * element's position. `captureVisibleTab` returns DEVICE pixels, so element boxes (CSS px,
 * top-viewport-relative) are scaled by `viewport.dpr` before drawing. Rendering uses
 * `OffscreenCanvas`, which is available in the MV3 service worker.
 */

import type { PageState } from '@monkeysee/protocol'

/** Capture the visible viewport of `tabId`'s window as a base64 PNG (no data: prefix). */
export async function capture(tabId: number): Promise<string> {
  const dataUrl = await captureDataUrl(tabId)
  return stripDataUrl(dataUrl)
}

/** Capture the viewport and overlay numbered marks at the in-viewport element boxes. */
export async function captureWithMarks(tabId: number, state: PageState): Promise<string> {
  const dataUrl = await captureDataUrl(tabId)
  const blob = await (await fetch(dataUrl)).blob()
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return stripDataUrl(dataUrl)
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const dpr = state.viewport.dpr || 1
  ctx.lineWidth = Math.max(1, Math.round(dpr))
  ctx.font = `${Math.round(12 * dpr)}px sans-serif`
  ctx.textBaseline = 'top'

  for (const el of state.elements) {
    if (!el.inViewport) continue
    const [x, y, w, h] = el.box
    const rx = x * dpr
    const ry = y * dpr
    ctx.strokeStyle = '#ff0000'
    ctx.strokeRect(rx, ry, w * dpr, h * dpr)

    const label = String(el.index)
    const padX = 3 * dpr
    const padY = 2 * dpr
    const tw = ctx.measureText(label).width
    const lh = 14 * dpr
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(rx, ry, tw + padX * 2, lh + padY * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, rx + padX, ry + padY)
  }

  const out = await canvas.convertToBlob({ type: 'image/png' })
  return blobToBase64(await out.arrayBuffer())
}

async function captureDataUrl(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId)
  if (tab.windowId === undefined) throw new Error('screenshot: tab has no window')
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
}

function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
}

/** Base64-encode an ArrayBuffer in chunks (avoids arg-count overflow on large images). */
function blobToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
