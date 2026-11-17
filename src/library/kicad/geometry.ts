// Coordinates of a KiCad board in copperflow's terms. KiCad's y points down, copperflow's up, both in mm. A footprint
// at (x, y) turned θ degrees (counter-clockwise as seen from the top) puts a point it holds at (lx, ly) at
// (x, -y) + R(θ)·(lx, -ly) in copperflow's coordinates; a pad's own turn in the file already includes θ.
import type { Point } from "../../engine/model.js"
import { child, numberAt, type SList } from "./sexpr.js"

/** The largest distance of a straight piece from the arc it stands for, in mm. */
export const ARC_STEP_TOLERANCE = 0.01

export const up = (x: number, y: number): Point => ({ x, y: -y })

export function rotate(p: Point, degrees: number): Point {
  const r = (degrees * Math.PI) / 180
  const [c, s] = [Math.cos(r), Math.sin(r)]
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

/** Degrees in [0, 360). */
export const turn360 = (degrees: number): number => {
  const value = ((degrees % 360) + 360) % 360
  return Math.abs(value - 360) < 1e-9 ? 0 : value
}

/** A list's (name x y) point in copperflow's coordinates, e.g. (start 1 2); undefined when it is missing. */
export function pointOf(list: SList, name: string): Point | undefined {
  const found = child(list, name)
  const [x, y] = [numberAt(found, 1), numberAt(found, 2)]
  return x === undefined || y === undefined ? undefined : up(x, y)
}

/** Where a footprint puts the points it holds. */
export interface Frame {
  at: Point
  /** Degrees, counter-clockwise from the top. */
  angle: number
}

export const BOARD_FRAME: Frame = { at: { x: 0, y: 0 }, angle: 0 }

/** A point a footprint holds (already in copperflow's y-up terms), on the board. */
export function onBoard(frame: Frame, local: Point): Point {
  const turned = rotate(local, frame.angle)
  return { x: frame.at.x + turned.x, y: frame.at.y + turned.y }
}

/** The centre of the circle through three points; undefined when they are on one line. */
export function circleCentre(a: Point, b: Point, c: Point): Point | undefined {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < 1e-12) return undefined
  const [a2, b2, c2] = [a.x ** 2 + a.y ** 2, b.x ** 2 + b.y ** 2, c.x ** 2 + c.y ** 2]
  return { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d }
}

/** An arc through start, mid and end: its centre, radius, start angle and sweep in radians (counter-clockwise when positive). */
export function arcThrough(start: Point, mid: Point, end: Point): { centre: Point; radius: number; start: number; sweep: number } | undefined {
  const centre = circleCentre(start, mid, end)
  if (!centre) return undefined
  const angle = (p: Point) => Math.atan2(p.y - centre.y, p.x - centre.x)
  const [a0, am, a1] = [angle(start), angle(mid), angle(end)]
  const ccw = (from: number, to: number) => ((to - from) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
  const sweep = ccw(a0, am) <= ccw(a0, a1) ? ccw(a0, a1) : ccw(a0, a1) - 2 * Math.PI
  return { centre, radius: Math.hypot(start.x - centre.x, start.y - centre.y), start: a0, sweep }
}

/** Points along an arc through start, mid and end, ends included, each straight piece within ARC_STEP_TOLERANCE of it. */
export function arcPolyline(start: Point, mid: Point, end: Point): Point[] {
  const arc = arcThrough(start, mid, end)
  if (!arc) return [start, end]
  const ratio = 1 - ARC_STEP_TOLERANCE / arc.radius
  const step = ratio <= 0 ? Math.PI / 2 : Math.min(Math.PI / 2, 2 * Math.acos(ratio))
  const count = Math.max(1, Math.ceil(Math.abs(arc.sweep) / step))
  const points = Array.from({ length: count + 1 }, (_, i) => {
    const a = arc.start + (arc.sweep * i) / count
    return { x: arc.centre.x + arc.radius * Math.cos(a), y: arc.centre.y + arc.radius * Math.sin(a) }
  })
  return [start, ...points.slice(1, -1), end]
}

/** The points of a (pts (xy …) (arc (start) (mid) (end)) …) list, arcs as short straight pieces. */
export function ptsPoints(pts: SList | undefined, frame: Frame = BOARD_FRAME): Point[] {
  const found: Point[] = []
  for (const node of pts?.list.slice(1) ?? []) {
    if (!("list" in node)) continue
    const name = node.list[0] && "atom" in node.list[0] ? node.list[0].atom : undefined
    if (name === "xy") {
      const [x, y] = [numberAt(node, 1), numberAt(node, 2)]
      if (x !== undefined && y !== undefined) found.push(onBoard(frame, up(x, y)))
    } else if (name === "arc") {
      const [s, m, e] = [pointOf(node, "start"), pointOf(node, "mid"), pointOf(node, "end")]
      if (s && m && e) found.push(...arcPolyline(onBoard(frame, s), onBoard(frame, m), onBoard(frame, e)))
    }
  }
  return found
}

const tidy = (v: number) => Math.round(v * 10_000) / 10_000 || 0

/** A point moved by `offset`, rounded to 0.1 µm. */
export const moved = (p: Point, offset: Point): Point => ({ x: tidy(p.x + offset.x), y: tidy(p.y + offset.y) })

export { tidy }
