import { BOTTOM_PANEL_ID, BOTTOM_TABS, bottomTabId, type BottomState, type BottomTab } from "./bottom-state"
import { useTabList } from "./use-tab-list"
import "./bottom.css"

interface Props {
  state: BottomState
  /** A pointer click: opens the tab's panel, or closes it when it is the open one. */
  onClick(tab: BottomTab): void
  /** Enter, Space or an arrow key: opens the tab's panel and never closes it. */
  onOpen(tab: BottomTab): void
}

const IDS = BOTTOM_TABS.map((tab) => tab.id)

/** The tab strip across the bottom of the window; a tab opens its panel above the canvas. */
export function BottomStrip({ state, onClick, onOpen }: Props) {
  const list = useTabList({ ids: IDS, current: state.tab, onSelect: onOpen, onPointerClick: onClick })
  return (
    <nav className="bottom-strip" role="tablist" aria-label="Bottom panel" onKeyDown={list.onKeyDown}>
      {BOTTOM_TABS.map((tab) => {
        const on = state.open && state.tab === tab.id
        return (
          <button key={tab.id} role="tab" id={bottomTabId(tab.id)} aria-controls={BOTTOM_PANEL_ID} className={`bottom-tab${on ? " on" : ""}`} aria-selected={on} {...list.tab(tab.id)}>
            <span className="bottom-tab-label">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
