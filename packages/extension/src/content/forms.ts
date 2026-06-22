import type { FormField, FormGroup, FormOption, FormsState } from 'monkeysee-protocol'
import { FORM_INDEX_BASE, FRAME_STRIDE } from 'monkeysee-protocol'
import { accessibleName, setHandle } from './handles'
import { frameOffset, intersectsViewport, isVisible, viewportDistance, visibleBox } from './indexer'

const DEFAULT_LIMIT = 150

/** ARIA roles that behave like form controls but may be built from non-native elements. */
const ARIA_ROLES = new Set([
  'combobox',
  'listbox',
  'checkbox',
  'radio',
  'switch',
  'textbox',
  'spinbutton',
  'slider',
  'searchbox',
])

type Kind = FormField['kind']

interface Classification {
  kind: Kind
  type?: string
  role?: string
}

/** Decide whether an element is a fillable control, and how to classify it. */
function classify(el: Element): Classification | null {
  const tag = el.localName
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    if (type === 'hidden') return null
    if (type === 'checkbox') return { kind: 'checkbox' }
    if (type === 'radio') return { kind: 'radio' }
    if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') {
      return { kind: 'button', type }
    }
    if (type === 'file') return { kind: 'file', type: 'file' }
    // 'text' is the default and carries no extra signal; richer types (email/tel/...) do.
    return { kind: 'text', type: type === 'text' ? undefined : type }
  }
  if (tag === 'textarea') return { kind: 'textarea' }
  if (tag === 'select') return { kind: 'select' }
  const ce = el.getAttribute('contenteditable')
  if (ce !== null && ce !== 'false') return { kind: 'contenteditable' }
  const role = el.getAttribute('role')?.trim()
  if (role && ARIA_ROLES.has(role)) return { kind: 'custom', role }
  return null
}

/**
 * Walk the DOM depth-first, descending into every OPEN shadow root (closed roots are
 * invisible to a content script). `querySelectorAll('*')` stays within its own tree and
 * does not cross shadow boundaries, so recursing per host visits each element exactly once.
 */
function walk(root: ParentNode, visit: (el: Element) => void): void {
  for (const el of root.querySelectorAll('*')) {
    visit(el)
    const shadow = (el as Element).shadowRoot
    if (shadow) walk(shadow, visit)
  }
}

/** Climb to the nearest enclosing <form>, crossing open shadow boundaries via the host. */
function formOf(el: Element): HTMLFormElement | null {
  let node: Element | null = el
  while (node) {
    const form = node.closest('form')
    if (form) return form as HTMLFormElement
    const rootNode = node.getRootNode()
    node = rootNode instanceof ShadowRoot ? rootNode.host : null
  }
  return null
}

function legendText(el: Element): string | undefined {
  const t = el
    .closest('fieldset')
    ?.querySelector('legend')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim()
  return t || undefined
}

function nonEmpty(v: string | null): string | undefined {
  return v && v.trim() ? v.trim() : undefined
}

