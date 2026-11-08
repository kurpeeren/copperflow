// The Studio's view state: which panels show, the left tab, the PCB unit and the highlighted net, and the keys
// that change them. The canvases' own keys (fit, rotate, wire, highlight under the pointer) live with the canvases.
import { useCallback, useEffect, useState } from "react"
import { keyAction, keyInput, type KeyActionName } from "./pcb/canvas-keys"
import type { View } from "./pcb/positions"
import { nextUnit, type Unit } from "./pcb/units"

export type LeftTab = "parts" | "library" | "nets" | "connections" | "history"

/** The key actions this hook answers; the canvases answer the rest. */
const WORKSPACE_ACTIONS: ReadonlySet<KeyActionName> = new Set(["toggleLeftPanel", "toggleRightPanel", "toggleBottomPanel", "toggleUnit", "clearHighlight", "openLibrary"])

export function useWorkspace(view: View) {
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  /** The Checks panel under the canvas; it starts closed. */
  const [bottomOpen, setBottomOpen] = useState(false)
  const [leftTab, setLeftTab] = useState<LeftTab>("parts")
  const [focusSearch, setFocusSearch] = useState(false)
  const [unit, setUnit] = useState<Unit>("mm")
  const [highlight, setHighlight] = useState<string | null>(null)

  /** Runs one of the workspace's own actions, for a key or a menu item. */
  const run = useCallback((action: KeyActionName) => {
    if (action === "toggleLeftPanel") setLeftOpen((open) => !open)
    if (action === "toggleRightPanel") setRightOpen((open) => !open)
    if (action === "toggleBottomPanel") setBottomOpen((open) => !open)
    if (action === "toggleUnit") setUnit(nextUnit)
    if (action === "clearHighlight") setHighlight(null)
    if (action === "openLibrary") {
      setLeftOpen(true)
      setLeftTab("library")
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

  const showLeftTab = useCallback((next: LeftTab) => {
    setLeftOpen(true)
    setLeftTab(next)
  }, [])

  const toggleUnit = useCallback(() => setUnit(nextUnit), [])
  const searchFocused = useCallback(() => setFocusSearch(false), [])
  return { leftOpen, rightOpen, bottomOpen, setBottomOpen, leftTab, setLeftTab, showLeftTab, focusSearch, searchFocused, unit, toggleUnit, highlight, setHighlight, run }
}
