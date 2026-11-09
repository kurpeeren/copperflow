import { EyeIcon } from "../icons"
import { layerRows, type LayerFilter, type LayerId, type LayerVisibility } from "../pcb/layers"
import { blurAfterPointerClick } from "./focus"
import { sideTabId, stripPanelId } from "./SideStrip"
import "./layer-panel.css"

const FILTERS: ReadonlyArray<{ id: LayerFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "copper", label: "Copper" },
  { id: "non-copper", label: "Non-copper" },
]

interface Props {
  visibility: LayerVisibility
  filter: LayerFilter
  /** Keepout is listed only when the board has keepouts. */
  hasKeepouts: boolean
  onFilter(filter: LayerFilter): void
  onToggle(id: LayerId): void
}

/** The PCB's layers: the filters at the top, then a 28px row for each layer with its colour, its name and an eye. */
export function LayerPanel({ visibility, filter, hasKeepouts, onFilter, onToggle }: Props) {
  return (
    <aside className="panel right layer-panel" id={stripPanelId("right")} role="tabpanel" aria-labelledby={sideTabId("layer")} onClick={blurAfterPointerClick}>
      <div className="layer-filters" role="group" aria-label="Show layers">
        {FILTERS.map(({ id, label }) => (
          <button key={id} className={`layer-filter${filter === id ? " on" : ""}`} aria-pressed={filter === id} onClick={() => onFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      <ul className="layer-list">
        {layerRows(hasKeepouts, filter).map((row) => {
          const shown = visibility[row.id]
          return (
            <li key={row.id} className={`layer-row${shown ? "" : " off"}`}>
              <span className="layer-swatch" style={{ background: row.color }} aria-hidden="true" />
              <span className="layer-name">{row.name}</span>
              <button className="layer-eye" aria-pressed={shown} aria-label={`${row.name}: ${shown ? "shown" : "hidden"}`} title={`${shown ? "Hide" : "Show"} ${row.name}`} onClick={() => onToggle(row.id)}>
                <EyeIcon off={!shown} />
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
