// DXF entities as drawn shapes in the drawing's own units: the board-outline reader's entities (LINE, ARC, CIRCLE,
// LWPOLYLINE, POLYLINE) and the ones read here from their pairs (ELLIPSE, SPLINE, SOLID, HATCH). DXF outlines carry
// no fill, so closed outlines are closed strokes; SOLID and the polyline boundaries of a HATCH are fills.
import type { Point } from "../model.js"
import type { DxfEntity, DxfVertex } from "../dxf/index.js"
import { ellipsePoints } from "./curves.js"
import { numberAt, numbersOf, pointAt, pointsOf, type Group, type Pair } from "./dxf-pairs.js"
import { MAX_POINTS_PER_CURVE } from "./shapes.js"

export type Drawn = { kind: "stroke"; points: Point[]; closed: boolean } | { kind: "fill"; rings: Point[][] }

const FULL_TURN = 2 * Math.PI
/** Samples per control point of a spline. */
const SPLINE_SAMPLES_PER_CONTROL = 16
const HATCH_POLYLINE_PATH = 2

const circle = (centre: Point, r: number, start: number, sweep: number, tol: number) => ellipsePoints({ centre, rx: r, ry: r, phi: 0 }, start, sweep, tol)

/** The points after `a` along the arc a bulge names, ending at `b`. */
export function bulgePoints(a: Point, b: Point, bulge: number, tol: number): Point[] {
  const d = Math.hypot(b.x - a.x, b.y - a.y)
  if (bulge === 0 || d === 0) return [b]
  const theta = 4 * Math.atan(bulge)
  const h = d / 2 / Math.tan(theta / 2)
  const centre = { x: (a.x + b.x) / 2 - ((b.y - a.y) / d) * h, y: (a.y + b.y) / 2 + ((b.x - a.x) / d) * h }
  const start = Math.atan2(a.y - centre.y, a.x - centre.x)
  return [...circle(centre, Math.hypot(a.x - centre.x, a.y - centre.y), start, theta, tol).slice(0, -1), b]
}

function polyline(vertices: readonly DxfVertex[], closed: boolean, tol: number): Point[] {
  const first = vertices[0]
  if (!first) return []
  const points: Point[] = [first]
  const edges = closed ? vertices.length : vertices.length - 1
  for (let i = 0; i < edges; i++) points.push(...bulgePoints(vertices[i] as DxfVertex, vertices[(i + 1) % vertices.length] as DxfVertex, (vertices[i] as DxfVertex).bulge, tol))
  return closed ? points.slice(0, -1) : points
}

/** An entity the board-outline reader read, as a stroke. */
export function drawnFromEntity(e: DxfEntity, tol: number): Drawn {
  switch (e.type) {
    case "LINE":
      return { kind: "stroke", points: [e.start, e.end], closed: false }
    case "CIRCLE":
      return { kind: "stroke", points: circle(e.centre, e.radius, 0, FULL_TURN, tol), closed: true }
    case "ARC": {
      const start = (e.startAngle * Math.PI) / 180
      let sweep = ((e.endAngle - e.startAngle) * Math.PI) / 180
      while (sweep <= 0) sweep += FULL_TURN
      const from = { x: e.centre.x + e.radius * Math.cos(start), y: e.centre.y + e.radius * Math.sin(start) }
      return { kind: "stroke", points: [from, ...circle(e.centre, e.radius, start, Math.min(sweep, FULL_TURN), tol)], closed: false }
    }
    default:
      return { kind: "stroke", points: polyline(e.vertices, e.closed, tol), closed: e.closed }
  }
}

function ellipse(pairs: readonly Pair[], tol: number): Drawn {
  const centre = pointAt(pairs, 10)
  const major = pointAt(pairs, 11)
  const rx = Math.hypot(major.x, major.y)
  const ry = rx * numberAt(pairs, 40)
  const start = numberAt(pairs, 41, 0)
  let sweep = numberAt(pairs, 42, FULL_TURN) - start
  while (sweep <= 0) sweep += FULL_TURN
  sweep = Math.min(sweep, FULL_TURN)
  const e = { centre, rx, ry, phi: Math.atan2(major.y, major.x) }
  const points = ellipsePoints(e, start, sweep, tol)
  // A full turn ends where it starts, so its points are already a ring; a part needs its start point in front.
  if (Math.abs(sweep - FULL_TURN) < 1e-9) return { kind: "stroke", points, closed: true }
  return { kind: "stroke", points: [...ellipsePoints(e, start, 0, tol), ...points], closed: false }
}

