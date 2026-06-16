import type { RpcError } from '@monkeysee/protocol'
import { resolveHandle } from './handles'

/** Error carrying a structured RpcError code, surfaced back to the agent. */
export class ContentError extends Error {
  constructor(public readonly rpc: RpcError) {
    super(rpc.message)
    this.name = 'ContentError'
  }
}

function stale(index: number): never {
  throw new ContentError({
    code: 'stale_handle',
    message: `Element ${index} is no longer on the page.`,
  })
}

function mustResolve(index: number): Element {
  const el = resolveHandle(index)
  if (!el) stale(index)
  return el
}

function centerOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function fireMouseSequence(el: Element, x: number, y: number): void {
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    view: window,
  }
  const ptr = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }
  el.dispatchEvent(new PointerEvent('pointerover', ptr))
  el.dispatchEvent(new PointerEvent('pointerdown', ptr))
  el.dispatchEvent(new MouseEvent('mousedown', base))
  el.dispatchEvent(new PointerEvent('pointerup', ptr))
  el.dispatchEvent(new MouseEvent('mouseup', base))
  el.dispatchEvent(new MouseEvent('click', base))
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

export function click(p: { index: number }): { ok: true } {
  const el = mustResolve(p.index)
  el.scrollIntoView({ block: 'center', inline: 'center' })
  const { x, y } = centerOf(el)
  fireMouseSequence(el, x, y)
  if (el instanceof HTMLElement) el.click()
  return { ok: true }
}

export function type(p: { index: number; text: string }): { ok: true } {
  const el = mustResolve(p.index)
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus()
    setNativeValue(el, p.text)
    return { ok: true }
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    el.focus()
    el.textContent = p.text
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true }
  }
  throw new ContentError({
    code: 'not_found',
    message: `Element ${p.index} is not a text input.`,
  })
}

export function selectOption(p: { index: number; value: string }): { ok: true } {
  const el = mustResolve(p.index)
  if (!(el instanceof HTMLSelectElement)) {
    throw new ContentError({ code: 'not_found', message: `Element ${p.index} is not a <select>.` })
  }
  el.value = p.value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true }
}

export function hover(p: { index: number }): { ok: true } {
  const el = mustResolve(p.index)
  const { x, y } = centerOf(el)
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    view: window,
  }
  el.dispatchEvent(new PointerEvent('pointerover', { ...base, pointerId: 1, pointerType: 'mouse' }))
  el.dispatchEvent(new MouseEvent('mouseover', base))
  el.dispatchEvent(new MouseEvent('mousemove', base))
  return { ok: true }
}

export function focus(p: { index: number }): { ok: true } {
  const el = mustResolve(p.index)
  if (el instanceof HTMLElement) el.focus()
  return { ok: true }
}

export function clickAt(p: { x: number; y: number }): { ok: true } {
  const el = document.elementFromPoint(p.x, p.y)
  if (!el) {
    throw new ContentError({ code: 'not_found', message: `No element at (${p.x}, ${p.y}).` })
  }
  fireMouseSequence(el, p.x, p.y)
  if (el instanceof HTMLElement) el.click()
  return { ok: true }
}

export function scroll(p: { direction: 'up' | 'down' | 'left' | 'right'; amount?: number }): {
  ok: true
} {
  const v =
    p.amount ??
    (p.direction === 'left' || p.direction === 'right' ? window.innerWidth : window.innerHeight) *
      0.9
  const dx = p.direction === 'right' ? v : p.direction === 'left' ? -v : 0
  const dy = p.direction === 'down' ? v : p.direction === 'up' ? -v : 0
  window.scrollBy({ left: dx, top: dy, behavior: 'instant' as ScrollBehavior })
  return { ok: true }
}

export function scrollTo(p: { index: number }): { ok: true } {
  const el = mustResolve(p.index)
  el.scrollIntoView({ block: 'center', inline: 'center' })
  return { ok: true }
}

export function drag(p: { x1: number; y1: number; x2: number; y2: number }): { ok: true } {
  const from = document.elementFromPoint(p.x1, p.y1)
  const target = document.elementFromPoint(p.x2, p.y2)
  if (!from)
    throw new ContentError({ code: 'not_found', message: `No element at (${p.x1}, ${p.y1}).` })
  const mk = (type: string, x: number, y: number, el: Element) =>
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        view: window,
      }),
    )
  mk('pointerdown', p.x1, p.y1, from)
  mk('pointermove', (p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2, from)
  mk('pointermove', p.x2, p.y2, target ?? from)
  mk('pointerup', p.x2, p.y2, target ?? from)
  return { ok: true }
}

export function press(p: {
  key: string
  modifiers?: Array<'Control' | 'Alt' | 'Shift' | 'Meta'>
}): {
  ok: true
} {
  const mods = new Set(p.modifiers ?? [])
  const target: Element = (document.activeElement as Element | null) ?? document.body
  const init: KeyboardEventInit = {
    key: p.key,
    bubbles: true,
    cancelable: true,
    composed: true,
    ctrlKey: mods.has('Control'),
    altKey: mods.has('Alt'),
    shiftKey: mods.has('Shift'),
    metaKey: mods.has('Meta'),
  }
  target.dispatchEvent(new KeyboardEvent('keydown', init))
  target.dispatchEvent(new KeyboardEvent('keypress', init))
  target.dispatchEvent(new KeyboardEvent('keyup', init))
  return { ok: true }
}

export function typeText(p: { text: string }): { ok: true } {
  const target = document.activeElement
  if (!(target instanceof HTMLElement)) {
    throw new ContentError({ code: 'not_found', message: 'No focused element to type into.' })
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    setNativeValue(target, (target.value ?? '') + p.text)
    return { ok: true }
  }
  for (const ch of p.text) {
    const init: KeyboardEventInit = { key: ch, bubbles: true, cancelable: true, composed: true }
    target.dispatchEvent(new KeyboardEvent('keydown', init))
    target.dispatchEvent(new KeyboardEvent('keypress', init))
    if (target.isContentEditable) {
      target.textContent = (target.textContent ?? '') + ch
      target.dispatchEvent(new Event('input', { bubbles: true }))
    }
    target.dispatchEvent(new KeyboardEvent('keyup', init))
  }
  return { ok: true }
}
