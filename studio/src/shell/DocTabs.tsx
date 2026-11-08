import { DOC_TAB_ORDER, docTabs } from "./doc-tabs"
import type { DocView } from "./page-tree"
import { useTabList } from "./use-tab-list"
import "./doc-tabs.css"

interface Props {
  file: string | undefined
  view: DocView
  onView(view: DocView): void
}

/** The tab bar above the canvas; both documents of the open file are always there. */
export function DocTabs({ file, view, onView }: Props) {
  const list = useTabList({ ids: DOC_TAB_ORDER, current: view, onSelect: onView })
  return (
    <div className="doc-tabs" role="tablist" aria-label="Documents" onKeyDown={list.onKeyDown}>
      {docTabs(file, view).map((tab) => (
        <button
          key={tab.view}
          role="tab"
          id={`doc-tab-${tab.view}`}
          aria-controls="doc-panel"
          aria-selected={tab.active}
          className={`doc-tab${tab.active ? " on" : ""}`}
          title={tab.title}
          {...list.tab(tab.view)}
        >
          <span className="doc-tab-label">{tab.title}</span>
        </button>
      ))}
    </div>
  )
}
