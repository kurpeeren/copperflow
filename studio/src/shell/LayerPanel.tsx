import { EyeIcon } from "../icons"
import { ACTIVE_LAYERS, layerRows, swatchBackground, type ActiveLayer, type LayerFilter, type LayerId, type LayerVisibility } from "../pcb/layers"
import { blurAfterPointerClick } from "./focus"
import { sideTabId, stripPanelId } from "./SideStrip"
import { useTabList } from "./use-tab-list"
import "./layer-panel.css"

const FILTERS: ReadonlyArray<{ id: LayerFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "copper", label: "Copper" },
  { id: "non-copper", label: "Non-copper" },
]
const FILTER_IDS = FILTERS.map((filter) => filter.id)

interface Props {
  visibility: LayerVisibility
  filter: LayerFilter
  /** Keepout is listed only when the board has keepouts. */
  hasKeepouts: boolean
  onFilter(filter: LayerFilter): void
  onToggle(id: LayerId): void
  /** The copper layer tracks are drawn on; V changes it too. */
  active: ActiveLayer
  onActive(layer: ActiveLayer): void
}

/** The active copper layer, as EasyEDA's layer select: tracks are drawn on it, and V switches it. */
function ActiveLayerSelect({ active, onActive }: Pick<Props, "active" | "onActive">) {
  return (
    <label className="layer-active hairline-b" title="The layer tracks are drawn on (V)">
      Active layer
      <select value={active} onChange={(event) => onActive(event.target.value as ActiveLayer)}>
        {ACTIVE_LAYERS.map((layer) => (
          <option key={layer.id} value={layer.id}>
            {layer.name}
          </option>
        ))}
      </select>
    </label>
  )
}

/** All, Copper or Non-copper, one of three as a radio group: the arrow keys move the choice, Tab reaches the chosen one. */
function LayerFilters({ filter, onFilter }: Pick<Props, "filter" | "onFilter">) {
  const radios = useTabList({ ids: FILTER_IDS, current: filter, onSelect: onFilter })
  return (
    <div className="layer-filters hairline-b" role="radiogroup" aria-label="Show layers" onKeyDown={radios.onKeyDown}>
      {FILTERS.map(({ id, label }) => (
        <button key={id} className={`layer-filter${filter === id ? " on" : ""}`} role="radio" aria-checked={filter === id} {...radios.tab(id)}>
          {label}
        </button>
      ))}
    </div>
  )
}

/** The PCB's layers: the filters at the top, the active layer, then a 28px row for each layer with its colour, its name and an eye. */
export function LayerPanel({ visibility, filter, hasKeepouts, onFilter, onToggle, active, onActive }: Props) {
  return (
    <aside className="panel right layer-panel" id={stripPanelId("right")} role="tabpanel" aria-labelledby={sideTabId("layer")} onClick={blurAfterPointerClick}>
      <LayerFilters filter={filter} onFilter={onFilter} />
      <ActiveLayerSelect active={active} onActive={onActive} />
      <ul className="layer-list">
        {layerRows(hasKeepouts, filter).map((row) => {
          const shown = visibility[row.id]
          return (
            <li key={row.id} className={`layer-row${shown ? "" : " off"}`}>
              <span className="layer-swatch" style={{ background: swatchBackground(row) }} aria-hidden="true" />
              <span className="layer-name">{row.name}</span>
              {/* The name is the label; aria-pressed says whether the layer is shown. */}
              <button className="layer-eye" aria-pressed={shown} aria-label={row.name} title={`${shown ? "Hide" : "Show"} ${row.name}`} onClick={() => onToggle(row.id)}>
                <EyeIcon off={!shown} />
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
