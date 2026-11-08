import { BOTTOM_TABS, type BottomState, type BottomTab } from "./bottom-state"
import "./bottom.css"

interface Props {
  state: BottomState
  onClick(tab: BottomTab): void
}

/** The tab strip across the bottom of the window; a tab opens its panel above the canvas, or closes it when it is the open one. */
export function BottomStrip({ state, onClick }: Props) {
  return (
    <nav className="bottom-strip" aria-label="Bottom panel">
      {BOTTOM_TABS.map((tab) => {
        const on = state.open && state.tab === tab.id
        return (
          <button key={tab.id} className={`bottom-tab${on ? " on" : ""}`} aria-pressed={on} onClick={() => onClick(tab.id)}>
            <span className="bottom-tab-label">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
