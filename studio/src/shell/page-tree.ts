// The Page tree of Project Design: project folder -> circuit files -> Schematic and PCB documents.

export type DocView = "schematic" | "pcb"

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
  files: PageFile[]
}

const VIEWS: ReadonlyArray<{ view: DocView; label: string }> = [
  { view: "schematic", label: "Schematic" },
  { view: "pcb", label: "PCB" },
]

/** The tree for the open file and view; the project text falls back to "Project" until the server has named it. */
export function buildPageTree(project: string | undefined, files: readonly string[], openFile: string | undefined, openView: DocView): PageTree {
  return {
    project: project || "Project",
    files: files.map((file) => ({
      file,
      documents: VIEWS.map(({ view, label }) => ({ view, label, active: file === openFile && view === openView })),
    })),
  }
}
