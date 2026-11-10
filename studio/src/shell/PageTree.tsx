import { useEffect, useRef } from "react"
import type { PageTree as Tree, DocView } from "./page-tree"

interface Props {
  tree: Tree
  onOpen(file: string, view: DocView, page?: string): void
  /** Move the focus to the first file now (Ctrl+O); `onFocused` says it has been done. */
  focus: boolean
  onFocused(): void
}

/** Project folder, then each circuit file with its Schematic and PCB; a file opens in the open view, a document as itself. */
export function PageTree({ tree, onOpen, focus, onFocused }: Props) {
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (!focus) return
    list.current?.querySelector<HTMLElement>(".tree-row.file")?.focus()
    onFocused()
  }, [focus, onFocused])
  return (
    <nav className="page-tree" aria-label="Pages">
      <div className="tree-row project">{tree.project}</div>
      <ul ref={list}>
        {tree.files.map((entry) => (
          <li key={entry.file}>
            <button className="tree-row file" title={`Open ${entry.file}`} onClick={() => onOpen(entry.file, tree.view)}>
              {entry.file}
            </button>
            <ul>
              {entry.documents.map((doc) => (
                <li key={doc.page ?? doc.view}>
                  <button className={`tree-row doc${doc.active ? " active" : ""}`} aria-current={doc.active ? "page" : undefined} onClick={() => onOpen(entry.file, doc.view, doc.page)}>
                    {doc.label}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  )
}
