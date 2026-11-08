import { useRef } from "react"
import { BOTTOM_TABS, bottomTabAfterKey, type BottomState, type BottomTab } from "./bottom-state"
import "./bottom.css"

interface Props {
  state: BottomState
  onClick(tab: BottomTab): void
  onOpen(tab: BottomTab): void
}

/** The tab strip across the bottom of the window; a tab opens its panel above the canvas, or closes it when it is the open one. */
export function BottomStrip({ state, onClick, onOpen }: Props) {
  const bar = useRef<HTMLElement>(null)
  const onKeyDown = (event: React.KeyboardEvent) => {
    const next = bottomTabAfterKey(event.key, state.tab)
    if (!next) return
    event.preventDefault()
    onOpen(next)
    bar.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus()
  }
  return (
    <nav className="bottom-strip" role="tablist" aria-label="Bottom panel" ref={bar} onKeyDown={onKeyDown}>
      {BOTTOM_TABS.map((tab) => {
        const on = state.open && state.tab === tab.id
        return (
          <button key={tab.id} role="tab" data-tab={tab.id} tabIndex={state.tab === tab.id ? 0 : -1} className={`bottom-tab${on ? " on" : ""}`} aria-selected={on} onClick={() => onClick(tab.id)}>
            <span className="bottom-tab-label">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
