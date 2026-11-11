import type { PcbLayout, WorldPad } from "./pcb.js"

/**
 * Pads and connections in words, with where they are, so a reader can aim a track at them:
 * "C3.pin2 (12.30, 4.50 top) to U2.pin2 (15.10, 6.00 top)". A through pad says "through". A pad of a part with no
 * position yet (the build packs it only to draw it; `WorldPad.unplaced`) says "not placed": it has no place to aim at,
 * as check_circuit's `unplaced` warning says. Every answer that names a pad goes through padPlace, so all agree.
 */

/** "C3.pin2 (12.30, 4.50 top)", or "C3.pin2 (not placed)" when its part has no position. */
export const padPlace = (pad: WorldPad): string => (pad.unplaced ? `${pad.pin ?? pad.id} (not placed)` : `${pad.pin ?? pad.id} (${pad.x.toFixed(2)}, ${pad.y.toFixed(2)} ${pad.layers})`)

/** The layout's pads by id. */
export const padsById = (layout: Pick<PcbLayout, "parts">): Map<string, WorldPad> => new Map(layout.parts.flatMap((part) => part.pads).map((pad) => [pad.id, pad]))

/** The parts with no position: those the build packed. */
export const unplacedParts = (layout: Pick<PcbLayout, "parts">): Set<string> => new Set(layout.parts.filter((part) => part.autoPlaced).map((part) => part.component))

/** "C3.pin2 (12.30, 4.50 top) to U2.pin2 (15.10, 6.00 top)"; a pad the layout lacks is named by its id. */
export function connectionPlace(pads: ReadonlyMap<string, WorldPad>, line: { from: string; to: string }): string {
  const one = (id: string) => {
    const pad = pads.get(id)
    return pad === undefined ? id : padPlace(pad)
  }
  return `${one(line.from)} to ${one(line.to)}`
}

/** Each connection the ratsnest still misses, in words, in ratsnest order. */
export const unroutedPlaces = (layout: Pick<PcbLayout, "parts" | "ratsnest">): string[] => {
  const pads = padsById(layout)
  return layout.ratsnest.map((line) => connectionPlace(pads, line))
}
