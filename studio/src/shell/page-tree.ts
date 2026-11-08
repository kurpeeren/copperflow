// The Page tree of Project Design: project folder -> circuit files -> Schematic and PCB documents.

export type DocView = "schematic" | "pcb"

/** The two documents of every circuit file, Schematic first, as the Page tree and the document tabs list them. */
export const DOC_VIEWS: ReadonlyArray<{ view: DocView; label: string }> = [
  { view: "schematic", label: "Schematic" },
  { view: "pcb", label: "PCB" },
]

export interface PageDocument {
  view: DocView
  label: string
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

/** The tree for the open file and view; the project text falls back to "Project" until the server has named it. */
export function buildPageTree(project: string | undefined, files: readonly string[], openFile: string | undefined, openView: DocView): PageTree {
  return {
    project: project || "Project",
    view: openView,
    files: files.map((file) => ({
      file,
      documents: DOC_VIEWS.map(({ view, label }) => ({ view, label, active: file === openFile && view === openView })),
    })),
  }
}
