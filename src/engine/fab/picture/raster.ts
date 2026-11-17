// Coverage images: how much of each pixel a layer covers, 0 to 1, computed from the shapes themselves rather than
// sampled. Round shapes and lines take their coverage from the distance to their edge (so arcs are arcs at any size, and
// a line thinner than a pixel covers it partly); polygons are filled along sixteen lines per pixel row with the exact
// share of each pixel across. A shape is drawn dark (the layer is the larger of the two coverages) or clear (it cuts
// what lies under it), in the order given, as a Gerber file is drawn. Pure: plain arrays, no canvas.
import type { Point } from "../../model.js"

/** One layer: `data[row * width + column]` is the share of that pixel covered. */
export interface Coverage {
  readonly width: number
  readonly height: number
  readonly data: Float32Array
}

/** Where the picture lies on the board: the box in mm, the scale, and whether left and right are swapped. */
export interface Grid {
  readonly width: number
  readonly height: number
  readonly pxPerMm: number
  readonly minX: number
  readonly maxX: number
  readonly maxY: number
  /** Seen from below: x grows to the left. */
  readonly mirrored: boolean
}

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type Paint = "dark" | "clear"

/** Lines per pixel row when a polygon is filled. */
const SUBROWS = 16

/** The grid that shows `box` at `pxPerMm`, its far edges moved out to the next whole pixel. */
export function gridFor(box: Box, pxPerMm: number, mirrored: boolean): Grid {
  const width = Math.max(1, Math.ceil((box.maxX - box.minX) * pxPerMm - 1e-9))
  const height = Math.max(1, Math.ceil((box.maxY - box.minY) * pxPerMm - 1e-9))
  return { width, height, pxPerMm, minX: box.minX, maxX: box.minX + width / pxPerMm, maxY: box.maxY, mirrored }
}

export const emptyCoverage = (grid: Pick<Grid, "width" | "height">): Coverage => ({ width: grid.width, height: grid.height, data: new Float32Array(grid.width * grid.height) })

/** A point of the board in pixels, the picture's top left corner at 0, 0. */
export function toPixel(grid: Grid, p: Point): Point {
  const x = grid.mirrored ? grid.maxX - p.x : p.x - grid.minX
  return { x: x * grid.pxPerMm, y: (grid.maxY - p.y) * grid.pxPerMm }
}

/** The share of a one-pixel span centred `d` from the middle of a band `half` wide on each side. */
export function band(d: number, half: number): number {
  const a = Math.max(d - 0.5, -half)
  const b = Math.min(d + 0.5, half)
  return b > a ? Math.min(b - a, 1) : 0
}

/** Math.hypot without its care for overflow, which costs much in a loop over every pixel. */
const length = (x: number, y: number) => Math.sqrt(x * x + y * y)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

function put(data: Float32Array, i: number, c: number, paint: Paint): void {
  if (c <= 0) return
  if (paint === "dark") {
    if (c > (data[i] as number)) data[i] = c
  } else {
    const left = 1 - c
    if (left < (data[i] as number)) data[i] = left
  }
}

/** Calls `cover` for each pixel centre within `reach` pixels of the box from `a` to `b` (pixels), on the picture. */
function eachPixel(layer: Coverage, a: Point, b: Point, reach: number, cover: (x: number, y: number) => number, paint: Paint): void {
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - reach))
  const x1 = Math.min(layer.width, Math.ceil(Math.max(a.x, b.x) + reach))
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - reach))
  const y1 = Math.min(layer.height, Math.ceil(Math.max(a.y, b.y) + reach))
  for (let y = y0; y < y1; y += 1) {
    const row = y * layer.width
    for (let x = x0; x < x1; x += 1) put(layer.data, row + x, cover(x + 0.5, y + 0.5), paint)
  }
}

/** A round dot of radius `r` pixels at `c`. */
export function disc(layer: Coverage, c: Point, r: number, paint: Paint = "dark"): void {
  eachPixel(layer, c, c, r + 1, (x, y) => band(length(x - c.x, y - c.y), r), paint)
}

/** A line from `a` to `b` with round ends, `r` pixels each side of its middle: a track, a stroke of print, a slot. */
export function capsule(layer: Coverage, a: Point, b: Point, r: number, paint: Paint = "dark"): void {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return disc(layer, a, r, paint)
  eachPixel(
    layer,
    a,
    b,
    r + 1,
    (x, y) => {
      const t = clamp01(((x - a.x) * dx + (y - a.y) * dy) / length2)
      return band(length(x - a.x - t * dx, y - a.y - t * dy), r)
    },
    paint,
  )
}

/**
 * A rectangle `2 * hw` by `2 * hh` pixels about `c`, turned `angle` radians (clockwise on the picture), its corners
 * rounded by `radius` pixels (0 for square corners).
 */
