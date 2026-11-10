// The Page tree of Project Design: project folder -> circuit files -> Schematic (or its pages) and PCB documents.

export type DocView = "schematic" | "pcb"

/** The two documents of every circuit file, Schematic first, as the Page tree and the document tabs list them. */
export const DOC_VIEWS: ReadonlyArray<{ view: DocView; label: string }> = [
  { view: "schematic", label: "Schematic" },
  { view: "pcb", label: "PCB" },
]

export interface PageDocument {
  view: DocView
  label: string
  /** The schematic page the row opens; only on the open file when its schematic has several pages. */
  page?: string
  /** The document that is open now. */
  active: boolean
}

export interface PageFile {
  file: string
  documents: PageDocument[]
}

export interface PageTree {
  project: string
  /** The open document's view; a file row opens its file in this view. */
  view: DocView
  files: PageFile[]
}

/** The open file's pages; the other files are not built, so their pages are not known and they keep one Schematic row. */
export interface OpenPages {
  names: readonly string[]
  open: string
}

function documentsOf(file: string, openFile: string | undefined, openView: DocView, pages: OpenPages | undefined): PageDocument[] {
  const open = file === openFile
  return DOC_VIEWS.flatMap(({ view, label }): PageDocument[] => {
    if (view === "pcb" || !open || !pages || pages.names.length <= 1) return [{ view, label, active: open && view === openView }]
    return pages.names.map((page) => ({ view, label: page, page, active: openView === "schematic" && page === pages.open }))
  })
}

/** The tree for the open file and view; the project text falls back to "Project" until the server has named it. */
export function buildPageTree(project: string | undefined, files: readonly string[], openFile: string | undefined, openView: DocView, pages?: OpenPages): PageTree {
  return {
    project: project || "Project",
    view: openView,
    files: files.map((file) => ({ file, documents: documentsOf(file, openFile, openView, pages) })),
  }
}
