// The pieces the part shapes are made of, in a part's own frame: x and y as its footprint has them (mm, the part's
// centre at 0, 0, seen from the top at rotation 0), z up from the board's surface on the part's side. A shape is a
// list of flat pieces; index.ts turns them into the board's frame as the PCB places the part. Pure.
import type { Material, Rgb, Role, Vec3 } from "../scene.js"

export interface Piece {
  /** The first loop is the outline; all in one plane. */
  loops: Vec3[][]
  normal: Vec3
  color: Rgb
  material: Material
  role: Role
}

export interface Flat {
  x: number
  y: number
}

/** A rectangle in the part's frame. */
export interface Rect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface BoxColors {
  top: Rgb
  side: Rgb
}

const colorsOf = (colors: Rgb | BoxColors): BoxColors => ("top" in colors ? colors : { top: colors, side: colors })

/**
 * A prism standing on a counter-clockwise polygon from z0 to z1: its top and its sides, each side its own colour when
 * `sideColor` answers one. No bottom: it stands on the board or on another piece and is never seen from below.
 */
export function prism(polygon: readonly Flat[], z0: number, z1: number, colors: Rgb | BoxColors, material: Material, role: Role, sideColor?: (i: number) => Rgb | undefined): Piece[] {
  if (!(z1 > z0) || polygon.length < 3) return []
  const { top, side } = colorsOf(colors)
  const cap: Piece = { loops: [polygon.map((p): Vec3 => [p.x, p.y, z1])], normal: [0, 0, 1], color: top, material, role }
  const sides = polygon.map((p, i): Piece => {
    const q = polygon[(i + 1) % polygon.length] as Flat
    const length = Math.hypot(q.x - p.x, q.y - p.y) || 1
    return {
      loops: [[[p.x, p.y, z0], [q.x, q.y, z0], [q.x, q.y, z1], [p.x, p.y, z1]]],
      normal: [(q.y - p.y) / length, -(q.x - p.x) / length, 0],
      color: sideColor?.(i) ?? side,
      material,
      role,
    }
  })
  return [cap, ...sides]
}

/** One flat piece on `loop`, wound counter-clockwise seen from the side `outward` points to; its normal is the winding's. */
export function facet(loop: readonly Vec3[], outward: Vec3, color: Rgb, material: Material, role: Role): Piece {
  const wound = windNormal(loop)
  const flip = wound[0] * outward[0] + wound[1] * outward[1] + wound[2] * outward[2] < 0
  const turned = flip ? [...loop].reverse() : [...loop]
  return { loops: [turned], normal: flip ? [-wound[0], -wound[1], -wound[2]] : wound, color, material, role }
}

/** A prism that hangs below z0 down to z1 < z0 (a lead under the board): its sides and its lower end. */
export function hanging(polygon: readonly Flat[], z0: number, z1: number, color: Rgb, material: Material, role: Role): Piece[] {
  if (!(z0 > z1)) return []
  const end: Piece = { loops: [[...polygon].reverse().map((p): Vec3 => [p.x, p.y, z1])], normal: [0, 0, -1], color, material, role }
  const sides = prism(polygon, z1, z0, color, material, role).slice(1)
  return [end, ...sides]
}

/**
 * A prism lying along x: a counter-clockwise polygon in the y–z plane (the polygon's x is the part's y, its y the
 * part's z, seen from +x) swept from x0 to x1, with both end faces. For round bodies that lie on the board.
 */
