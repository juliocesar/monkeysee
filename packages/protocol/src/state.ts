/** Bounding box in CSS pixels, viewport-relative: [x, y, width, height]. */
export type Box = [number, number, number, number]

export interface ElementHandle {
  /** Globally unique within a PageState. Encodes frame: frameId * 100000 + localId. */
  index: number
  /** 0 = top frame (always 0 in M0). */
  frameId: number
  /** Semantic role: link | button | textbox | checkbox | heading | listitem | ... */
  role: string
  /** Accessible name or trimmed text content. */
  name: string
  /** Current value for inputs. */
  value?: string
  box: Box
  inViewport: boolean
}

export interface Viewport {
  w: number
  h: number
  scrollX: number
  scrollY: number
  /** devicePixelRatio, for mapping screenshots (device px) back to CSS px later. */
  dpr: number
}

export interface PageState {
  tabId: number
  url: string
  title: string
  viewport: Viewport
  elements: ElementHandle[]
  /** True if a navigation/mutation settle is still pending (agent may want to wait). */
  loading: boolean
}
