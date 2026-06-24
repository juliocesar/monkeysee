import { isContentRequest, type ContentRequest, type ContentResponse } from '../shared/messages'
import { buildPageState, extractText, frameOffset } from './indexer'
import { buildFormsState } from './forms'
import { resolveHandle } from './handles'
import * as actions from './actions'
import { ContentError } from './actions'

function waitQuiet(quietMs: number, timeoutMs: number): Promise<{ ok: true }> {
  return new Promise(resolve => {
    let quietTimer: ReturnType<typeof setTimeout>
    const finish = () => {
      obs.disconnect()
      clearTimeout(quietTimer)
      clearTimeout(deadline)
      resolve({ ok: true })
    }
    const obs = new MutationObserver(() => {
      clearTimeout(quietTimer)
      quietTimer = setTimeout(finish, quietMs)
    })
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
    quietTimer = setTimeout(finish, quietMs)
    const deadline = setTimeout(finish, timeoutMs)
  })
}

async function dispatch(req: ContentRequest): Promise<unknown> {
  const p = (req.params ?? {}) as Record<string, unknown>
  switch (req.method) {
    case 'ping':
      return 'pong'
    case 'wait_quiet':
      return waitQuiet((p.quietMs as number) ?? 500, (p.timeoutMs as number) ?? 10_000)
    case 'locate': {
      // Resolve an index to viewport coordinates for the trusted (debugger) backend.
      const el = resolveHandle(p.index as number)
      if (!el) {
        throw new ContentError({
          code: 'stale_handle',
          message: `Element ${p.index} is gone.`,
        })
      }
      el.scrollIntoView({ block: 'center', inline: 'center' })
      const r = el.getBoundingClientRect()
      // Return top-viewport coords so the SW's CDP backend dispatches at the right pixel
      // even for elements inside a same-origin iframe.
      const off = frameOffset()
      return {
        x: r.left + off.x + r.width / 2,
        y: r.top + off.y + r.height / 2,
        box: [r.left + off.x, r.top + off.y, r.width, r.height],
      }
    }
    case 'get_state':
      return buildPageState(
        req.frameId,
        p.limit as number | undefined,
        (p.loading as boolean) ?? false,
      )
    case 'get_forms':
      return buildFormsState(
        req.frameId,
        {
          includeHidden: p.includeHidden as boolean | undefined,
          includeBoxes: p.includeBoxes as boolean | undefined,
          limit: p.limit as number | undefined,
        },
        (p.loading as boolean) ?? false,
      )
    case 'extract_text': {
      const index = p.index as number | undefined
      const el = index === undefined ? null : resolveHandle(index)
      if (index !== undefined && !el) {
        throw new ContentError({ code: 'stale_handle', message: `Element ${index} is gone.` })
      }
      return { text: extractText(el) }
    }
    case 'click':
      return actions.click(p as { index: number })
    case 'type':
      return actions.type(p as { index: number; text: string })
    case 'select_option':
      return actions.selectOption(p as { index: number; value: string })
    case 'fill_progressive':
      return actions.fillProgressive(
        p as {
          fields: Array<{ index: number; value?: string; option?: string; checked?: boolean }>
          pace?: 'fast' | 'normal' | 'slow'
        },
      )
    case 'hover':
      return actions.hover(p as { index: number })
    case 'focus':
      return actions.focus(p as { index: number })
    case 'click_at':
      return actions.clickAt(p as { x: number; y: number })
    case 'scroll':
      return actions.scroll(p as { direction: 'up' | 'down' | 'left' | 'right'; amount?: number })
    case 'scroll_to':
      return actions.scrollTo(p as { index: number })
    case 'drag':
      return actions.drag(p as { x1: number; y1: number; x2: number; y2: number })
    case 'press':
      return actions.press(
        p as { key: string; modifiers?: Array<'Control' | 'Alt' | 'Shift' | 'Meta'> },
      )
    case 'type_text':
      return actions.typeText(p as { text: string })
    default:
      throw new ContentError({ code: 'internal', message: `Unknown method ${String(req.method)}` })
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isContentRequest(msg)) return false
  dispatch(msg)
    .then(result => sendResponse({ ok: true, result } satisfies ContentResponse))
    .catch((e: unknown) => {
      const error =
        e instanceof ContentError
          ? e.rpc
          : { code: 'internal' as const, message: e instanceof Error ? e.message : String(e) }
      sendResponse({ ok: false, error } satisfies ContentResponse)
    })
  return true // keep the channel open for the async response
})
