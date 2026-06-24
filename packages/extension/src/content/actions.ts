import type { RpcError } from 'monkeysee-protocol'
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

/** Write `value` through the native setter so React's value tracker notices the change. */
function assignNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  assignNativeValue(el, value)
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

// ---- Progressive ("cinematic") fill ----
//
// The human-watchable counterpart to the bridge's batch fill_fields: for each field, smooth-
// scroll it into view, then typewriter text input, open dropdowns to click the option, and
// toggle checkboxes/radios/switches — all paced so a screen recording reads naturally. The
// whole sequence runs here, in one RPC, to keep per-character timing off the wire.

type ProgressiveField = { index: number; value?: string; option?: string; checked?: boolean }

interface PaceProfile {
  /** Delay between typed characters (ms). */
  charDelay: number
  /** Pause after finishing one field before starting the next (ms). */
  fieldGap: number
  /** Time allowed for a smooth scroll to settle (ms). */
  scrollSettle: number
  /** How long to wait for a dropdown's portal listbox to appear (ms). */
  portalWait: number
  /** Beat before a click, so the action is visible (ms). */
  clickPause: number
}

const PACE: Record<'fast' | 'normal' | 'slow', PaceProfile> = {
  fast: { charDelay: 12, fieldGap: 120, scrollSettle: 260, portalWait: 700, clickPause: 70 },
  normal: { charDelay: 28, fieldGap: 320, scrollSettle: 320, portalWait: 800, clickPause: 130 },
  slow: { charDelay: 55, fieldGap: 600, scrollSettle: 420, portalWait: 900, clickPause: 220 },
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function smoothScrollIntoView(el: Element, settleMs: number): Promise<void> {
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  await sleep(settleMs)
}

/** Poll a predicate until it returns a truthy value or the deadline passes. */
async function waitFor<T>(fn: () => T | null | undefined, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() >= deadline) return null
    await sleep(30)
  }
}

/**
 * One visible click: the pointer/mouse sequence followed by a single activation. Unlike the
 * raw `click` action's `fireMouseSequence` + `el.click()`, this fires the click exactly once —
 * a double activation toggles an uncontrolled checkbox/switch straight back off.
 */
function performClick(el: Element): void {
  const { x, y } = centerOf(el)
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    view: window,
  }
  const ptr = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 }
  el.dispatchEvent(new PointerEvent('pointerover', ptr))
  el.dispatchEvent(new PointerEvent('pointerdown', ptr))
  el.dispatchEvent(new MouseEvent('mousedown', base))
  el.dispatchEvent(new PointerEvent('pointerup', ptr))
  el.dispatchEvent(new MouseEvent('mouseup', base))
  if (el instanceof HTMLElement) el.click()
  else el.dispatchEvent(new MouseEvent('click', base))
}

/** Current checked state of a checkbox/radio/switch — native (`.checked`) or ARIA. */
function isChecked(el: Element): boolean {
  if (el instanceof HTMLInputElement) return el.checked
  return el.getAttribute('aria-checked') === 'true'
}

async function typewriter(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  charDelay: number,
): Promise<void> {
  el.focus()
  assignNativeValue(el, '')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  let acc = ''
  for (const ch of text) {
    acc += ch
    assignNativeValue(el, acc)
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }))
    await sleep(charDelay)
  }
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

async function typewriterContentEditable(
  el: HTMLElement,
  text: string,
  charDelay: number,
): Promise<void> {
  el.focus()
  el.textContent = ''
  let acc = ''
  for (const ch of text) {
    acc += ch
    el.textContent = acc
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }))
    await sleep(charDelay)
  }
}

/**
 * A field's index may point at either the visible combobox trigger or the hidden native
 * `<select>` that a shadcn/Radix Select keeps in sync. From whichever we resolved, find the
 * other half by searching a few ancestors of the common Select container.
 */
function findRadixSelect(el: Element): {
  trigger: HTMLElement | null
  nativeSelect: HTMLSelectElement | null
} {
  let trigger: HTMLElement | null = null
  let nativeSelect: HTMLSelectElement | null = el instanceof HTMLSelectElement ? el : null
  const comboboxSelf = el.closest('[role="combobox"]')
  if (comboboxSelf instanceof HTMLElement) trigger = comboboxSelf

  let scope: Element | null = el
  for (let i = 0; i < 4 && scope && (!trigger || !nativeSelect); i++) {
    if (!trigger) {
      const t = scope.querySelector('[role="combobox"]')
      if (t instanceof HTMLElement) trigger = t
    }
    if (!nativeSelect) {
      const s = scope.querySelector('select')
      if (s instanceof HTMLSelectElement) nativeSelect = s
    }
    scope = scope.parentElement
  }
  return { trigger, nativeSelect }
}

function optionLabelForValue(select: HTMLSelectElement, value: string): string | null {
  const opt = Array.from(select.options).find(o => o.value === value)
  return opt ? (opt.textContent ?? '').trim() : null
}

function listboxOpen(): Element | null {
  return document.querySelector('[role="listbox"]')
}

async function closeAnyOpenListbox(): Promise<void> {
  const lb = listboxOpen()
  if (!lb) return
  lb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await waitFor(() => (listboxOpen() ? null : true), 400)
}

