import { useRef } from "react"
import { docTabs, tabAfterKey } from "./doc-tabs"
import type { DocView } from "./page-tree"
import "./doc-tabs.css"

interface Props {
  file: string | undefined
  view: DocView
  onView(view: DocView): void
}

/** The tab bar above the canvas; both documents of the open file are always there. */
export function DocTabs({ file, view, onView }: Props) {
  const bar = useRef<HTMLDivElement>(null)
  const onKeyDown = (event: React.KeyboardEvent) => {
    const next = tabAfterKey(event.key, view)
    if (!next) return
    event.preventDefault()
    onView(next)
    bar.current?.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus()
  }
  return (
    <div className="doc-tabs" role="tablist" aria-label="Documents" ref={bar} onKeyDown={onKeyDown}>
      {docTabs(file, view).map((tab) => (
        <button
          key={tab.view}
          role="tab"
          data-view={tab.view}
          aria-selected={tab.active}
          tabIndex={tab.active ? 0 : -1}
          className={`doc-tab${tab.active ? " on" : ""}`}
          title={tab.title}
          onClick={() => onView(tab.view)}
        >
          {tab.title}
        </button>
      ))}
    </div>
  )
}
