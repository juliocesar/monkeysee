/**
 * Element handle registry + DOM helpers. The registry maps a PageState `index` to
 * a live Element plus a re-resolvable structural descriptor, so an action can detect
 * staleness and recover instead of clicking the wrong node.
 */

interface HandleEntry {
  el: Element
  /** Structural selector from <html>, for re-resolution after DOM churn. */
  path: string
  /** Accessible name at snapshot time, used to disambiguate re-resolution. */
  name: string
}

const registry = new Map<number, HandleEntry>()

export function clearHandles(): void {
  registry.clear()
}

export function setHandle(index: number, el: Element, name: string): void {
  registry.set(index, { el, path: cssPath(el), name })
}

/**
 * Resolve an index to a live Element. If the original node has detached, try to
 * re-resolve via its structural path + accessible name. Returns null if it cannot
 * be confidently recovered (caller should report stale_handle).
 */
export function resolveHandle(index: number): Element | null {
  const entry = registry.get(index)
  if (!entry) return null
  if (entry.el.isConnected) return entry.el
  try {
    const candidates = Array.from(document.querySelectorAll(entry.path))
    if (candidates.length === 1 && candidates[0]) {
      entry.el = candidates[0]
      return candidates[0]
    }
    for (const c of candidates) {
      if (accessibleName(c) === entry.name) {
        entry.el = c
        return c
      }
    }
  } catch {
    // invalid selector — fall through to stale
  }
  return null
}

/** Build a structural CSS path from <html> down, using :nth-of-type segments. */
export function cssPath(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    const tag = node.localName
    const parent: Element | null = node.parentElement
    if (!parent) {
      parts.unshift(tag)
      break
    }
    const siblings = Array.from(parent.children).filter(c => c.localName === tag)
    const idx = siblings.indexOf(node) + 1
    parts.unshift(`${tag}:nth-of-type(${idx})`)
    node = parent
  }
  return parts.join(' > ')
}

/** Compute the accessible name following a pragmatic subset of the ARIA algorithm. */
export function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label')
  if (aria && aria.trim()) return aria.trim()

  const labelledby = el.getAttribute('aria-labelledby')
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map(id => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) return text
  }

  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    const labels = el.labels
    if (labels && labels.length) {
      const text = Array.from(labels)
        .map(l => l.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text) return text
    }
    const placeholder = el.getAttribute('placeholder')
    if (placeholder && placeholder.trim()) return placeholder.trim()
  }

  const alt = el.getAttribute('alt')
  if (alt && alt.trim()) return alt.trim()

  const title = el.getAttribute('title')
  if (title && title.trim()) return title.trim()

  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text.slice(0, 120)
}

/** Map an element to a semantic role (ARIA role wins, else tag-derived). */
export function roleOf(el: Element): string {
  const explicit = el.getAttribute('role')
  if (explicit && explicit.trim()) return explicit.trim()

  const tag = el.localName
  switch (tag) {
    case 'a':
      return el.hasAttribute('href') ? 'link' : 'generic'
    case 'button':
      return 'button'
    case 'select':
      return 'combobox'
    case 'textarea':
      return 'textbox'
    case 'input': {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase()
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button'
      if (type === 'range') return 'slider'
      if (type === 'search') return 'searchbox'
      return 'textbox'
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading'
    case 'li':
      return 'listitem'
    default:
      if (el.hasAttribute('contenteditable')) return 'textbox'
      return 'generic'
  }
}
