import type { Point } from "../model.js"
import type { WorldPad } from "../pcb.js"
import type { Box } from "./grid-index.js"

/**
 * A convex core (a point, a segment or a convex polygon) grown by a radius.
 * Every function here relies on the cores being convex.
 */
export interface Shape {
  core: Point[]
  radius: number
}

const DEG = Math.PI / 180
const EPS = 1e-12
const SEPARATION_TOLERANCE = 1e-9

function turn(local: Point, pad: WorldPad): Point {
  const cos = Math.cos(pad.rotation * DEG)
  const sin = Math.sin(pad.rotation * DEG)
  return { x: pad.x + local.x * cos - local.y * sin, y: pad.y + local.x * sin + local.y * cos }
}

/** The core of a box with half sides hw and hh, in the pad's frame, then placed in the world. */
function boxCore(pad: WorldPad, hw: number, hh: number): Point[] {
  if (hw <= EPS && hh <= EPS) return [turn({ x: 0, y: 0 }, pad)]
  if (hh <= EPS) return [turn({ x: -hw, y: 0 }, pad), turn({ x: hw, y: 0 }, pad)]
  if (hw <= EPS) return [turn({ x: 0, y: -hh }, pad), turn({ x: 0, y: hh }, pad)]
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ]
  return corners.map((c) => turn(c, pad))
}

/** A capsule: a point when the sides match, otherwise a segment along the long side. */
function capsule(pad: WorldPad, width: number, height: number): Shape {
  const short = Math.min(width, height)
  const reach = (Math.max(width, height) - short) / 2
  const core = width >= height ? boxCore(pad, reach, 0) : boxCore(pad, 0, reach)
  return { core, radius: short / 2 }
}

export function padShape(pad: WorldPad): Shape | undefined {
  switch (pad.shape) {
    case "rect":
      return { core: boxCore(pad, pad.width / 2, pad.height / 2), radius: 0 }
    case "roundrect": {
      const radius = Math.min(Math.max(pad.cornerRadius ?? 0, 0), pad.width / 2, pad.height / 2)
      return { core: boxCore(pad, pad.width / 2 - radius, pad.height / 2 - radius), radius }
    }
    case "circle":
      return { core: [turn({ x: 0, y: 0 }, pad)], radius: pad.width / 2 }
    case "oval":
      return capsule(pad, pad.width, pad.height)
    default:
      return undefined
  }
}

export function drillShape(pad: WorldPad): Shape | undefined {
  const drill = pad.drill
  if (drill === undefined || !(drill.width > 0) || !(drill.height > 0)) return undefined
  return capsule(pad, drill.width, drill.height)
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x
}

function pointSegment(p: Point, a: Point, b: Point): { distance: number; at: Point } {
  const ab = sub(b, a)
  const length2 = ab.x * ab.x + ab.y * ab.y
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / length2))
  const at = { x: a.x + ab.x * t, y: a.y + ab.y * t }
  return { distance: Math.hypot(p.x - at.x, p.y - at.y), at }
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): Point | undefined {
  const r = sub(b, a)
  const s = sub(d, c)
  const denominator = cross(r, s)
  if (denominator === 0) return undefined
  const t = cross(sub(c, a), s) / denominator
  const u = cross(sub(c, a), r) / denominator
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined
  return { x: a.x + r.x * t, y: a.y + r.y * t }
}

interface Closest {
  distance: number
  from: Point
  to: Point
}

function segmentPair(a: Point, b: Point, c: Point, d: Point): Closest {
  const hit = segmentsCross(a, b, c, d)
  if (hit !== undefined) return { distance: 0, from: hit, to: hit }
  const candidates: Closest[] = []
  for (const p of [a, b]) {
    const q = pointSegment(p, c, d)
    candidates.push({ distance: q.distance, from: p, to: q.at })
  }
  for (const p of [c, d]) {
    const q = pointSegment(p, a, b)
    candidates.push({ distance: q.distance, from: q.at, to: p })
  }
  return candidates.reduce((best, next) => (next.distance < best.distance ? next : best))
}

/** The edges of a core: a point is a zero-length segment, a polygon is closed. */
function edges(core: readonly Point[]): [Point, Point][] {
  if (core.length === 1) return [[core[0]!, core[0]!]]
  if (core.length === 2) return [[core[0]!, core[1]!]]
  return core.map((p, i): [Point, Point] => [p, core[(i + 1) % core.length]!])
}

export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function containedPoint(outer: readonly Point[], inner: readonly Point[]): Point | undefined {
  if (outer.length < 3) return undefined
  return inner.find((p) => pointInPolygon(p, outer))
}

function coreClosest(a: readonly Point[], b: readonly Point[]): Closest {
  const inside = containedPoint(a, b) ?? containedPoint(b, a)
  if (inside !== undefined) return { distance: 0, from: inside, to: inside }
  let best: Closest | undefined
  for (const [p, q] of edges(a)) {
    for (const [r, s] of edges(b)) {
      const next = segmentPair(p, q, r, s)
      if (best === undefined || next.distance < best.distance) best = next
    }
  }
  return best!
}

/**
 * Edge-to-edge gap between two shapes. It is 0 or negative when they touch or overlap, and exactly 0
 * when two radius-0 cores overlap. Use `polygonsOverlap` when an overlap test is needed.
 */
export function shapeDistance(a: Shape, b: Shape): number {
  return coreClosest(a.core, b.core).distance - a.radius - b.radius
}

function towards(from: Point, to: Point, by: number): Point {
  const d = Math.hypot(to.x - from.x, to.y - from.y)
  if (d === 0) return from
  return { x: from.x + ((to.x - from.x) / d) * by, y: from.y + ((to.y - from.y) / d) * by }
}

/** The nearest points on the two outlines. Where the cores touch or overlap, the core points themselves. */
export function closestPoints(a: Shape, b: Shape): [Point, Point] {
  const { from, to } = coreClosest(a.core, b.core)
  return [towards(from, to, a.radius), towards(to, from, b.radius)]
}

export function shapeToSegmentDistance(a: Shape, p: Point, q: Point): number {
  return coreClosest(a.core, [p, q]).distance - a.radius
}

function axisGap(a: readonly Point[], b: readonly Point[], axis: Point): number {
  const project = (poly: readonly Point[]) => poly.map((v) => v.x * axis.x + v.y * axis.y)
  const pa = project(a)
  const pb = project(b)
  return Math.max(Math.min(...pa), Math.min(...pb)) - Math.min(Math.max(...pa), Math.max(...pb))
}

/** True only for a positive-area overlap of two convex polygons; touching is not overlap. */
export function polygonsOverlap(a: readonly Point[], b: readonly Point[]): boolean {
  for (const poly of [a, b]) {
    for (const [p, q] of edges(poly)) {
      const axis = { x: p.y - q.y, y: q.x - p.x }
      const length = Math.hypot(axis.x, axis.y)
      if (length === 0) continue
      if (axisGap(a, b, { x: axis.x / length, y: axis.y / length }) >= -SEPARATION_TOLERANCE) return false
    }
  }
  return true
}

export function bounds(shape: Shape): Box {
  const xs = shape.core.map((p) => p.x)
  const ys = shape.core.map((p) => p.y)
  return {
    minX: Math.min(...xs) - shape.radius,
    minY: Math.min(...ys) - shape.radius,
    maxX: Math.max(...xs) + shape.radius,
    maxY: Math.max(...ys) + shape.radius,
  }
}