export function box(layer: Coverage, c: Point, hw: number, hh: number, angle: number, radius: number, paint: Paint = "dark"): void {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
  const reach = Math.hypot(hw, hh) + 1
  const rounded = Math.min(radius, hw, hh)
  eachPixel(
    layer,
    c,
    c,
    reach,
    (x, y) => {
      const u = (x - c.x) * cos + (y - c.y) * sin
      const v = -(x - c.x) * sin + (y - c.y) * cos
      if (rounded <= 0) return band(u, hw) * band(v, hh)
      const qx = Math.abs(u) - (hw - rounded)
      const qy = Math.abs(v) - (hh - rounded)
      const outside = length(Math.max(qx, 0), Math.max(qy, 0))
      const distance = outside + Math.min(Math.max(qx, qy), 0) - rounded
      return clamp01(0.5 - distance)
    },
    paint,
  )
}

interface Edge {
  x0: number
  y0: number
  y1: number
  slope: number
  dir: number
}

function edgesOf(paths: readonly (readonly Point[])[]): Edge[] {
  const edges: Edge[] = []
  for (const path of paths) {
    for (let i = 0; i < path.length; i += 1) {
      const a = path[i] as Point
      const b = path[(i + 1) % path.length] as Point
      if (a.y === b.y) continue
      const [top, bottom, dir] = a.y < b.y ? [a, b, 1] : [b, a, -1]
      edges.push({ x0: top.x, y0: top.y, y1: bottom.y, slope: (bottom.x - top.x) / (bottom.y - top.y), dir })
    }
  }
  return edges.sort((a, b) => a.y0 - b.y0)
}

/** Adds the span from `a` to `b` (pixels) at `weight` to a row: whole pixels through `steps`, the ends to `parts`. */
function addSpan(parts: Float32Array, steps: Float32Array, a: number, b: number, weight: number): void {
  const ia = Math.floor(a)
  const ib = Math.floor(b)
  if (ia === ib) {
    parts[ia] = (parts[ia] as number) + (b - a) * weight
    return
  }
  parts[ia] = (parts[ia] as number) + (ia + 1 - a) * weight
  steps[ia + 1] = (steps[ia + 1] as number) + weight
  steps[ib] = (steps[ib] as number) - weight
  parts[ib] = (parts[ib] as number) + (b - ib) * weight
}

/**
 * Filled polygons, their corners in pixels: "nonzero" counts a point inside when the outlines wind round it (a Gerber
 * region), "evenodd" when an odd number of them enclose it (a board outline with cut-outs).
 */
export function polygons(layer: Coverage, paths: readonly (readonly Point[])[], rule: "nonzero" | "evenodd", paint: Paint = "dark"): void {
  const edges = edgesOf(paths)
  if (edges.length === 0) return
  const top = Math.max(0, Math.floor(edges[0]?.y0 ?? 0))
  const bottom = Math.min(layer.height, Math.ceil(Math.max(...edges.map((edge) => edge.y1))))
  const parts = new Float32Array(layer.width + 2)
  const steps = new Float32Array(layer.width + 2)
  const crossings: { x: number; dir: number }[] = []
  let next = 0
  let active: Edge[] = []
  const weight = 1 / SUBROWS
  for (let y = top; y < bottom; y += 1) {
    while (next < edges.length && (edges[next] as Edge).y0 < y + 1) active.push(edges[next++] as Edge)
    active = active.filter((edge) => edge.y1 > y)
    if (active.length === 0) continue
    let from = layer.width
    let to = 0
    for (let k = 0; k < SUBROWS; k += 1) {
      const sy = y + (k + 0.5) * weight
      crossings.length = 0
      for (const edge of active) if (edge.y0 <= sy && sy < edge.y1) crossings.push({ x: edge.x0 + (sy - edge.y0) * edge.slope, dir: edge.dir })
      crossings.sort((a, b) => a.x - b.x)
      let winding = 0
      for (let i = 0; i < crossings.length - 1; i += 1) {
        const here = crossings[i] as { x: number; dir: number }
        winding = rule === "nonzero" ? winding + here.dir : winding ^ 1
        if (winding === 0) continue
        const a = Math.max(here.x, 0)
        const b = Math.min((crossings[i + 1] as { x: number }).x, layer.width)
        if (b <= a) continue
        const end = Math.min(b, layer.width - 1e-9)
        addSpan(parts, steps, a, end, weight)
        from = Math.min(from, Math.floor(a))
        to = Math.max(to, Math.floor(end) + 1)
      }
    }
    let run = 0
    const row = y * layer.width
    for (let x = from; x < to; x += 1) {
      run += steps[x] as number
      put(layer.data, row + x, Math.min(run + (parts[x] as number), 1), paint)
      parts[x] = 0
      steps[x] = 0
    }
    if (to > from) steps[to] = 0
  }
}
