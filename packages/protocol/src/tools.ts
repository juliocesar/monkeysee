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

export const GetFormsParams = z.object({
  ...tabTarget,
  /** If true, include hidden fields (display:none etc.). Default false. */
  includeHidden: z.boolean().optional(),
  /** If true, serialize box/inViewport geometry. Default false (omitted to save tokens). */
  includeBoxes: z.boolean().optional(),
  /** Cap on total returned fields (token control). Default 150. */
  limit: z.number().int().positive().optional(),
})

export const FillFieldsParams = z.object({
  ...tabTarget,
  fields: z
    .array(
      z.object({
        index: z.number().int(),
        /** Text to type into a value field (input/textarea/contenteditable). */
        value: z.string().optional(),
        /**
         * Set a checkbox/radio: clicked only when its current `checked` state differs from
         * this value, so it is idempotent (re-running a fill is safe).
         */
        checked: z.boolean().optional(),
        /** Option value to choose in a <select> / combobox. */
        option: z.string().optional(),
      }),
    )
    .min(1),
  /**
   * `progressive` (default) fills the form the way a person would: smooth-scroll each field
   * into view, typewriter text/textarea input, and open dropdowns to click the option — a
   * human-watchable fill for demos/recordings. `batch` applies every field instantly with no
   * scrolling or animation; use it for fast, unattended/programmatic fills.
   */
  mode: z.enum(['batch', 'progressive']).optional(),
  /** Speed of the progressive animation. Default `fast`. Ignored in `batch` mode. */
  pace: z.enum(['fast', 'normal', 'slow']).optional(),
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
