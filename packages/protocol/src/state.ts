/** Bounding box in CSS pixels, viewport-relative: [x, y, width, height]. */
export type Box = [number, number, number, number]

/**
 * Index-encoding stride: a handle's `index` is `frameId * FRAME_STRIDE + localId`, so the
 * frame is recoverable as `Math.floor(index / FRAME_STRIDE)`. Shared by the content indexer
 * (encode) and the SW router (decode) so the constant lives in exactly one place.
 */
export const FRAME_STRIDE = 100_000

/**
 * Per-frame sub-range reserved for `get_forms` handle indices, so a form index can never
 * alias a `get_state` index within the same frame. A form field's index is
 * `frameId * FRAME_STRIDE + FORM_INDEX_BASE + localId`; `get_state` stays in
 * `0 .. FORM_INDEX_BASE-1`. The SW frame decode (`Math.floor(index / FRAME_STRIDE)`) is
 * unaffected. Assumes `get_state` never emits a `localId >= FORM_INDEX_BASE` (it would need
 * a per-frame `limit` of 50k+ — far past the default 200).
 */
export const FORM_INDEX_BASE = 50_000

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
  /** Base64 PNG with numbered set-of-marks; present only when get_state ran withScreenshot. */
  screenshot?: string
}

// ---- Form discovery (`get_forms`) ----

/** A single fillable control, normalized for form-filling. */
export interface FormField {
  /** Actionable handle: frameId * FRAME_STRIDE + FORM_INDEX_BASE + localId. */
  index: number
  frameId: number
  /** Normalized control kind. 'custom' = an ARIA-role widget, not a native control. */
  kind:
    | 'text'
    | 'textarea'
    | 'select'
    | 'checkbox'
    | 'radio'
    | 'contenteditable'
    | 'button'
    | 'file'
    | 'custom'
  /** Raw input type when meaningful: email | password | tel | date | number | search | submit | ... */
  type?: string
  /** ARIA role for custom widgets: combobox | listbox | switch | spinbutton | slider | ... */
  role?: string
  /** Best-effort accessible label (reuses accessibleName + <label>/fieldset legend). */
  label: string
  /** name attribute (strong intent signal). */
  name?: string
  /** id attribute. */
  id?: string
  /** e.g. "email", "cc-number", "current-password" — huge fill signal. */
  autocomplete?: string
  placeholder?: string
  /** Current text value (input/textarea/contenteditable). */
  value?: string
  /** Checkbox / radio / aria-checked current state. */
  checked?: boolean
  /** For <select> (and collapsed radio groups). */
  options?: FormOption[]
  required?: boolean
  disabled?: boolean
  readonly?: boolean
  /**
   * How the agent should drive this field:
   *  - 'value'  — set via type / select_option (native input/select/textarea)
   *  - 'click'  — open-then-click sequence (radio options, custom ARIA widgets)
   */
  interaction?: 'value' | 'click'
  /**
   * True when the synthetic backend's value-setter won't work and trusted input is
   * required (contenteditable rich editors). Typing should route through the debugger
   * backend (CDP insertText) for these.
   */
  requiresTrustedInput?: boolean
  /**
   * Geometry is OMITTED by default — semantic actions are index-based and auto-scrollIntoView,
   * so coordinates buy nothing for filling. Present only when `includeBoxes:true`.
   */
  box?: Box
  inViewport?: boolean
}

export interface FormOption {
  value: string
  label: string
  /** <select> option currently selected. */
  selected: boolean
  /** Present for radio-group options: the handle to click that radio. */
  index?: number
}

export interface FormGroup {
  /** id or name of the <form>, for the agent to disambiguate multiple forms. */
  name?: string
  action?: string
  method?: string
  fields: FormField[]
}

export interface FormsState {
  tabId: number
  url: string
  title: string
  forms: FormGroup[]
  /** Fillable controls not inside any <form> element. */
  orphans: FormField[]
  loading: boolean
  /**
   * Count of cross-origin frames that were present but could not be read. Non-zero means the
   * field list may be incomplete — fall back to screenshot / click_at for those regions.
   */
  skippedFrames?: number
}
