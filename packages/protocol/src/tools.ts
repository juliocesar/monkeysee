import { z } from 'zod'

export const GetStateParams = z.object({
  /** If true, also return a base64 screenshot with numbered marks (M2). */
  withScreenshot: z.boolean().optional(),
  /** Cap on returned elements (token control). Default 200. */
  limit: z.number().int().positive().optional(),
})

export const ClickParams = z.object({ index: z.number().int() })
export const TypeParams = z.object({ index: z.number().int(), text: z.string() })
export const SelectOptionParams = z.object({ index: z.number().int(), value: z.string() })
export const HoverParams = z.object({ index: z.number().int() })
export const FocusParams = z.object({ index: z.number().int() })

export const ClickAtParams = z.object({ x: z.number(), y: z.number() })
export const ScrollParams = z.object({
  direction: z.enum(['up', 'down', 'left', 'right']),
  amount: z.number().optional(), // CSS px; default ~ viewport height
})
export const ScrollToParams = z.object({ index: z.number().int() })
export const DragParams = z.object({
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
})
export const PressParams = z.object({
  key: z.string(), // 'Enter', 'Tab', 'Escape', 'a', ...
  modifiers: z.array(z.enum(['Control', 'Alt', 'Shift', 'Meta'])).optional(),
})
export const TypeTextParams = z.object({ text: z.string() })

export const ScreenshotParams = z.object({})

export const OpenTabParams = z.object({ url: z.url() }) // zod 4: top-level z.url()
export const NavigateParams = z.object({ url: z.url() })
export const ExtractTextParams = z.object({ index: z.number().int().optional() })
export const WaitForLoadParams = z.object({ timeoutMs: z.number().int().optional() })

export const GoBackParams = z.object({})
export const GoForwardParams = z.object({})

export const DoneParams = z.object({
  answer: z.string(),
})
