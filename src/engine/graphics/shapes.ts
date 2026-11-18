// The plain shapes a drawing (SVG or DXF) is read into, and the steps every reader ends with: rings wound the agreed
// way, neighbours deduplicated, the whole moved so its bounds start at (0, 0).
import type { Point } from "../model.js"

/** A drawing as plain shapes. Lengths in mm, y up, the drawing's bounds starting at (0, 0). */
export interface GraphicShapes {
  /** Filled areas: an outer ring, counter-clockwise, and its holes, clockwise. Rings are not closed (the last point joins the first) and have no repeated neighbours. */
  fills: { outer: Point[]; holes: Point[][] }[]
  /** Lines with their own width in mm (0 when the source gives none); `closed` joins the last point to the first. */
  strokes: { points: Point[]; width: number; closed: boolean }[]
  /** The drawing's size in mm. */
  width: number
  height: number
  /** What was left out, in words for a person: "2 text elements", "1 embedded image". */
  skipped: string[]
}

export type GraphicKind = "svg" | "dxf"

export type GraphicFill = GraphicShapes["fills"][number]
export type GraphicStroke = GraphicShapes["strokes"][number]

/** The largest distance of a flattened curve from the curve, in mm: a quarter of a pixel in a picture at 50 px per mm. */
export const CURVE_TOLERANCE_MM = 0.005
/** The most points one curve segment is flattened into. */
export const MAX_POINTS_PER_CURVE = 1000
/** The most points a whole drawing may come to. */
export const MAX_TOTAL_POINTS = 200_000
/** The largest drawing read, in mm across: anything larger is a mistake in the file or its units. */
export const MAX_DRAWING_MM = 10_000
/** Neighbouring points closer than this (mm) are one point. */
const SAME_POINT_MM = 1e-9

export class GraphicError extends Error {}

/** Twice-signed area; positive when counter-clockwise (y up). */
export function signedArea(ring: readonly Point[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Point
    const b = ring[(i + 1) % ring.length] as Point
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

/** The ring without repeated neighbours and without a closing copy of its first point. */
export function cleanRing(points: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out.at(-1)
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > SAME_POINT_MM) out.push(p)
  }
  while (out.length > 1) {
    const first = out[0] as Point
    const last = out.at(-1) as Point
    if (Math.hypot(first.x - last.x, first.y - last.y) > SAME_POINT_MM) break
    out.pop()
  }
  return out
}

/** The ring wound counter-clockwise (`ccw` true) or clockwise. */
export function wound(ring: readonly Point[], ccw: boolean): Point[] {
  return signedArea(ring) > 0 === ccw ? [...ring] : [...ring].reverse()
}

export function countPoints(fills: readonly GraphicFill[], strokes: readonly GraphicStroke[]): number {
  const inFills = fills.reduce((sum, f) => sum + f.outer.length + f.holes.reduce((s, h) => s + h.length, 0), 0)
  return inFills + strokes.reduce((sum, s) => sum + s.points.length, 0)
}

function allPoints(fills: readonly GraphicFill[], strokes: readonly GraphicStroke[]): Point[] {
  return [...fills.flatMap((f) => [f.outer, ...f.holes].flat()), ...strokes.flatMap((s) => s.points)]
}

/**
 * The finished drawing: shapes moved so the bounds start at (0, 0). The bounds are those of the points (a stroke's
 * centre line, not its width), so the placing side sees exactly the geometry it was given.
 */
export function finish(fills: readonly GraphicFill[], strokes: readonly GraphicStroke[], skipped: readonly string[]): GraphicShapes {
  const points = allPoints(fills, strokes)
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new GraphicError("The drawing has a coordinate that is not a finite number")
  if (points.length > MAX_TOTAL_POINTS) throw new GraphicError(`The drawing comes to more than ${MAX_TOTAL_POINTS} points; simplify it first`)
  if (points.length === 0) return { fills: [], strokes: [], width: 0, height: 0, skipped: [...skipped] }
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  if (maxX - minX > MAX_DRAWING_MM || maxY - minY > MAX_DRAWING_MM) throw new GraphicError(`The drawing is ${Math.round(Math.max(maxX - minX, maxY - minY))} mm across, more than ${MAX_DRAWING_MM} mm; check its units`)
  const move = (p: Point): Point => ({ x: p.x - minX, y: p.y - minY })
  return {
    fills: fills.map((f) => ({ outer: f.outer.map(move), holes: f.holes.map((h) => h.map(move)) })),
    strokes: strokes.map((s) => ({ ...s, points: s.points.map(move) })),
    width: maxX - minX,
    height: maxY - minY,
    skipped: [...skipped],
  }
}

/** "2 text elements" from a count and a singular noun phrase; plural by adding "s" unless given. */
export function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
