import { padShape } from "../checks/geometry.js"
import { pourJoins } from "../pour/joins.js"
import { STEP } from "./astar.js"
import { cellsNear, type RouterWorld } from "./grid.js"

/**
 * Keep-clear around pads a pour joins. Such a pad has no ratsnest line (its fill makes the connection), so nothing
 * stops other nets' tracks from passing all round it; once the fill is computed again around them, the pad is cut off
 * and walled in. So in the first run the cells around each such pad, on the fill's layer, cost other nets' tracks a
 * little more: a price, not a wall, so a track still passes there when there is no other way. Only for a net poured on
 * one layer: poured on two, a cut-off pad still reaches the other fill through a via.
 */

/** How far beyond the pad's copper the keep-clear reaches, in mm: about one track and its gap. */
const KEEP_REACH = 0.6
/** What a kept-clear cell costs another net's track, on top of its other costs. */
export const KEEP_COST = 3 * STEP

export interface KeepClear {
  /** Per layer (as in the frame), per board cell: 0, or 1 + the index in `nets` of the pad's net. */
  track: Int32Array[]
  nets: readonly string[]
}

/** The keep-clear of the layout's pours, or undefined when no pour joins a pad. */
export function keepClearOf(world: RouterWorld): KeepClear | undefined {
  const { layout, frame } = world
  if (layout.pours.length === 0) return undefined
  const pads = layout.parts.flatMap((part) => part.pads)
  const byId = new Map(pads.map((pad) => [pad.id, pad]))
  const cells = frame.cols * frame.rows
  const track = frame.layers.map(() => new Int32Array(cells))
  const nets: string[] = []
  let any = false
  const layersOf = (net: string) => new Set(layout.pours.filter((one) => one.net === net).map((one) => one.layer))
  for (const fill of layout.pours) {
    const l = frame.layers.indexOf(fill.layer)
    // A net poured on two layers gives a cut-off pad a way out through a via: no keep-clear needed, and it would only crowd.
    if (l < 0 || layersOf(fill.net).size > 1) continue
    const joined = new Set(pourJoins([fill], pads, layout.tracks, layout.vias).flat())
    for (const id of [...joined].sort()) {
      const pad = byId.get(id)
      const shape = pad === undefined ? undefined : padShape(pad)
      if (pad?.net === undefined || shape === undefined) continue
      const net = nets.indexOf(pad.net) >= 0 ? nets.indexOf(pad.net) : nets.push(pad.net) - 1
      const map = track[l] as Int32Array
      cellsNear(frame, shape, KEEP_REACH, (cell) => {
        if (map[cell] === 0) map[cell] = net + 1
      })
      any = true
    }
  }
  return any ? { track, nets } : undefined
}
