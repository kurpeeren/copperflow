// The vertical tab strips and the left panel's tab state, as plain functions so they can be tested without a DOM.

export type LeftStrip = "design" | "library"
/** The sub-tabs of Project Design. History is temporary here until the bottom panel's Log tab takes it over. */
export type DesignSub = "page" | "net" | "component" | "object" | "history"

export interface LeftState {
  strip: LeftStrip
  sub: DesignSub
  open: boolean
}

export interface StripState<T> {
  active: T
  open: boolean
}

/** The right strip's tabs; Filter and Layer join Properties in later rounds. */
export type RightStrip = "properties"

export const INITIAL_RIGHT: StripState<RightStrip> = { active: "properties", open: true }

export const INITIAL_LEFT: LeftState = { strip: "design", sub: "page", open: true }

/** Clicking the active tab of an open strip collapses its panel; clicking any other tab switches to it and opens the panel. */
export function clickStrip<T>(state: StripState<T>, clicked: T): StripState<T> {
  if (state.open && state.active === clicked) return { ...state, open: false }
  return { active: clicked, open: true }
}

/** The `]` key: any strip's panel goes away or comes back; the active tab stays. */
export function toggleStripOpen<T>(state: StripState<T>): StripState<T> {
  return { ...state, open: !state.open }
}

export function clickLeftStrip(state: LeftState, clicked: LeftStrip): LeftState {
  const next = clickStrip({ active: state.strip, open: state.open }, clicked)
  return { ...state, strip: next.active, open: next.open }
}

/** Shows one sub-tab of Project Design, opening the panel if it was collapsed. */
export function showDesignSub(sub: DesignSub): LeftState {
  return { strip: "design", sub, open: true }
}

/** Shift+F: Common Library, open. */
export function showLibrary(state: LeftState): LeftState {
  return { ...state, strip: "library", open: true }
}

/** The `[` key: the panel goes away or comes back; the strip stays. */
export function toggleLeftOpen(state: LeftState): LeftState {
  return { ...state, open: !state.open }
}
