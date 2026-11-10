// The document tab bar above the canvas: a Schematic tab for each page of the open file, then its PCB tab.
import { DOC_VIEWS, type DocView } from "./page-tree.js"
import { MAIN_PAGE } from "./schematic-pages.js"

export interface DocTab {
  /** "schematic" or "pcb"; "schematic:<page>" for a page of a schematic with several. */
  id: string
  view: DocView
  /** The schematic page the tab shows; only on a schematic with several pages. */
  page?: string
  title: string
  active: boolean
}

/** The views in tab order, for the tab keys of a one-page schematic. */
export const DOC_TAB_ORDER: readonly DocView[] = DOC_VIEWS.map((v) => v.view)

const PAGE_ID = "schematic:"

/** The document a tab id opens. */
export function tabTarget(id: string): { view: DocView; page?: string } {
  if (id.startsWith(PAGE_ID)) return { view: "schematic", page: id.slice(PAGE_ID.length) }
  return { view: id === "pcb" ? "pcb" : "schematic" }
}

/**
 * The tabs of the open file, Schematic first; titles drop the `.circuit.tsx` ending. A schematic with several pages
 * has a tab per page, "index — Power", as EasyEDA's tab strip lists the sheets of a schematic.
 */
export function docTabs(file: string | undefined, openView: DocView, pages: readonly string[] = [MAIN_PAGE], openPage: string = MAIN_PAGE): DocTab[] {
  const name = (file ?? "").replace(/\.circuit\.tsx$/, "")
  const titled = (label: string, joiner: string) => (name ? `${name}${joiner}${label}` : label)
  return DOC_VIEWS.flatMap(({ view, label }): DocTab[] => {
    if (view === "pcb" || pages.length <= 1) return [{ id: view, view, title: titled(label, " "), active: view === openView }]
    return pages.map((page) => ({ id: `${PAGE_ID}${page}`, view, page, title: titled(page, " — "), active: openView === "schematic" && page === openPage }))
  })
}
