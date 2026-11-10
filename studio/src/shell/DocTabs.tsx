import { docTabs, tabTarget } from "./doc-tabs"
import type { DocView } from "./page-tree"
import { useTabList } from "./use-tab-list"
import "./doc-tabs.css"

interface Props {
  file: string | undefined
  view: DocView
  /** The schematic's pages, and the one that is open. */
  pages: readonly string[]
  page: string
  onView(view: DocView): void
  onPage(page: string): void
}

/** The tab bar above the canvas: a Schematic tab per page of the open file, then its PCB; all are always there. */
export function DocTabs({ file, view, pages, page, onView, onPage }: Props) {
  const tabs = docTabs(file, view, pages, page)
  const current = tabs.find((tab) => tab.active)?.id ?? view
  const open = (id: string) => {
    const target = tabTarget(id)
    if (target.page !== undefined) onPage(target.page)
    else onView(target.view)
  }
  const list = useTabList({ ids: tabs.map((tab) => tab.id), current, onSelect: open })
  return (
    <div className="doc-tabs hairline-b" role="tablist" aria-label="Documents" onKeyDown={list.onKeyDown}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          role="tab"
          // The canvas panel is labelled by doc-tab-<view>: the open tab of each view carries that id.
          id={tab.active || tab.page === undefined ? `doc-tab-${tab.view}` : `doc-tab-${tab.view}-${index}`}
          aria-controls="doc-panel"
          aria-selected={tab.active}
          className={`doc-tab${tab.active ? " on" : ""}`}
          title={tab.title}
          {...list.tab(tab.id)}
        >
          <span className="doc-tab-label">{tab.title}</span>
        </button>
      ))}
    </div>
  )
}
