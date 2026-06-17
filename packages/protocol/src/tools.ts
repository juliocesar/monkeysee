import { z } from 'zod'

/**
 * Optional explicit tab target shared by every tab-addressable tool. Omit it to operate on
 * the controlled tab (set by `open_tab`/`switch_tab`, else the active tab). Provide it to
 * target a specific tab from `list_tabs` without changing which tab is controlled.
 */
const tabTarget = { tabId: z.number().int().optional() }

export const GetStateParams = z.object({
  ...tabTarget,
  /** If true, also return a base64 screenshot with numbered marks (M2). */
  withScreenshot: z.boolean().optional(),
  /** Cap on returned elements (token control). Default 200. */
  limit: z.number().int().positive().optional(),
})

export const ClickParams = z.object({ ...tabTarget, index: z.number().int() })
export const TypeParams = z.object({ ...tabTarget, index: z.number().int(), text: z.string() })
export const SelectOptionParams = z.object({
  ...tabTarget,
  index: z.number().int(),
  value: z.string(),
})
export const HoverParams = z.object({ ...tabTarget, index: z.number().int() })
export const FocusParams = z.object({ ...tabTarget, index: z.number().int() })

export const ClickAtParams = z.object({ ...tabTarget, x: z.number(), y: z.number() })
export const ScrollParams = z.object({
  ...tabTarget,
  direction: z.enum(['up', 'down', 'left', 'right']),
  amount: z.number().optional(), // CSS px; default ~ viewport height
})
export const ScrollToParams = z.object({ ...tabTarget, index: z.number().int() })
export const DragParams = z.object({
  ...tabTarget,
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
})
export const PressParams = z.object({
  ...tabTarget,
  key: z.string(), // 'Enter', 'Tab', 'Escape', 'a', ...
  modifiers: z.array(z.enum(['Control', 'Alt', 'Shift', 'Meta'])).optional(),
})
export const TypeTextParams = z.object({ ...tabTarget, text: z.string() })

export const ScreenshotParams = z.object({ ...tabTarget })

export const OpenTabParams = z.object({ url: z.url() }) // zod 4: top-level z.url()
export const NavigateParams = z.object({ ...tabTarget, url: z.url() })
export const ExtractTextParams = z.object({ ...tabTarget, index: z.number().int().optional() })
export const WaitForLoadParams = z.object({ ...tabTarget, timeoutMs: z.number().int().optional() })

export const GoBackParams = z.object({ ...tabTarget })
export const GoForwardParams = z.object({ ...tabTarget })

/** Multi-tab control: enumerate, switch the controlled tab, or close a tab. */
export const ListTabsParams = z.object({})
export const SwitchTabParams = z.object({ tabId: z.number().int() })
export const CloseTabParams = z.object({ tabId: z.number().int() })

export const DoneParams = z.object({
  answer: z.string(),
})
