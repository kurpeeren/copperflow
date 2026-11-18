import type { LayoutRecord } from "../../core/layout-file.js"
import { resolveCopper, type Copper, type PcbTrack, type PcbVia } from "../copper.js"
import { joinsWithDrawings, netDrawingFills } from "../drawing-copper.js"
import type { BoardGraphic, Net } from "../model.js"
import type { PlacedFootprint, WorldPad } from "../pcb.js"
import type { PourFill } from "./fill.js"
import { pourJoins } from "./joins.js"

/** Fills the board's pours around the resolved copper (none when the board has no pours). */
export type PourFiller = (pads: readonly WorldPad[], copper: { tracks: readonly PcbTrack[]; vias: readonly PcbVia[] }) => PourFill[]

/**
 * Resolves the copper with the drawings on nets and the pours in it: first without them (the nets the tracks and vias
 * carry), then with what each drawing on a net touches joined into one conductor, then the fill around that copper,
 * then again with what each piece of fill touches (and the drawings of its net it meets) joined too. The later passes
 * give the same nets (a drawing or a fill joins only its own net's copper) but the pads' groups and the floating
 * findings now count the drawings and the fill.
 */
export function resolveWithPours(
  parts: readonly PlacedFootprint[],
  records: readonly LayoutRecord[],
  nets: readonly Net[],
  boardLayers: 2 | 4,
  fill?: PourFiller,
  graphics?: readonly BoardGraphic[],
): { copper: Copper; pours: PourFill[]; bare: Copper } {
  const first = resolveCopper(parts, records, nets, boardLayers)
  const pads = parts.flatMap((part) => part.pads)
  const drawings = netDrawingFills(graphics)
  // `bare` is the copper without the fill's joins: its islands give the ratsnest as it would be with no pours.
  const bare = drawings.length === 0 ? first : resolveCopper(parts, records, nets, boardLayers, pourJoins(drawings, pads, first.tracks, first.vias))
  const pours = fill?.(pads, bare) ?? []
  if (pours.length === 0) return { copper: bare, pours, bare }
  const joins = joinsWithDrawings(pours, drawings, pads, bare.tracks, bare.vias)
  return { copper: resolveCopper(parts, records, nets, boardLayers, joins), pours, bare }
}
