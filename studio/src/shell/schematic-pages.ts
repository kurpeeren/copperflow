// The pages of the open circuit's schematic, as the Studio shows them: one Schematic tab per page, each drawing only
// what its page holds. Pages are drawing only (docs/plans/engine-stage-6.md): nets join across them by name.
import type { Design } from "../../../src/engine/design.js"
import { MAIN_PAGE } from "../../../src/engine/model.js"

export { MAIN_PAGE }

/** The pages of the design, Main first; one page before the first build. */
export function pageNames(design: Design | undefined): string[] {
  const pages = design?.schematic.pages?.map((page) => page.name)
  return pages && pages.length > 0 ? pages : [MAIN_PAGE]
}

/** The page to show: the one asked for while it exists, else the first. */
export function shownPage(design: Design | undefined, wanted: string): string {
  const names = pageNames(design)
  return names.includes(wanted) ? wanted : (names[0] ?? MAIN_PAGE)
}

/** The design as one page draws it: its symbols, wires, labels, junctions and drawings only. One page is the design itself. */
export function designOnPage(design: Design, page: string): Design {
  const pages = design.schematic.pages ?? []
  const entry = pages.find((candidate) => candidate.name === page)
  if (pages.length <= 1 || !entry) return design
  const keep = <T>(list: readonly T[], ids: readonly string[], idOf: (item: T) => string) => {
    const wanted = new Set(ids)
    return list.filter((item) => wanted.has(idOf(item)))
  }
  const { schematic } = design
  return {
    ...design,
    schematic: {
      ...schematic,
      symbols: keep(schematic.symbols, entry.parts, (s) => s.component),
      wires: keep(schematic.wires, entry.wires, (w) => w.id),
      labels: keep(schematic.labels, entry.labels, (l) => l.id),
      drawings: keep(schematic.drawings, entry.drawings, (d) => d.id),
      junctions: entry.junctions,
    },
  }
}

/** A name for a new page: "Page 2", "Page 3", … the first that is free. */
export function nextPageName(names: readonly string[]): string {
  for (let n = names.length + 1; ; n++) if (!names.includes(`Page ${n}`)) return `Page ${n}`
}

/** Why a page cannot be deleted, or undefined when it can: the first page is the board itself, and a page with parts stays. */
export function deletePageRefusal(design: Design | undefined, page: string): string | undefined {
  if (page === MAIN_PAGE) return `${MAIN_PAGE} is the first page and cannot be deleted`
  const parts = design?.schematic.pages?.find((entry) => entry.name === page)?.parts ?? []
  return parts.length > 0 ? `Page ${page} still has parts (${parts.join(", ")}); move or delete them first` : undefined
}

/** Why a page cannot be renamed, or undefined when it can. */
export function renamePageRefusal(page: string): string | undefined {
  return page === MAIN_PAGE ? `${MAIN_PAGE} is the first page and keeps its name` : undefined
}
