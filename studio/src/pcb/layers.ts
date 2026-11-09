// The PCB's layers as the Layer panel lists them: their names, colours and groups, which of them are shown, and which
// layers a part draws on (so a part whose layers are all hidden cannot be picked). Plain TypeScript with .js imports,
// so the tests can run it.
import type { PlacedFootprint } from "../../../src/engine/pcb.js"
import { PALETTE } from "./ctx.js"

export const LAYER_IDS = ["top", "bottom", "topSilk", "bottomSilk", "topAssembly", "bottomAssembly", "courtyard", "boardOutline", "multiLayer", "hole", "ratline", "keepout"] as const
export type LayerId = (typeof LAYER_IDS)[number]

export type LayerGroup = "copper" | "non-copper"
/** The Layer panel's filter buttons. */
export type LayerFilter = "all" | LayerGroup

export interface LayerRow {
  id: LayerId
  name: string
  group: LayerGroup
  /** The colour the layer is drawn in, and the swatch's. */
  color: string
}

const LAYER_ROWS: readonly LayerRow[] = [
  { id: "top", name: "Top Layer", group: "copper", color: PALETTE.topCopper },
  { id: "bottom", name: "Bottom Layer", group: "copper", color: PALETTE.bottomCopper },
  { id: "topSilk", name: "Top Silkscreen", group: "non-copper", color: PALETTE.topSilk },
  { id: "bottomSilk", name: "Bottom Silkscreen", group: "non-copper", color: PALETTE.bottomSilk },
  { id: "topAssembly", name: "Top Assembly", group: "non-copper", color: PALETTE.topAssembly },
  { id: "bottomAssembly", name: "Bottom Assembly", group: "non-copper", color: PALETTE.bottomAssembly },
  { id: "courtyard", name: "Courtyard", group: "non-copper", color: PALETTE.topAssembly },
  { id: "boardOutline", name: "Board Outline", group: "non-copper", color: PALETTE.boardEdge },
  { id: "multiLayer", name: "Multi-Layer", group: "copper", color: PALETTE.multiLayer },
  { id: "hole", name: "Hole", group: "non-copper", color: PALETTE.drill },
  { id: "ratline", name: "Ratline", group: "non-copper", color: PALETTE.ratsnest },
  { id: "keepout", name: "Keepout", group: "non-copper", color: PALETTE.keepout },
]

/** The panel's rows: Keepout only when the board has keepouts, and only the layers the filter names. */
export function layerRows(hasKeepouts: boolean, filter: LayerFilter): LayerRow[] {
  return LAYER_ROWS.filter((row) => (hasKeepouts || row.id !== "keepout") && (filter === "all" || row.group === filter))
}

export type LayerVisibility = Readonly<Record<LayerId, boolean>>

/** Every layer is shown at first except the two assembly layers (fabrication outlines), so the board looks as it always has. */
export const DEFAULT_LAYERS: LayerVisibility = {
  ...(Object.fromEntries(LAYER_IDS.map((id) => [id, true])) as Record<LayerId, boolean>),
  topAssembly: false,
  bottomAssembly: false,
}

/** A new record with `id` switched. */
export function toggleLayer(visibility: LayerVisibility, id: LayerId): LayerVisibility {
  return { ...visibility, [id]: !visibility[id] }
}

/** The part as far as its layers go. Fabrication outlines are drawn on the assembly layer of the side; courtyards on their own layer. */
type LayeredPart = Pick<PlacedFootprint, "side" | "pads" | "silkscreen" | "fabrication">

/** The copper layer a pad is drawn on: through-hole pads are on Multi-Layer. */
export function padLayer(pad: Pick<PlacedFootprint["pads"][number], "layers">): LayerId {
  return pad.layers === "through" ? "multiLayer" : pad.layers === "bottom" ? "bottom" : "top"
}

/** The layers a part draws on. */
export function partLayers(part: LayeredPart): LayerId[] {
  const top = part.side === "top"
  const layers = new Set<LayerId>(["courtyard"])
  if (part.fabrication.length > 0) layers.add(top ? "topAssembly" : "bottomAssembly")
  if (part.silkscreen.length > 0) layers.add(top ? "topSilk" : "bottomSilk")
  for (const pad of part.pads) {
    layers.add(padLayer(pad))
    if (pad.drill) layers.add("hole")
  }
  return [...layers]
}

/** Whether any of `layers` is shown. */
export function anyLayerShown(layers: readonly LayerId[], visibility: LayerVisibility): boolean {
  return layers.some((id) => visibility[id])
}

/** What a pick asks about the PCB's layers: which are shown, and the layers each part draws on. */
export interface PickLayers {
  visible: LayerVisibility
  /** The layers the part draws on; undefined for a name the board does not draw, which stays pickable. */
  of(part: string): readonly LayerId[] | undefined
}

/** The pick question for a board: its parts' layers are looked up once per design. */
export function pickLayersOf(parts: readonly (LayeredPart & { component: string })[], visible: LayerVisibility): PickLayers {
  const byPart = new Map(parts.map((part) => [part.component, partLayers(part)]))
  return { visible, of: (name) => byPart.get(name) }
}
