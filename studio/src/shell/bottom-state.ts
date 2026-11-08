// The bottom tab strip and its panel, as plain functions so they can be tested without a DOM.

export type BottomTab = "library" | "log" | "drc" | "find"

export interface BottomState {
  open: boolean
  tab: BottomTab
}

export const BOTTOM_TABS: ReadonlyArray<{ id: BottomTab; label: string }> = [
  { id: "library", label: "Library" },
  { id: "log", label: "Log" },
  { id: "drc", label: "DRC" },
  { id: "find", label: "Find Results" },
]

export const INITIAL_BOTTOM: BottomState = { open: false, tab: "drc" }

/** Clicking the open tab closes the panel; clicking any other tab (or the remembered tab of a closed panel) opens it there. */
export function clickBottom(state: BottomState, clicked: BottomTab): BottomState {
  if (state.open && state.tab === clicked) return { ...state, open: false }
  return { open: true, tab: clicked }
}

/** The `\` key: the panel goes away or comes back on the tab it had. */
export function toggleBottom(state: BottomState): BottomState {
  return { ...state, open: !state.open }
}

/** Opens one tab, for the checks opening by themselves, the status pill and the menu. */
export function openBottomTab(_state: BottomState, tab: BottomTab): BottomState {
  return { open: true, tab }
}
