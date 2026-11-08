// The document tab bar above the canvas: one Schematic and one PCB tab for the open file.
import { DOC_VIEWS, type DocView } from "./page-tree.js"

export interface DocTab {
  view: DocView
  title: string
  active: boolean
}

/** The views in tab order, for the tab keys. */
export const DOC_TAB_ORDER: readonly DocView[] = DOC_VIEWS.map((v) => v.view)

/** The tabs of the open file, Schematic first; titles drop the `.circuit.tsx` ending. */
export function docTabs(file: string | undefined, openView: DocView): DocTab[] {
  const name = (file ?? "").replace(/\.circuit\.tsx$/, "")
  return DOC_VIEWS.map(({ view, label }) => ({ view, title: name ? `${name} ${label}` : label, active: view === openView }))
}
