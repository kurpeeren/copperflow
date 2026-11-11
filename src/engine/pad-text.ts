import type { PcbLayout, WorldPad } from "./pcb.js"

/**
 * Pads and connections in words, with where they are, so a reader can aim a track at them:
 * "C3.pin2 (12.30, 4.50 top) to U2.pin2 (15.10, 6.00 top)". A through pad says "through".
 */

/** "C3.pin2 (12.30, 4.50 top)" */
export const padPlace = (pad: WorldPad): string => `${pad.pin ?? pad.id} (${pad.x.toFixed(2)}, ${pad.y.toFixed(2)} ${pad.layers})`

/** The layout's pads by id. */
export const padsById = (layout: Pick<PcbLayout, "parts">): Map<string, WorldPad> => new Map(layout.parts.flatMap((part) => part.pads).map((pad) => [pad.id, pad]))

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
