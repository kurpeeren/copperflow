// The document tab bar above the canvas: a Schematic tab for each page of the open file, then its PCB tab.
import { DOC_VIEWS, type DocView } from "./page-tree.js"
import { isSheetFile, sheetName } from "../pcb/sheet-names.js"
import { MAIN_PAGE } from "./schematic-pages.js"

export interface DocTab {
  /** "schematic" or "pcb"; "schematic:<page>" for a page of a schematic with several. */
  id: string
  view: DocView
  /** The schematic page the tab shows; only on a schematic with several pages. */
  page?: string
  title: string
  active: boolean
  /** A tab of the circuit a sheet was opened from: it opens that circuit again, in its view. */
  parent?: true
}

/** The views in tab order, for the tab keys of a one-page schematic. */
export const DOC_TAB_ORDER: readonly DocView[] = DOC_VIEWS.map((v) => v.view)

const PAGE_ID = "schematic:"
const PARENT_ID = "parent:"

/** The document a tab id opens; a parent's tab opens the circuit the sheet was opened from. */
export function tabTarget(id: string): { view: DocView; page?: string; parent?: true } {
  if (id.startsWith(PARENT_ID)) return { ...tabTarget(id.slice(PARENT_ID.length)), parent: true }
  if (id.startsWith(PAGE_ID)) return { view: "schematic", page: id.slice(PAGE_ID.length) }
  return { view: id === "pcb" ? "pcb" : "schematic" }
}

/**
 * The tabs while a sheet file is open: the tabs of the circuit it was opened from (to go back), then the sheet's own
 * Schematic, "PowerStage (sheet)". A sheet has no PCB of its own; its parts are on the circuit's board.
 */
function sheetTabs(file: string, parent: string | undefined): DocTab[] {
  const back = parent === undefined ? [] : docTabs(parent, "pcb").map((tab): DocTab => ({ ...tab, id: `${PARENT_ID}${tab.id}`, active: false, parent: true }))
  return [...back, { id: "schematic", view: "schematic", title: `${sheetName(file)} (sheet)`, active: true }]
}

/**
 * The tabs of the open file, Schematic first; titles drop the `.circuit.tsx` ending. A schematic with several pages
 * has a tab per page, "index — Power", as EasyEDA's tab strip lists the sheets of a schematic.
 */
export function docTabs(file: string | undefined, openView: DocView, pages: readonly string[] = [MAIN_PAGE], openPage: string = MAIN_PAGE, parent?: string): DocTab[] {
  if (file !== undefined && isSheetFile(file)) return sheetTabs(file, parent)
  const name = (file ?? "").replace(/\.circuit\.tsx$/, "")
  const titled = (label: string, joiner: string) => (name ? `${name}${joiner}${label}` : label)
  return DOC_VIEWS.flatMap(({ view, label }): DocTab[] => {
    if (view === "pcb" || pages.length <= 1) return [{ id: view, view, title: titled(label, " "), active: view === openView }]
    return pages.map((page) => ({ id: `${PAGE_ID}${page}`, view, page, title: titled(page, " — "), active: openView === "schematic" && page === openPage }))
  })
}
