import type { LayoutRecord } from "../../core/layout-file.js"
import { resolveCopper, type Copper, type PcbTrack, type PcbVia } from "../copper.js"
import type { Net } from "../model.js"
import type { PlacedFootprint, WorldPad } from "../pcb.js"
import type { PourFill } from "./fill.js"
import { pourJoins } from "./joins.js"

/** Fills the board's pours around the resolved copper (none when the board has no pours). */
export type PourFiller = (pads: readonly WorldPad[], copper: { tracks: readonly PcbTrack[]; vias: readonly PcbVia[] }) => PourFill[]

/**
 * Resolves the copper with the pours in it: first without them (the nets the tracks and vias carry, which the fill keeps
 * clear of or joins), then the fill, then again with what each piece of fill touches joined into one conductor. The
 * second pass gives the same nets (the fill touches only its own net's copper) but the pads' groups and the floating
 * findings now count the fill.
 */
export function resolveWithPours(
  parts: readonly PlacedFootprint[],
  records: readonly LayoutRecord[],
  nets: readonly Net[],
  boardLayers: 2 | 4,
  fill?: PourFiller,
): { copper: Copper; pours: PourFill[] } {
  const first = resolveCopper(parts, records, nets, boardLayers)
  const pads = parts.flatMap((part) => part.pads)
  const pours = fill?.(pads, first) ?? []
  if (pours.length === 0) return { copper: first, pours }
  const joins = pourJoins(pours, pads, first.tracks, first.vias)
  return { copper: resolveCopper(parts, records, nets, boardLayers, joins), pours }
}
