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
  onClick(id: T): void
}

/** A 24px strip at the window's edge with rotated tabs; it stays when its panel is collapsed. */
export function SideStrip<T extends string>({ side, tabs, active, open, onClick }: Props<T>) {
  return (
    <div className={`side-strip ${side}`} role="tablist" aria-orientation="vertical">
      {tabs.map((tab) => {
        const on = open && tab.id === active
        return (
          <button key={tab.id} role="tab" aria-selected={on} className={`side-tab${on ? " on" : ""}`} onClick={() => onClick(tab.id)}>
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