function fieldValue(el: Element, kind: Kind): string | undefined {
  if (kind === 'text' || kind === 'textarea' || kind === 'select') {
    return (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
  }
  if (kind === 'contenteditable') {
    return (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  }
  if (kind === 'custom') {
    return el.getAttribute('aria-valuetext') ?? el.getAttribute('aria-valuenow') ?? undefined
  }
  return undefined
}

function fieldChecked(el: Element, kind: Kind, role: string | undefined): boolean | undefined {
  if (kind === 'checkbox' || kind === 'radio') return (el as HTMLInputElement).checked
  if (kind === 'custom' && (role === 'checkbox' || role === 'radio' || role === 'switch')) {
    return el.getAttribute('aria-checked') === 'true'
  }
  return undefined
}

function selectOptions(el: HTMLSelectElement): FormOption[] {
  return Array.from(el.options).map(o => ({
    value: o.value,
    label: (o.textContent ?? o.label ?? '').replace(/\s+/g, ' ').trim(),
    selected: o.selected,
  }))
}

function interactionFor(kind: Kind): 'value' | 'click' {
  return kind === 'text' || kind === 'textarea' || kind === 'select' || kind === 'contenteditable'
    ? 'value'
    : 'click'
}

interface Built {
  field: FormField
  formEl: HTMLFormElement | null
  /** Native-radio group name (for collapsing), else null. */
  radioName: string | null
  /** Native-radio `value` attribute, kept so the collapsed option can carry it. */
  radioValue?: string
  /** Nearest fieldset legend, used as the collapsed radio group's label. */
  legend?: string
  inViewport: boolean
  distance: number
}

/**
 * Build a FormsState for this frame. The SW stamps the real tabId and merges frames; here
 * tabId is a placeholder 0. Indices live in the form-tool partition so they never alias a
 * `get_state` index, yet remain directly actionable via the existing action tools.
 */
export function buildFormsState(
  frameId: number,
  params: { includeHidden?: boolean; includeBoxes?: boolean; limit?: number },
  loading = false,
): FormsState {
  const includeHidden = params.includeHidden ?? false
  const includeBoxes = params.includeBoxes ?? false
  const limit = Math.max(1, params.limit ?? DEFAULT_LIMIT)
  const off = frameOffset()
  const base = frameId * FRAME_STRIDE + FORM_INDEX_BASE

  const builts: Built[] = []
  let localId = 0

  walk(document, el => {
    const cls = classify(el)
    if (!cls) return
    const rect = el.getBoundingClientRect()
    if (!includeHidden && !isVisible(el, rect)) return

    const index = base + localId++
    const legend = legendText(el)
    const label = accessibleName(el) || legend || ''
    setHandle(index, el, label)

    const field: FormField = {
      index,
      frameId,
      kind: cls.kind,
      type: cls.type,
      role: cls.role,
      label,
      name: nonEmpty(el.getAttribute('name')),
      id: nonEmpty(el.getAttribute('id')),
      autocomplete: nonEmpty(el.getAttribute('autocomplete')),
      placeholder: nonEmpty(el.getAttribute('placeholder')),
      value: fieldValue(el, cls.kind),
      checked: fieldChecked(el, cls.kind, cls.role),
      options: cls.kind === 'select' ? selectOptions(el as HTMLSelectElement) : undefined,
      required:
        (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true'
          ? true
          : undefined,
      disabled:
        (el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true'
          ? true
          : undefined,
      readonly:
        (el as HTMLInputElement).readOnly || el.getAttribute('aria-readonly') === 'true'
          ? true
          : undefined,
      interaction: interactionFor(cls.kind),
      requiresTrustedInput: cls.kind === 'contenteditable' ? true : undefined,
      box: includeBoxes ? visibleBox(rect, off) : undefined,
      inViewport: includeBoxes ? intersectsViewport(rect) : undefined,
    }

    builts.push({
      field,
      formEl: formOf(el),
      radioName: cls.kind === 'radio' ? (el.getAttribute('name') ?? '') : null,
      radioValue: cls.kind === 'radio' ? (el as HTMLInputElement).value : undefined,
      legend,
      inViewport: intersectsViewport(rect),
      distance: viewportDistance(rect),
    })
  })

  const collapsed = collapseRadios(builts)

  // Rank in-viewport first, then nearest-to-viewport (mirrors get_state) before capping.
  collapsed.sort((a, b) => {
    if (a.inViewport !== b.inViewport) return a.inViewport ? -1 : 1
    return a.distance - b.distance
  })
  const capped = collapsed.slice(0, limit)

  // Group by <form>, preserving first-seen order; fields with no form become orphans.
  const groups = new Map<HTMLFormElement, FormField[]>()
  const orphans: FormField[] = []
  for (const b of capped) {
    if (b.formEl) {
      const arr = groups.get(b.formEl)
      if (arr) arr.push(b.field)
      else groups.set(b.formEl, [b.field])
    } else {
      orphans.push(b.field)
    }
  }
  const forms: FormGroup[] = Array.from(groups, ([formEl, fields]) => ({
    name: nonEmpty(formEl.getAttribute('id')) ?? nonEmpty(formEl.getAttribute('name')),
    action: nonEmpty(formEl.getAttribute('action')),
    method: nonEmpty(formEl.getAttribute('method')),
    fields,
  }))

  return {
    tabId: 0,
    url: location.href,
    title: document.title,
    forms,
    orphans,
    loading,
  }
}

/**
 * Merge native radios sharing a (form, name) into one `kind:'radio'` field whose `options[]`
 * each carry their own clickable index + selected flag. The first radio of a group anchors
 * the merged field; its top-level `value` tracks the currently-selected option.
 */
function collapseRadios(builts: Built[]): Built[] {
  const anchors = new Map<HTMLFormElement | null, Map<string, Built>>()
  const out: Built[] = []
  for (const b of builts) {
    if (b.radioName === null) {
      out.push(b)
      continue
    }
    const opt: FormOption = {
      value: b.radioValue ?? '',
      label: b.field.label,
      selected: b.field.checked === true,
      index: b.field.index,
    }
    let byName = anchors.get(b.formEl)
    if (!byName) {
      byName = new Map()
      anchors.set(b.formEl, byName)
    }
    const anchor = byName.get(b.radioName)
    if (anchor) {
      anchor.field.options!.push(opt)
      if (opt.selected) anchor.field.value = opt.value
      // The anchor keeps the earliest in-viewport/closest geometry for ranking.
      anchor.inViewport = anchor.inViewport || b.inViewport
      anchor.distance = Math.min(anchor.distance, b.distance)
    } else {
      b.field.options = [opt]
      // A group's own label is its fieldset legend or its name — not one option's text.
      b.field.label = b.legend ?? b.radioName
      b.field.value = opt.selected ? opt.value : undefined
      delete b.field.checked
      byName.set(b.radioName, b)
      out.push(b)
    }
  }
  return out
}
