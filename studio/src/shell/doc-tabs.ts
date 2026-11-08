// The document tab bar above the canvas: one Schematic and one PCB tab for the open file.
import type { DocView } from "./page-tree.js"

export interface DocTab {
  view: DocView
  title: string
  active: boolean
}

const VIEWS: ReadonlyArray<{ view: DocView; label: string }> = [
  { view: "schematic", label: "Schematic" },
  { view: "pcb", label: "PCB" },
]

/** The tabs of the open file, Schematic first; titles drop the `.circuit.tsx` ending. */
export function docTabs(file: string | undefined, openView: DocView): DocTab[] {
  const name = (file ?? "").replace(/\.circuit\.tsx$/, "")
  return VIEWS.map(({ view, label }) => ({ view, title: name ? `${name} ${label}` : label, active: view === openView }))
}

/** The view an arrow key moves to from the open one, or null for any other key. */
export function tabAfterKey(key: string, openView: DocView): DocView | null {
  if (key === "Home") return "schematic"
  if (key === "End") return "pcb"
  if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "ArrowUp" && key !== "ArrowDown") return null
  const step = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1
  const index = VIEWS.findIndex((v) => v.view === openView)
  return VIEWS[(index + step + VIEWS.length) % VIEWS.length]!.view
}
