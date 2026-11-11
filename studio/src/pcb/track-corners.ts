// The corner modes of the PCB's track tool, as EasyEDA routes: 45° (the straight run first along the longer axis,
// then a 45° leg), the same reversed (the 45° leg first), 90° (the schematic's square rule, horizontal first) and
// arc (the 90° elbow rounded into a quarter arc). Space and L (Route → Routing corner) step through them. Pure; plain
// TypeScript with .js imports, so the tests can run it.
import { filletTrack } from "../../../src/engine/fillet.js"
import { tidyTrack } from "./copper-geometry.js"
import { roundPosition, type Point } from "./geometry.js"
import { squarePath } from "./wire-path.js"

export const CORNER_MODES = ["45", "45r", "90", "arc"] as const
export type CornerMode = (typeof CORNER_MODES)[number]

const NAMES: Readonly<Record<CornerMode, string>> = { "45": "45°", "45r": "45° reversed", "90": "90°", arc: "Arc" }

export const cornerModeName = (mode: CornerMode): string => NAMES[mode]

/** The mode Space steps to. */
export function nextCornerMode(mode: CornerMode): CornerMode {
  return CORNER_MODES[(CORNER_MODES.indexOf(mode) + 1) % CORNER_MODES.length] as CornerMode
}

const at = (x: number, y: number): Point => ({ x: roundPosition(x), y: roundPosition(y) })

/** The 45° elbow from `from` towards `to`: after the straight run (`straightFirst`) or after the 45° leg. */
function elbow45(from: Point, to: Point, straightFirst: boolean): Point {
  const [dx, dy] = [to.x - from.x, to.y - from.y]
  const diagonal = Math.min(Math.abs(dx), Math.abs(dy))
  const [sx, sy] = [Math.sign(dx), Math.sign(dy)]
  if (!straightFirst) return at(from.x + sx * diagonal, from.y + sy * diagonal)
  return Math.abs(dx) > Math.abs(dy) ? at(from.x + sx * (Math.abs(dx) - diagonal), from.y) : at(from.x, from.y + sy * (Math.abs(dy) - diagonal))
}

/** The points of one leg after `from`, ending at `to`: one elbow at most. */
export function cornerLeg(from: Point, to: Point, mode: CornerMode): Point[] {
  const [adx, ady] = [Math.abs(to.x - from.x), Math.abs(to.y - from.y)]
  if (adx === 0 || ady === 0 || adx === ady) return [to]
  if (mode === "90") return squarePath([from, to]).slice(1)
  if (mode === "arc") return arcLeg(from, to)
  return [elbow45(from, to, mode === "45"), to]
}

/** How much of the shorter leg the arc takes: nearly all, leaving the little straight the fillet keeps. */
const ARC_SHARE = 0.98

/** The square elbow rounded with about the largest arc both legs hold: a quarter arc tangent to them. */
function arcLeg(from: Point, to: Point): Point[] {
  const square = [from, ...squarePath([from, to]).slice(1)]
  const radius = ARC_SHARE * Math.min(Math.abs(to.x - from.x), Math.abs(to.y - from.y))
  // The arc's points stay as computed: rounding them to the grid would bend the curve.
  return filletTrack(square, radius, 0).points.slice(1)
}

export interface CornerLegSpec {
  to: Point
  mode: CornerMode
}

/** The track from `start` through each leg in its own mode, tidied (copper-geometry.ts tidyTrack). */
export function routePoints(start: Point, legs: readonly CornerLegSpec[]): Point[] {
  const points: Point[] = [start]
  let from = start
  for (const leg of legs) {
    points.push(...cornerLeg(from, leg.to, leg.mode))
    from = leg.to
  }
  return tidyTrack(points)
}
