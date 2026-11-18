// Curves as straight segments within a tolerance: Bézier curves by their second differences, elliptical arcs by
// the angle a chord may span; the arc's endpoint form converted to its centre form (the SVG specification's
// implementation notes, F.6.5 and F.6.6).
import type { Point } from "../model.js"
import { MAX_POINTS_PER_CURVE } from "./shapes.js"

const segmentsFor = (wanted: number) => Math.min(MAX_POINTS_PER_CURVE, Math.max(1, Math.ceil(Number.isFinite(wanted) ? wanted : MAX_POINTS_PER_CURVE)))

/** The points after `p0` along a cubic Bézier, ending at `p3`. */
export function cubic(p0: Point, p1: Point, p2: Point, p3: Point, tolerance: number): Point[] {
  const dd = Math.max(Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y), Math.hypot(p1.x - 2 * p2.x + p3.x, p1.y - 2 * p2.y + p3.y))
  // |B''| <= 6 dd, and a chord of a curve of curvature bound K over a step h strays at most K h^2 / 8.
  const n = segmentsFor(Math.sqrt((0.75 * dd) / tolerance))
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n
    const u = 1 - t
    const [w0, w1, w2, w3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
    return { x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x, y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y }
  })
}

/** The points after `p0` along a quadratic Bézier, ending at `p2`. */
export function quadratic(p0: Point, p1: Point, p2: Point, tolerance: number): Point[] {
  const dd = Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y)
  const n = segmentsFor(Math.sqrt(dd / (4 * tolerance)))
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n
    const u = 1 - t
    return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y }
  })
}

/** How many chords an arc of this radius and sweep needs to stay within the tolerance. */
export function arcSegments(radius: number, sweep: number, tolerance: number): number {
  const ratio = 1 - tolerance / radius
  const step = ratio <= 0 ? Math.PI / 2 : Math.min(Math.PI / 2, 2 * Math.acos(ratio))
  return segmentsFor(Math.abs(sweep) / step)
}

export interface Ellipse {
  centre: Point
  rx: number
  ry: number
  /** The x axis's rotation, radians. */
  phi: number
}

/** The points after the start along an elliptical arc from angle `start` sweeping `sweep` (radians, parametric). */
export function ellipsePoints(e: Ellipse, start: number, sweep: number, tolerance: number): Point[] {
  const n = arcSegments(Math.max(e.rx, e.ry), sweep, tolerance)
  const [cos, sin] = [Math.cos(e.phi), Math.sin(e.phi)]
  return Array.from({ length: n }, (_, i) => {
    const t = start + (sweep * (i + 1)) / n
    const [x, y] = [e.rx * Math.cos(t), e.ry * Math.sin(t)]
    return { x: e.centre.x + cos * x - sin * y, y: e.centre.y + sin * x + cos * y }
  })
}

const angleBetween = (ux: number, uy: number, vx: number, vy: number) => {
  const sign = ux * vy - uy * vx < 0 ? -1 : 1
  const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))
  return sign * Math.acos(Math.max(-1, Math.min(1, cos)))
}

/** An SVG arc command from `p0` to `p1` as points after `p0`; zero radii make it a line, too small radii are scaled up. */
export function svgArc(p0: Point, rxIn: number, ryIn: number, degrees: number, large: boolean, sweepFlag: boolean, p1: Point, tolerance: number): Point[] {
  if (p0.x === p1.x && p0.y === p1.y) return []
  let [rx, ry] = [Math.abs(rxIn), Math.abs(ryIn)]
  if (rx === 0 || ry === 0) return [p1]
  const phi = (degrees * Math.PI) / 180
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)]
  const [dx, dy] = [(p0.x - p1.x) / 2, (p0.y - p1.y) / 2]
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) [rx, ry] = [rx * Math.sqrt(lambda), ry * Math.sqrt(lambda)]
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const root = (large === sweepFlag ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const [cx1, cy1] = [(root * rx * y1) / ry, (-root * ry * x1) / rx]
  const centre = { x: cos * cx1 - sin * cy1 + (p0.x + p1.x) / 2, y: sin * cx1 + cos * cy1 + (p0.y + p1.y) / 2 }
  const start = angleBetween(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let sweep = angleBetween((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweepFlag && sweep > 0) sweep -= 2 * Math.PI
  if (sweepFlag && sweep < 0) sweep += 2 * Math.PI
  const points = ellipsePoints({ centre, rx, ry, phi }, start, sweep, tolerance)
  return [...points.slice(0, -1), p1]
}