export function lying(polygon: readonly Flat[], x0: number, x1: number, colors: Rgb | BoxColors, material: Material, role: Role): Piece[] {
  if (!(x1 > x0) || polygon.length < 3) return []
  const { top, side } = colorsOf(colors)
  const at = (x: number, p: Flat): Vec3 => [x, p.x, p.y]
  const far: Piece = { loops: [polygon.map((p) => at(x1, p))], normal: [1, 0, 0], color: top, material, role }
  const near: Piece = { loops: [[...polygon].reverse().map((p) => at(x0, p))], normal: [-1, 0, 0], color: top, material, role }
  const sides = polygon.map((p, i): Piece => {
    const q = polygon[(i + 1) % polygon.length] as Flat
    const length = Math.hypot(q.x - p.x, q.y - p.y) || 1
    return {
      loops: [[at(x0, p), at(x0, q), at(x1, q), at(x1, p)]],
      normal: [0, (q.y - p.y) / length, -(q.x - p.x) / length],
      color: side,
      material,
      role,
    }
  })
  return [far, near, ...sides]
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

/** The unit normal a loop's first three corners wind about (counter-clockwise from the side it points to). */
function windNormal(loop: readonly Vec3[]): Vec3 {
  const n = cross(minus(loop[1] as Vec3, loop[0] as Vec3), minus(loop[2] as Vec3, loop[1] as Vec3))
  const length = Math.hypot(n[0], n[1], n[2]) || 1
  return [n[0] / length, n[1] / length, n[2] / length]
}

/**
 * A profile of (radius, z) pairs, running up from the bottom, turned about the vertical axis through (cx, cy) into
 * `sides` flat trapezoids per step (a triangle where a radius is 0), and a flat top when the last radius is above 0.
 * No bottom. For domes, balls and rounded cans.
 */
export function lathe(profile: readonly (readonly [number, number])[], cx: number, cy: number, sides: number, colors: Rgb | BoxColors, material: Material, role: Role): Piece[] {
  if (profile.length < 2 || sides < 3) return []
  const { top, side } = colorsOf(colors)
  const ring = (radius: number, z: number, i: number): Vec3 => {
    const angle = (2 * Math.PI * i) / sides
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), z]
  }
  const bands = profile.slice(1).flatMap(([r1, z1], k) => {
    const [r0, z0] = profile[k] as readonly [number, number]
    return Array.from({ length: sides }, (_, i): Piece[] => {
      const corners = [ring(r0, z0, i), ring(r0, z0, i + 1), ring(r1, z1, i + 1), ring(r1, z1, i)]
      const loop = corners.filter((p, j) => j === 0 || Math.hypot(p[0] - (corners[j - 1] as Vec3)[0], p[1] - (corners[j - 1] as Vec3)[1]) > 1e-12 || p[2] !== (corners[j - 1] as Vec3)[2])
      return loop.length < 3 ? [] : [{ loops: [loop], normal: windNormal(loop), color: side, material, role }]
    }).flat()
  })
  const [lastR, lastZ] = profile[profile.length - 1] as readonly [number, number]
  const lid: Piece[] = lastR > 0 ? [{ loops: [Array.from({ length: sides }, (_, i) => ring(lastR, lastZ, i))], normal: [0, 0, 1], color: top, material, role }] : []
  return [...lid, ...bands]
}

export const rectPolygon = (r: Rect): Flat[] => [
  { x: r.minX, y: r.minY },
  { x: r.maxX, y: r.minY },
  { x: r.maxX, y: r.maxY },
  { x: r.minX, y: r.maxY },
]

/** A box on a rectangle from z0 to z1. */
export const box = (r: Rect, z0: number, z1: number, colors: Rgb | BoxColors, material: Material, role: Role): Piece[] =>
  r.maxX > r.minX && r.maxY > r.minY ? prism(rectPolygon(r), z0, z1, colors, material, role) : []

/** A circle as `sides` straight pieces, counter-clockwise. */
export const circle = (cx: number, cy: number, radius: number, sides = 20): Flat[] =>
  Array.from({ length: sides }, (_, i) => ({ x: cx + radius * Math.cos((2 * Math.PI * i) / sides), y: cy + radius * Math.sin((2 * Math.PI * i) / sides) }))

/** A stadium (a rectangle with round ends) along x, `length` overall, `width` across, counter-clockwise. */
export function stadium(cx: number, cy: number, length: number, width: number, steps = 10): Flat[] {
  const radius = width / 2
  const half = Math.max(0, length / 2 - radius)
  const end = (x: number, from: number) => Array.from({ length: steps + 1 }, (_, i) => {
    const angle = from + (Math.PI * i) / steps
    return { x: cx + x + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) }
  })
  return [...end(half, -Math.PI / 2), ...end(-half, Math.PI / 2)]
}

/** Every piece turned by `degrees` about the part's centre: shapes are made along x and turned to their pads. */
export function turnPieces(pieces: readonly Piece[], degrees: number): Piece[] {
  if (degrees === 0) return [...pieces]
  const r = (degrees * Math.PI) / 180
  const [c, s] = [Math.cos(r), Math.sin(r)]
  const turn = (v: Vec3): Vec3 => [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]
  return pieces.map((piece) => ({ ...piece, loops: piece.loops.map((loop) => loop.map(turn)), normal: turn(piece.normal) }))
}

/** A rectangle grown (or shrunk, for a negative margin) on every side. */
export const grown = (r: Rect, margin: number): Rect => ({ minX: r.minX - margin, minY: r.minY - margin, maxX: r.maxX + margin, maxY: r.maxY + margin })

/** The part of `r` inside `limit`. */
export const clipped = (r: Rect, limit: Rect): Rect => ({ minX: Math.max(r.minX, limit.minX), minY: Math.max(r.minY, limit.minY), maxX: Math.min(r.maxX, limit.maxX), maxY: Math.min(r.maxY, limit.maxY) })

export const rectOf = (points: readonly Flat[]): Rect | undefined =>
  points.length === 0
    ? undefined
    : {
        minX: Math.min(...points.map((p) => p.x)),
        minY: Math.min(...points.map((p) => p.y)),
        maxX: Math.max(...points.map((p) => p.x)),
        maxY: Math.max(...points.map((p) => p.y)),
      }
