// The Studio's view state: which panels show, the left tab, the PCB unit and the highlighted net, and the keys
// that change them. The canvases' own keys (fit, rotate, wire, highlight under the pointer) live with the canvases.
import { useCallback, useEffect, useState } from "react"
import { keyAction, keyInput, type KeyActionName } from "./pcb/canvas-keys"
import type { View } from "./pcb/positions"
import { nextUnit, type Unit } from "./pcb/units"

export type LeftTab = "parts" | "library" | "nets" | "connections" | "history"

/** The key actions this hook answers; the canvases answer the rest. */
const WORKSPACE_ACTIONS: ReadonlySet<KeyActionName> = new Set(["toggleLeftPanel", "toggleRightPanel", "toggleUnit", "clearHighlight", "openLibrary"])

export function useWorkspace(view: View) {
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [leftTab, setLeftTab] = useState<LeftTab>("parts")
  const [focusSearch, setFocusSearch] = useState(false)
  const [unit, setUnit] = useState<Unit>("mm")
  const [highlight, setHighlight] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const hit = keyAction(keyInput(event), { view })
      if (!hit || !WORKSPACE_ACTIONS.has(hit.action)) return
      if (hit.preventDefault) event.preventDefault()
      if (hit.action === "toggleLeftPanel") setLeftOpen((open) => !open)
      if (hit.action === "toggleRightPanel") setRightOpen((open) => !open)
      if (hit.action === "toggleUnit") setUnit(nextUnit)
      if (hit.action === "clearHighlight") setHighlight(null)
      if (hit.action === "openLibrary") {
        setLeftOpen(true)
        setLeftTab("library")
        setFocusSearch(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [view])

  const toggleUnit = useCallback(() => setUnit(nextUnit), [])
  const searchFocused = useCallback(() => setFocusSearch(false), [])
  return { leftOpen, rightOpen, leftTab, setLeftTab, focusSearch, searchFocused, unit, toggleUnit, highlight, setHighlight }
}