/** Find the option in the currently-open listbox whose text matches `want` (lowercased). */
function findOption(want: string): HTMLElement | null {
  const lb = listboxOpen()
  if (!lb) return null
  const opts = Array.from(lb.querySelectorAll<HTMLElement>('[role="option"]'))
  return (
    opts.find(o => (o.textContent ?? '').trim().toLowerCase() === want) ??
    opts.find(o => (o.textContent ?? '').trim().toLowerCase().includes(want)) ??
    null
  )
}

/** Hover + full pointer/mouse click on an option (how Radix expects a mouse selection). */
function selectByPointer(item: HTMLElement): void {
  const { x, y } = centerOf(item)
  const ptr = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    view: window,
  }
  item.dispatchEvent(new PointerEvent('pointerover', ptr))
  item.dispatchEvent(new PointerEvent('pointermove', ptr))
  fireMouseSequence(item, x, y)
}

/** Focus the option and press Enter — Radix selects the focused item on a selection key. */
function selectByKeyboard(item: HTMLElement): void {
  item.focus()
  const key = { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, composed: true }
  item.dispatchEvent(new KeyboardEvent('keydown', key))
  item.dispatchEvent(new KeyboardEvent('keyup', key))
}

/**
 * Granular dropdown fill: open the combobox and click the matching option, the way a person
 * would. Radix Select's content guards can swallow a synthetic option click (leaving the menu
 * stranded open), so we verify the listbox actually closed and escalate: pointer click →
 * keyboard select → setting the hidden native `<select>` (which Radix mirrors back into the
 * visible trigger). Maps the requested `value` to its visible option label via that select.
 */
async function pickFromCombobox(el: Element, value: string, pace: PaceProfile): Promise<void> {
  const { trigger, nativeSelect } = findRadixSelect(el)

  // No openable combobox (a plain native <select>): set the value directly.
  if (!trigger) {
    if (nativeSelect) {
      nativeSelect.value = value
      nativeSelect.dispatchEvent(new Event('change', { bubbles: true }))
      return
    }
    throw new ContentError({
      code: 'not_found',
      message: 'No combobox or <select> to choose from.',
    })
  }

  const label = nativeSelect ? optionLabelForValue(nativeSelect, value) : null
  const want = (label ?? value).trim().toLowerCase()

  const commitNative = (): void => {
    if (!nativeSelect) return
    nativeSelect.value = value
    nativeSelect.dispatchEvent(new Event('change', { bubbles: true }))
  }

  await closeAnyOpenListbox()
  await smoothScrollIntoView(trigger, pace.scrollSettle)
  await sleep(pace.clickPause)
  trigger.focus()
  performClick(trigger)

  const listbox = await waitFor(listboxOpen, pace.portalWait)
  if (!listbox) {
    // Couldn't open it visually — still get the value in via the native select.
    commitNative()
    return
  }

  const match = findOption(want)
  if (!match) {
    await closeAnyOpenListbox()
    throw new ContentError({
      code: 'not_found',
      message: `No dropdown option matching "${label ?? value}".`,
    })
  }

  match.scrollIntoView({ block: 'nearest' })
  await sleep(pace.clickPause)
  selectByPointer(match)

  // Verify the pointer selection committed (the listbox tears down on select). If Radix
  // swallowed it, escalate to keyboard selection on a freshly-found option, then native.
  if (await waitFor(() => (listboxOpen() ? null : true), 250)) return

  const again = findOption(want)
  if (again) {
    selectByKeyboard(again)
    if (await waitFor(() => (listboxOpen() ? null : true), 250)) return
  }

  await closeAnyOpenListbox()
  commitNative()
}

export async function fillProgressive(p: {
  fields: ProgressiveField[]
  pace?: 'fast' | 'normal' | 'slow'
}): Promise<{ results: Array<{ index: number; ok: boolean; error?: string }> }> {
  const pace = PACE[p.pace ?? 'fast']
  const results: Array<{ index: number; ok: boolean; error?: string }> = []

  for (const f of p.fields) {
    try {
      const el = mustResolve(f.index)

      if (typeof f.option === 'string') {
        // pickFromCombobox scrolls the (possibly different) trigger into view itself.
        await pickFromCombobox(el, f.option, pace)
      } else if (typeof f.checked === 'boolean') {
        await smoothScrollIntoView(el, pace.scrollSettle)
        if (isChecked(el) !== f.checked) {
          if (el instanceof HTMLElement) el.focus()
          await sleep(pace.clickPause)
          performClick(el)
        }
      } else if (typeof f.value === 'string') {
        await smoothScrollIntoView(el, pace.scrollSettle)
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          await typewriter(el, f.value, pace.charDelay)
        } else if (el instanceof HTMLElement && el.isContentEditable) {
          await typewriterContentEditable(el, f.value, pace.charDelay)
        } else {
          throw new ContentError({
            code: 'not_found',
            message: `Element ${f.index} is not a text input.`,
          })
        }
      } else {
        throw new ContentError({
          code: 'internal',
          message: 'field has none of value/option/checked',
        })
      }
      results.push({ index: f.index, ok: true })
    } catch (e) {
      const error =
        e instanceof ContentError ? e.rpc.message : e instanceof Error ? e.message : String(e)
      results.push({ index: f.index, ok: false, error })
    }
    await sleep(pace.fieldGap)
  }

  return { results }
}
