import { filterRows, type PickFilter, type PickKind } from "../pcb/pick-filter"
import type { View } from "../pcb/positions"
import { blurAfterPointerClick } from "./focus"
import { sideTabId, stripPanelId } from "./SideStrip"
import "./filter-panel.css"

interface Props {
  view: View
  filter: PickFilter
  onToggle(kind: PickKind): void
}

/** What a click or a box may pick: a "Pick" heading, then a 28px checkbox row for each kind this view has. */
export function FilterPanel({ view, filter, onToggle }: Props) {
  return (
    <aside className="panel right filter-panel" id={stripPanelId("right")} role="tabpanel" aria-labelledby={sideTabId("filter")} onClick={blurAfterPointerClick}>
      <h3 className="filter-head">Pick</h3>
      <ul className="filter-list">
        {filterRows(view).map((row) => (
          <li key={row.kind}>
            <label className="filter-row">
              <input type="checkbox" checked={filter[row.kind]} onChange={() => onToggle(row.kind)} />
              <span>{row.label}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="filter-note">A kind that is off still draws and stays in the Component tree and the Net list.</p>
    </aside>
  )
}
