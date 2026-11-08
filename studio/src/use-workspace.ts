// The Studio's view state: which panels show, the left strip and its sub-tab, the PCB unit and the highlighted net, and the keys
// that change them. The canvases' own keys (fit, rotate, wire, highlight under the pointer) live with the canvases.
import { useCallback, useEffect, useState } from "react"
import { keyAction, keyInput, type KeyActionName } from "./pcb/canvas-keys"
import type { View } from "./pcb/positions"
import { INITIAL_BOTTOM, clickBottom, openBottomTab, toggleBottom, type BottomState, type BottomTab } from "./shell/bottom-state"
import { nextUnit, type Unit } from "./pcb/units"
import {
  INITIAL_LEFT,
  clickLeftStrip,
  clickStrip,
  selectLeftStrip,
  selectStrip,
  toggleStripOpen,
  INITIAL_RIGHT,
  type RightStrip,
  type StripState,
  showDesignSub,
  showLibrary,
  toggleLeftOpen,
  type DesignSub,
  type LeftState,
  type LeftStrip,
} from "./shell/strip-state"

export type { DesignSub, LeftStrip } from "./shell/strip-state"

/** The key actions this hook answers; the canvases answer the rest. */
const WORKSPACE_ACTIONS: ReadonlySet<KeyActionName> = new Set(["toggleLeftPanel", "toggleRightPanel", "toggleBottomPanel", "toggleUnit", "clearHighlight", "openLibrary"])

/** The two side strips and the bottom strip: a click toggles the open tab's panel, a key (or a command) only shows. */
function useStrips() {
  const [left, setLeft] = useState<LeftState>(INITIAL_LEFT)
  const [right, setRight] = useState<StripState<RightStrip>>(INITIAL_RIGHT)
  /** The bottom tab strip and the panel above it; the panel starts closed. */
  const [bottom, setBottom] = useState<BottomState>(INITIAL_BOTTOM)
  const clickLeft = useCallback((strip: LeftStrip) => setLeft((state) => clickLeftStrip(state, strip)), [])
  const selectLeft = useCallback((strip: LeftStrip) => setLeft((state) => selectLeftStrip(state, strip)), [])
  const clickRight = useCallback((tab: RightStrip) => setRight((state) => clickStrip(state, tab)), [])
  const selectRight = useCallback((tab: RightStrip) => setRight((state) => selectStrip(state, tab)), [])
  const clickBottomTab = useCallback((tab: BottomTab) => setBottom((state) => clickBottom(state, tab)), [])
  const openBottom = useCallback((tab: BottomTab) => setBottom((state) => openBottomTab(state, tab)), [])
  const showSub = useCallback((sub: DesignSub) => setLeft(showDesignSub(sub)), [])
  return { left, setLeft, right, setRight, bottom, setBottom, clickLeft, selectLeft, clickRight, selectRight, clickBottomTab, openBottom, showSub }
}

/** A request to move the focus into a panel once it has rendered: the library search (Shift+F) or the Page tree (Ctrl+O). */
function useFocusRequest() {
  const [requested, setRequested] = useState(false)
  const request = useCallback(() => setRequested(true), [])
  const done = useCallback(() => setRequested(false), [])
  return [requested, request, done] as const
}

export function useWorkspace(view: View) {
  const { setLeft, setRight, setBottom, ...strips } = useStrips()
  const [focusSearch, requestSearch, searchFocused] = useFocusRequest()
  const [focusPage, requestPage, pageFocused] = useFocusRequest()
  const [unit, setUnit] = useState<Unit>("mm")
  const [highlight, setHighlight] = useState<string | null>(null)

  /** Runs one of the workspace's own actions, for a key or a menu item. */
  const run = useCallback(
    (action: KeyActionName) => {
      if (action === "toggleLeftPanel") setLeft(toggleLeftOpen)
      if (action === "toggleRightPanel") setRight(toggleStripOpen)
      if (action === "toggleBottomPanel") setBottom(toggleBottom)
      if (action === "toggleUnit") setUnit(nextUnit)
      if (action === "clearHighlight") setHighlight(null)
      if (action === "openLibrary") {
        setLeft(showLibrary)
        requestSearch()
      }
    },
    [setLeft, setRight, setBottom, requestSearch],
  )
  /** File → Open circuit file and Ctrl+O: Project Design → Page, with the focus on the first file. */
  const openPageTree = useCallback(() => {
    setLeft(showDesignSub("page"))
    requestPage()
  }, [setLeft, requestPage])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const hit = keyAction(keyInput(event), { view })
      if (!hit || !WORKSPACE_ACTIONS.has(hit.action)) return
      if (hit.preventDefault) event.preventDefault()
      run(hit.action)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [view, run])

  const toggleUnit = useCallback(() => setUnit(nextUnit), [])
  const { left, right } = strips
  return { ...strips, leftOpen: left.open, rightOpen: right.open, focusSearch, searchFocused, focusPage, pageFocused, openPageTree, unit, toggleUnit, highlight, setHighlight, run }
}
