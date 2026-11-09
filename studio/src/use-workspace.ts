// The Studio's view state: which panels show, the left strip and its sub-tab, the PCB unit and the highlighted net, and the keys
// that change them. The canvases' own keys (fit, rotate, wire, highlight under the pointer) live with the canvases.
import { useCallback, useEffect, useRef, useState } from "react"
import { keyAction, keyInput, type KeyActionName } from "./pcb/canvas-keys"
import type { View } from "./pcb/positions"
import { INITIAL_BOTTOM, clickBottom, openBottomTab, toggleBottom, type BottomState, type BottomTab } from "./shell/bottom-state"
import { NO_HIGHLIGHT, type Highlight } from "./pcb/highlight"
import { INITIAL_GRID_STEPS, INITIAL_GRID_STYLES, setGridStep, toggleGridStyle, type GridSteps, type GridStyles } from "./pcb/grid"
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

/**
 * Each document's grid style and Grid step. They live here, above the canvases, so switching tabs or files (which
 * remounts the canvas) keeps them; every change names the view it is for.
 */
function useGridSettings() {
  const [gridStyles, setGridStyles] = useState<GridStyles>(INITIAL_GRID_STYLES)
  const [gridSteps, setGridSteps] = useState<GridSteps>(INITIAL_GRID_STEPS)
  const changeGridStep = useCallback((view: View, step: number) => setGridSteps((steps) => setGridStep(steps, view, step)), [])
  const toggleGridStyleOf = useCallback((view: View) => setGridStyles((styles) => toggleGridStyle(styles, view)), [])
  return { gridStyles, gridSteps, changeGridStep, toggleGridStyleOf }
}

/** Answers the workspace's own keys, as they mean in the open view. */
function useWorkspaceKeys(view: View, run: (action: KeyActionName) => void): void {
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
}

type Strips = ReturnType<typeof useStrips>

/**
 * The requests to move the focus into a panel, and the commands that open a panel with the focus in it: File → Open
 * circuit file and Ctrl+O on the Page tree's first file, a double click on a part in Properties' first field.
 */
function usePanelFocus(setLeft: Strips["setLeft"], setRight: Strips["setRight"]) {
  const [focusSearch, requestSearch, searchFocused] = useFocusRequest()
  const [focusPage, requestPage, pageFocused] = useFocusRequest()
  const [focusField, requestField, fieldFocused] = useFocusRequest()
  const openPageTree = useCallback(() => {
    setLeft(showDesignSub("page"))
    requestPage()
  }, [setLeft, requestPage])
  const openProperties = useCallback(() => {
    setRight((state) => selectStrip(state, "properties"))
    requestField()
  }, [setRight, requestField])
  return { focusSearch, requestSearch, searchFocused, focusPage, pageFocused, openPageTree, focusField, fieldFocused, openProperties }
}

/** What the workspace's own actions change. */
interface RunTargets {
  strips: Pick<Strips, "setLeft" | "setRight" | "setBottom">
  setUnit(change: (unit: Unit) => Unit): void
  setHighlight(highlight: Highlight): void
  toggleGridStyleOf(view: View): void
  requestSearch(): void
}

/** Runs one of the workspace's own actions, for a key or a menu item; the Grid style acts on the open view. */
function useWorkspaceRun(view: View, { strips, setUnit, setHighlight, toggleGridStyleOf, requestSearch }: RunTargets): (action: KeyActionName) => void {
  const { setLeft, setRight, setBottom } = strips
  // A ref keeps `run` the same function while the tabs switch.
  const openView = useRef(view)
  openView.current = view
  return useCallback(
    (action: KeyActionName) => {
      if (action === "toggleLeftPanel") setLeft(toggleLeftOpen)
      if (action === "toggleRightPanel") setRight(toggleStripOpen)
      if (action === "toggleBottomPanel") setBottom(toggleBottom)
      if (action === "toggleUnit") setUnit(nextUnit)
      if (action === "toggleGridStyle") toggleGridStyleOf(openView.current)
      if (action === "clearHighlight") setHighlight(NO_HIGHLIGHT)
      if (action === "openLibrary") {
        setLeft(showLibrary)
        requestSearch()
      }
    },
    [setLeft, setRight, setBottom, setUnit, setHighlight, requestSearch, toggleGridStyleOf],
  )
}

export function useWorkspace(view: View) {
  const { setLeft, setRight, setBottom, ...strips } = useStrips()
  const { requestSearch, ...focus } = usePanelFocus(setLeft, setRight)
  const [unit, setUnit] = useState<Unit>("mm")
  const [highlight, setHighlight] = useState<Highlight>(NO_HIGHLIGHT)
  const { toggleGridStyleOf, ...grid } = useGridSettings()
  const run = useWorkspaceRun(view, { strips: { setLeft, setRight, setBottom }, setUnit, setHighlight, toggleGridStyleOf, requestSearch })
  useWorkspaceKeys(view, run)
  const toggleUnit = useCallback(() => setUnit(nextUnit), [])
  return { ...strips, ...grid, ...focus, leftOpen: strips.left.open, rightOpen: strips.right.open, unit, toggleUnit, highlight, setHighlight, run }
}
