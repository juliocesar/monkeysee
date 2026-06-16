import type { Box, ElementHandle, PageState } from '@monkeysee/protocol'
import { FRAME_STRIDE } from '@monkeysee/protocol'
import { accessibleName, clearHandles, roleOf, setHandle } from './handles'

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[role]',
  '[tabindex]',
  '[contenteditable]',
  '[onclick]',
].join(',')

const STRUCTURAL_SELECTOR = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', '[role=heading]'].join(',')

const DEFAULT_LIMIT = 200

/**
 * Offset of this frame's viewport origin within the TOP document's viewport, in CSS px.
 * Sums the `frameElement` rects up the parent chain (same-origin only — the SW only ever
 * asks same-origin frames). Returns {0,0} for the top frame or if a cross-origin ancestor
 * blocks access, so callers always get top-viewport coordinates when it matters.
 */
export function frameOffset(): { x: number; y: number } {
  let x = 0
  let y = 0
  try {
    let win: Window = window
    while (win !== win.parent) {
      const fe = win.frameElement
      if (!fe) break
      const r = fe.getBoundingClientRect()
      x += r.left
      y += r.top
      win = win.parent
    }
  } catch {
    // cross-origin ancestor — can't compute; fall back to frame-local (top frame is {0,0}).
  }
  return { x, y }
}

interface Candidate {
  el: Element
  role: string
  name: string
  value: string | undefined
  box: Box
  inViewport: boolean
  /** Distance from the viewport (0 if intersecting), for ranking when over limit. */
  distance: number
}

function isVisible(el: Element, rect: DOMRect): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false
  const style = getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  if (Number(style.opacity) === 0) return false
  // Fully off-screen in either axis (allow partially visible).
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (rect.bottom < 0 || rect.right < 0 || rect.top > vh || rect.left > vw) {
    // Off the current viewport but may still be on the page; keep if within the document.
    // We still index it (agent can scroll), but mark not-in-viewport. Reject only if
    // it has zero geometry which is handled above.
  }
  return true
}

function intersectsViewport(rect: DOMRect): boolean {
  const vw = window.innerWidth
  const vh = window.innerHeight
  return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw
}

function viewportDistance(rect: DOMRect): number {
  const vh = window.innerHeight
  if (rect.top >= 0 && rect.bottom <= vh) return 0
  if (rect.bottom < 0) return -rect.bottom
  if (rect.top > vh) return rect.top - vh
  return 0
}

function inputValue(el: Element): string | undefined {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value
  if (el instanceof HTMLSelectElement) return el.value
  return undefined
}

/**
 * Build a PageState for this frame. The SW stamps the real tabId and merges frames;
 * here tabId is a placeholder 0.
 */
export function buildPageState(frameId: number, limit = DEFAULT_LIMIT, loading = false): PageState {
  clearHandles()

  const nodes = new Set<Element>()
  for (const el of document.querySelectorAll(INTERACTIVE_SELECTOR)) nodes.add(el)
  for (const el of document.querySelectorAll(STRUCTURAL_SELECTOR)) nodes.add(el)

  // Offset to the top viewport so boxes from iframes share one coordinate space with the
  // top frame (used by set-of-marks and the trusted/debugger backend). {0,0} for the top.
  const off = frameOffset()

  const candidates: Candidate[] = []
  for (const el of nodes) {
    const rect = el.getBoundingClientRect()
    if (!isVisible(el, rect)) continue
    // Skip if an interactive ancestor is also in our set (avoid duplicate wrappers).
    if (hasIndexedInteractiveAncestor(el, nodes)) continue

    // Visibility/ranking stay frame-local; the reported box is in top-viewport coords.
    const box: Box = [
      round(rect.left + off.x),
      round(rect.top + off.y),
      round(rect.width),
      round(rect.height),
    ]
    candidates.push({
      el,
      role: roleOf(el),
      name: accessibleName(el),
      value: inputValue(el),
      box,
      inViewport: intersectsViewport(rect),
      distance: viewportDistance(rect),
    })
  }

  // Rank: in-viewport first, then nearest-to-viewport. Document order within a tier.
  candidates.sort((a, b) => {
    if (a.inViewport !== b.inViewport) return a.inViewport ? -1 : 1
    return a.distance - b.distance
  })

  const capped = candidates.slice(0, Math.max(1, limit))

  const elements: ElementHandle[] = capped.map((c, i) => {
    const index = frameId * FRAME_STRIDE + i
    setHandle(index, c.el, c.name)
    return {
      index,
      frameId,
      role: c.role,
      name: c.name,
      value: c.value,
      box: c.box,
      inViewport: c.inViewport,
    }
  })

  return {
    tabId: 0,
    url: location.href,
    title: document.title,
    viewport: {
      w: window.innerWidth,
      h: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      dpr: window.devicePixelRatio,
    },
    elements,
    loading,
  }
}

function hasIndexedInteractiveAncestor(el: Element, set: Set<Element>): boolean {
  let parent = el.parentElement
  while (parent) {
    if (set.has(parent) && isInteractiveTag(parent)) return true
    parent = parent.parentElement
  }
  return false
}

function isInteractiveTag(el: Element): boolean {
  const tag = el.localName
  if (tag === 'a' && el.hasAttribute('href')) return true
  return tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'input'
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

/** Extract readable text for the whole page or a subtree at an index. */
export function extractText(el: Element | null): string {
  const root = el ?? document.body
  if (!root) return ''
  // Prefer <main> / [role=main] / <article> for whole-page extraction.
  let target: Element = root
  if (root === document.body) {
    target = document.querySelector('main, [role=main], article') ?? document.body
  }
  const text = (target as HTMLElement).innerText ?? target.textContent ?? ''
  return text.replace(/\n{3,}/g, '\n\n').trim()
}
