// The Studio's view state: which panels show, the left strip and its sub-tab, the PCB unit and the highlighted net, and the keys
// that change them. The canvases' own keys (fit, rotate, wire, highlight under the pointer) live with the canvases.
import { useCallback, useEffect, useState } from "react"
import { keyAction, keyInput, type KeyActionName } from "./pcb/canvas-keys"
import type { View } from "./pcb/positions"
import { nextUnit, type Unit } from "./pcb/units"
import {
  INITIAL_LEFT,
  clickLeftStrip,
  clickStrip,
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

export function useWorkspace(view: View) {
  const [left, setLeft] = useState<LeftState>(INITIAL_LEFT)
  const [rightOpen, setRightOpen] = useState(true)
  /** The Checks panel under the canvas; it starts closed. */
  const [bottomOpen, setBottomOpen] = useState(false)
  const [focusSearch, setFocusSearch] = useState(false)
  const [unit, setUnit] = useState<Unit>("mm")
  const [highlight, setHighlight] = useState<string | null>(null)

  /** Runs one of the workspace's own actions, for a key or a menu item. */
  const run = useCallback((action: KeyActionName) => {
    if (action === "toggleLeftPanel") setLeft(toggleLeftOpen)
    if (action === "toggleRightPanel") setRightOpen((open) => !open)
    if (action === "toggleBottomPanel") setBottomOpen((open) => !open)
    if (action === "toggleUnit") setUnit(nextUnit)
    if (action === "clearHighlight") setHighlight(null)
    if (action === "openLibrary") {
      setLeft(showLibrary)
      setFocusSearch(true)
    }
  }, [])

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

  const clickLeft = useCallback((strip: LeftStrip) => setLeft((state) => clickLeftStrip(state, strip)), [])
  const clickRight = useCallback(() => setRightOpen((open) => clickStrip({ active: "properties", open }, "properties").open), [])
  const showSub = useCallback((sub: DesignSub) => setLeft(showDesignSub(sub)), [])

  const toggleUnit = useCallback(() => setUnit(nextUnit), [])
  const searchFocused = useCallback(() => setFocusSearch(false), [])
  return { left, leftOpen: left.open, rightOpen, bottomOpen, setBottomOpen, clickLeft, clickRight, showSub, focusSearch, searchFocused, unit, toggleUnit, highlight, setHighlight, run }
}