/** de Boor's algorithm on homogeneous points: the curve at t, inside span k. */
function deBoor(t: number, k: number, p: number, knots: readonly number[], ctrl: readonly Point[], weights: readonly number[]): Point {
  const d = Array.from({ length: p + 1 }, (_, j) => {
    const i = j + k - p
    const w = weights[i] ?? 1
    return { x: (ctrl[i] as Point).x * w, y: (ctrl[i] as Point).y * w, w }
  })
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p
      const span = (knots[i + p - r + 1] as number) - (knots[i] as number)
      const alpha = span === 0 ? 0 : (t - (knots[i] as number)) / span
      const [lo, hi] = [d[j - 1] as { x: number; y: number; w: number }, d[j] as { x: number; y: number; w: number }]
      d[j] = { x: (1 - alpha) * lo.x + alpha * hi.x, y: (1 - alpha) * lo.y + alpha * hi.y, w: (1 - alpha) * lo.w + alpha * hi.w }
    }
  }
  const last = d[p] as { x: number; y: number; w: number }
  return { x: last.x / last.w, y: last.y / last.w }
}

/**
 * A SPLINE sampled evenly in its parameter: a simple evaluation of the control points with their knots and weights,
 * 16 samples per control point (not held to the curve tolerance). Undefined when its knots do not fit its controls.
 */
function spline(pairs: readonly Pair[]): Drawn | undefined {
  const closed = (numberAt(pairs, 70, 0) & 1) === 1
  const ctrl = pointsOf(pairs, 10)
  if (ctrl.length === 0) {
    const fit = pointsOf(pairs, 11)
    return fit.length >= 2 ? { kind: "stroke", points: fit, closed } : undefined
  }
  const p = numberAt(pairs, 71, 3)
  const knots = numbersOf(pairs, 40)
  const weights = numbersOf(pairs, 41)
  const n = ctrl.length
  if (!Number.isInteger(p) || p < 1 || p > 10 || n <= p || knots.length !== n + p + 1 || knots.some((k, i) => i > 0 && k < (knots[i - 1] as number))) return undefined
  const [t0, t1] = [knots[p] as number, knots[n] as number]
  if (!(t1 > t0)) return undefined
  const samples = Math.min(MAX_POINTS_PER_CURVE, n * SPLINE_SAMPLES_PER_CONTROL)
  const points = Array.from({ length: samples + 1 }, (_, s) => {
    const t = t0 + ((t1 - t0) * s) / samples
    let k = p
    while (k < n - 1 && (knots[k + 1] as number) <= t) k++
    return deBoor(t, k, p, knots, ctrl, weights)
  })
  return { kind: "stroke", points, closed }
}

function solid(pairs: readonly Pair[]): Drawn {
  const [a, b, c] = [pointAt(pairs, 10), pointAt(pairs, 11), pointAt(pairs, 12)]
  const d = pointAt(pairs, 13, Number.NaN)
  const quad = Number.isNaN(d.x) || (d.x === c.x && d.y === c.y)
  return { kind: "fill", rings: [quad ? [a, b, c] : [a, b, d, c]] }
}

/** A HATCH's polyline boundaries as rings; its boundaries made of edges are counted in `edgePaths`. */
function hatch(pairs: readonly Pair[], tol: number): { drawn?: Drawn; edgePaths: number } {
  const start = pairs.findIndex((p) => p.code === 91)
  const rings: Point[][] = []
  let edgePaths = 0
  for (let i = start + 1; start !== -1 && i < pairs.length; i++) {
    const pair = pairs[i] as Pair
    if (pair.code === 75 || pair.code === 98) break
    if (pair.code !== 92) continue
    if ((Number(pair.value) & HATCH_POLYLINE_PATH) === 0) {
      edgePaths++
      continue
    }
    const { ring, next } = hatchPolyline(pairs, i + 1, tol)
    rings.push(ring)
    i = next - 1
  }
  return { drawn: rings.length > 0 ? { kind: "fill", rings } : undefined, edgePaths }
}

function hatchPolyline(pairs: readonly Pair[], from: number, tol: number): { ring: Point[]; next: number } {
  const vertices: DxfVertex[] = []
  let count = Infinity
  let i = from
  for (; i < pairs.length && vertices.length <= count; i++) {
    const pair = pairs[i] as Pair
    const last = vertices.at(-1)
    if (pair.code === 93) count = Number(pair.value)
    else if (pair.code === 10) {
      if (vertices.length === count) break
      vertices.push({ x: Number(pair.value), y: Number.NaN, bulge: 0 })
    } else if (pair.code === 20 && last) last.y = Number(pair.value)
    else if (pair.code === 42 && last) last.bulge = Number(pair.value)
    else if (pair.code === 92 || pair.code === 97) break
  }
  return { ring: polyline(vertices, true, tol), next: i }
}

/** An entity read from its pairs, or a word for why it was left out. */
export function drawnFromGroup(g: Group, tol: number): { drawn?: Drawn; leftOut?: string } {
  switch (g.type) {
    case "ELLIPSE":
      return { drawn: ellipse(g.pairs, tol) }
    case "SPLINE": {
      const drawn = spline(g.pairs)
      return drawn ? { drawn } : { leftOut: "SPLINE with knots that do not fit its control points" }
    }
    case "SOLID":
      return { drawn: solid(g.pairs) }
    case "HATCH": {
      const { drawn, edgePaths } = hatch(g.pairs, tol)
      return { drawn, leftOut: edgePaths > 0 ? "HATCH boundary made of edges, not a polyline" : undefined }
    }
    default:
      return { leftOut: g.type }
  }
}
