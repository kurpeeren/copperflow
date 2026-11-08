import { useTabList } from "./use-tab-list"
import "./strips.css"

export interface StripTab<T extends string> {
  id: T
  label: string
}

interface Props<T extends string> {
  side: "left" | "right"
  tabs: ReadonlyArray<StripTab<T>>
  active: T
  /** Whether the panel next to the strip shows; only then does a tab count as active. */
  open: boolean
  /** A pointer click: the open tab collapses its panel, another tab switches to it. */
  onClick(id: T): void
  /** Enter, Space or an arrow key: shows the tab and never collapses the panel. */
  onSelect(id: T): void
}

/** The id of the panel a strip's tabs control, as the panel carries it. */
export const stripPanelId = (side: "left" | "right") => `${side}-panel`
export const sideTabId = (id: string) => `side-tab-${id}`

/** A 24px strip at the window's edge with rotated tabs; it stays when its panel is collapsed. */
export function SideStrip<T extends string>({ side, tabs, active, open, onClick, onSelect }: Props<T>) {
  const list = useTabList({ ids: tabs.map((t) => t.id), current: active, onSelect, onPointerClick: onClick })
  return (
    <div className={`side-strip ${side}`} role="tablist" aria-orientation="vertical" aria-label={side === "left" ? "Left panel" : "Right panel"} onKeyDown={list.onKeyDown}>
      {tabs.map((tab) => {
        const on = open && tab.id === active
        return (
          <button key={tab.id} role="tab" id={sideTabId(tab.id)} aria-controls={stripPanelId(side)} aria-selected={on} className={`side-tab${on ? " on" : ""}`} {...list.tab(tab.id)}>
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
