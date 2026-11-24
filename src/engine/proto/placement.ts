// Parts on the hole grid: which hole each pin goes in, the findings for parts that cannot sit on the grid, and the
// snap that moves a placed part so its pins drop into holes. Pure.
import { violation, type Violation } from "../checks/violation.js"
import type { Point } from "../model.js"
import type { PcbLayout, PlacedFootprint, WorldPad } from "../pcb.js"
import { holeKey, holeName, holePoint, inGrid, nearestHole, ON_HOLE, type Hole, type ProtoGrid } from "./grid.js"

/** A pad in a hole: the hole and the pad. */
export interface PinHole {
  hole: Hole
  pad: WorldPad
}

const mm = (value: number) => value.toFixed(2)
const pinWords = (pad: WorldPad) => `${pad.component} pin ${pad.number}`

/** Whether a part has a position: one auto-placed on a board of no size has none. */
const placed = (part: PlacedFootprint) => Number.isFinite(part.x) && Number.isFinite(part.y) && !part.autoPlaced

/** The hole a pad goes in, when it lies within ON_HOLE of one inside the grid. */
export function holeOf(grid: ProtoGrid, pad: Pick<WorldPad, "x" | "y">): Hole | undefined {
  const { hole, distance } = nearestHole(grid, pad)
  return distance <= ON_HOLE ? hole : undefined
}

/** Every through pad of the placed parts that lies in a hole, by hole key; a hole two pads share keeps the first. */
export function pinHoles(grid: ProtoGrid, parts: readonly PlacedFootprint[]): Map<number, PinHole> {
  const found = new Map<number, PinHole>()
  for (const part of parts.filter(placed)) {
    for (const pad of part.pads) {
      if (pad.layers !== "through") continue
      const hole = holeOf(grid, pad)
      if (hole === undefined) continue
      const key = holeKey(grid, hole)
      if (!found.has(key)) found.set(key, { hole, pad })
    }
  }
  return found
}

/** The pad's offset from the nearest grid line spacing, as words: why a part's pins cannot all sit on the grid. */
function spacingWords(part: PlacedFootprint, pad: WorldPad): string {
  const through = part.pads.filter((one) => one.layers === "through")
  const first = through[0]
  if (first === undefined || first === pad) return "it lies between holes"
  const [dx, dy] = [Math.abs(pad.x - first.x), Math.abs(pad.y - first.y)]
  return `it is ${mm(dx)} x ${mm(dy)} mm from pin ${first.number}, not a whole number of 2.54 mm steps`
}

function partFindings(grid: ProtoGrid, part: PlacedFootprint, taken: Map<number, WorldPad>): Violation[] {
  const surface = part.pads.filter((pad) => pad.layers !== "through")
  if (surface.length > 0) {
    const message = `${part.component} has surface pads (${surface.map((pad) => pad.number).join(", ")}); a ${grid.kind} takes through-hole parts only, so give it a through-hole footprint`
    return [violation("proto-smd", "error", message, [part.component], "pcb", { x: part.x, y: part.y })]
  }
  const found: Violation[] = []
  for (const pad of part.pads) {
    const { hole, distance } = nearestHole(grid, pad)
    const centre = holePoint(grid, hole)
    const outside = !inGrid(grid, hole) || Math.abs(pad.x - centre.x) > grid.pitch / 2 || Math.abs(pad.y - centre.y) > grid.pitch / 2
    if (outside) {
      found.push(violation("proto-outside", "error", `${pinWords(pad)} lies outside the ${grid.kind}'s holes; move ${part.component} onto the board`, [pad.id], "pcb", pad))
      continue
    }
    if (distance > ON_HOLE) {
      const message = `${pinWords(pad)} is ${mm(distance)} mm from hole ${holeName(hole)}: ${spacingWords(part, pad)}, so ${part.component} cannot sit on the grid`
      found.push(violation("proto-off-grid", "error", message, [pad.id], "pcb", pad))
      continue
    }
    const key = holeKey(grid, hole)
    const other = taken.get(key)
    if (other !== undefined) found.push(violation("proto-hole-shared", "error", `${pinWords(pad)} and ${pinWords(other)} are both in hole ${holeName(hole)}`, [pad.id, other.id], "pcb", pad))
    else taken.set(key, pad)
  }
  return found
}

/** The placement findings of a proto board: surface parts, pins off the grid or outside it, and two pins in one hole. */
export function protoPartChecks(layout: Pick<PcbLayout, "board" | "parts">): Violation[] {
  const grid = layout.board?.proto
  if (!grid) return []
  const taken = new Map<number, WorldPad>()
  return layout.parts.filter(placed).flatMap((part) => partFindings(grid, part, taken))
}

/**
 * The part's position moved so that its first through pad lies on the hole nearest it: the part's origin moves by the
 * pad's offset from that hole. Undefined for a part with no through pad.
 */
export function snappedPosition(grid: ProtoGrid, part: Pick<PlacedFootprint, "x" | "y" | "pads">): Point | undefined {
  const first = part.pads.find((pad) => pad.layers === "through")
  if (first === undefined) return undefined
  const centre = holePoint(grid, nearestHole(grid, first).hole)
  return { x: part.x + (centre.x - first.x), y: part.y + (centre.y - first.y) }
}
