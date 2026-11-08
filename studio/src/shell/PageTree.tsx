import type { PageTree as Tree, DocView } from "./page-tree"

interface Props {
  tree: Tree
  onOpen(file: string, view: DocView): void
}

/** Project folder -> circuit files -> Schematic and PCB; clicking a document opens it. */
export function PageTree({ tree, onOpen }: Props) {
  return (
    <div className="page-tree" role="tree">
      <div className="tree-row project" role="treeitem" aria-expanded="true">
        {tree.project}
      </div>
      {tree.files.map((entry) => (
        <div key={entry.file} role="group">
          <div className="tree-row file" role="treeitem" aria-expanded="true" title={entry.file}>
            {entry.file}
          </div>
          {entry.documents.map((doc) => (
            <button
              key={doc.view}
              role="treeitem"
              aria-selected={doc.active}
              className={`tree-row doc${doc.active ? " active" : ""}`}
              onClick={() => onOpen(entry.file, doc.view)}
            >
              {doc.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
