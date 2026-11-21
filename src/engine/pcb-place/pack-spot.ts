import type { Board, Spot } from "./constructive.js"
import { moved, type Box } from "./geometry.js"
import type { Movable } from "./scope.js"

/** How close a side must come to count as lying against a wall or a courtyard, past the clearance (mm). */
const TOUCH = 0.06
/** Spots are put on this step, as the abutting spots of the constructive pass are. */
const STEP = 0.01

const up = (v: number) => Math.ceil(v / STEP - 1e-6) * STEP
const down = (v: number) => Math.floor(v / STEP + 1e-6) * STEP
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

/** How much of the box's sides lie against the area's sides or a placed courtyard, the clearance apart (mm). */
export function contact(board: Board, box: Box): number {
  const a = board.problem.area.box
  const near = board.problem.clearance + TOUCH
  const [width, height] = [box.maxX - box.minX, box.maxY - box.minY]
  let total = 0
  if (box.minX - a.minX < near) total += height
  if (a.maxX - box.maxX < near) total += height
  if (box.minY - a.minY < near) total += width
  if (a.maxY - box.maxY < near) total += width
  const around = { minX: box.minX - near, minY: box.minY - near, maxX: box.maxX + near, maxY: box.maxY + near }
  for (const id of board.index.near(around)) {
    const o = board.index.get(id) as Box
    if (Math.abs(o.minX - box.maxX) < near || Math.abs(box.minX - o.maxX) < near) total += overlap(box.minY, box.maxY, o.minY, o.maxY)
    if (Math.abs(o.minY - box.maxY) < near || Math.abs(box.minY - o.maxY) < near) total += overlap(box.minX, box.maxX, o.minX, o.maxX)
  }
  return total
}

/**
 * The spot for a part on a crowded board: of the spots flush with the area's sides or a placed courtyard on both axes
 * (every rotation), the one whose wire cost less `board.packing` times its contact is least, so the parts fill the
 * board from its walls and corners instead of leaving gaps too small for the last ones. Undefined when none is free.
 */
export function packedSpot(board: Board, m: Movable): Spot | undefined {
  const a = board.problem.area.box
  const gap = board.problem.clearance
  const hosts = board.hosts(m)
  const others = board.index.near(a).map((id) => board.index.get(id) as Box)
  let best: { spot: Spot; cost: number } | undefined
  for (let rot = 0; rot < 4; rot++) {
    const b = m.boxes[rot] as Box
    const xs = [a.minX - b.minX, a.maxX - b.maxX, ...others.flatMap((o) => [up(o.maxX + gap - b.minX), down(o.minX - gap - b.maxX)])]
    const ys = [a.minY - b.minY, a.maxY - b.maxY, ...others.flatMap((o) => [up(o.maxY + gap - b.minY), down(o.minY - gap - b.maxY)])]
    for (const x of xs) {
      for (const y of ys) {
        const spot = { x, y, rot }
        if (!board.fits(m, spot)) continue
        const cost = board.cost(m, spot, hosts) - board.packing * contact(board, moved(b, x, y))
        if (!best || cost < best.cost - 1e-9) best = { spot, cost }
      }
    }
  }
  return best?.spot
}
