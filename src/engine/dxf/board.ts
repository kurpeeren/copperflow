// The board a mechanical drawing gives: lines, arcs and polylines that meet end to end are joined into closed shapes,
// the largest is the outline, circles inside it are mounting holes and the other closed shapes inside it are places to
// keep clear. Arcs and bulges become straight edges at most ARC_TOLERANCE from the true arc, a full turn at least 32 of
// them unless it is under about 0.2 mm in radius. Everything else is counted in `notUsed`. The drawing is moved so the
// outline's box is centred on the origin, as copperflow's boards are.
import { pointInPolygon } from "../checks/geometry.js"
import { arcSegments } from "../graphics/curves.js"
import type { Point } from "../model.js"
import { DxfError, readDxf, type DxfDrawing, type DxfEntity, type DxfUnits, type DxfVertex } from "./reader.js"

/** Ends closer than this, in mm, meet. */
export const JOIN_TOLERANCE = 0.01
/** The largest distance of a straight edge from the arc it stands for, in mm. */
export const ARC_TOLERANCE = 0.005

const MM_PER: Record<DxfUnits, number> = { mm: 1, cm: 10, m: 1000, inch: 25.4 }

export interface BoardFromDrawingOptions {
  /** Only the entities on this layer may make the outline. */
  layer?: string
  /** Overrides the header's units. */
  units?: "mm" | "inch"
  /** "keep" leaves the coordinates as drawn; by default the outline's box is centred on the origin. */
  origin?: "centre" | "keep"
}

export interface BoardHole {
  x: number
  y: number
  diameter: number
}

export interface BoardFromDrawing {
  /** Counter-clockwise, in mm. */
  outline: Point[]
  holes: BoardHole[]
  /** Closed shapes inside the outline, to keep clear. */
  keepouts: Point[][]
  units: { name: DxfUnits; from: "file" | "asked" | "assumed" }
  /** What was added to the drawing's coordinates. */
  offset: Point
  width: number
  height: number
  /** What was not used, e.g. "2 SPLINE", "1 open chain of 3 lines". */
  notUsed: string[]
}

type Kind = "line" | "arc" | "polyline"
interface Piece {
  points: Point[]
  kind: Kind
  layer: string
}
interface Chain {
  points: Point[]
  pieces: Piece[]
}
interface Loop {
  points: Point[]
  layers: Set<string>
  area: number
}
interface Circle {
  centre: Point
  radius: number
  layer: string
}

const tidy = (v: number) => Math.round(v * 10_000) / 10_000 || 0
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const meets = (a: Point, b: Point) => distance(a, b) <= JOIN_TOLERANCE

/** Points along an arc from `start` radians, turning `sweep` radians (counter-clockwise when positive), ends included. */
export function arcPoints(centre: Point, radius: number, start: number, sweep: number): Point[] {
  const count = arcSegments(radius, sweep, ARC_TOLERANCE)
  return Array.from({ length: count + 1 }, (_, i) => {
    const angle = start + (sweep * i) / count
    return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) }
  })
}

/** The points from `a` to `b` along the arc a bulge names, `a` left out and `b` included. */
function bulgePoints(a: Point, b: Point, bulge: number): Point[] {
  if (bulge === 0) return [b]
  const sweep = 4 * Math.atan(bulge)
  const chord = distance(a, b)
  if (chord === 0) return [b]
  const radius = chord / (2 * Math.abs(Math.sin(sweep / 2)))
  const along = chord / 2 / Math.tan(sweep / 2)
  const centre = { x: (a.x + b.x) / 2 - ((b.y - a.y) / chord) * along, y: (a.y + b.y) / 2 + ((b.x - a.x) / chord) * along }
  const points = arcPoints(centre, radius, Math.atan2(a.y - centre.y, a.x - centre.x), sweep).slice(1)
  points[points.length - 1] = b
  return points
}

function polylinePoints(vertices: readonly DxfVertex[], closed: boolean): Point[] {
  const first = vertices[0]
  if (!first) return []
  const points: Point[] = [{ x: first.x, y: first.y }]
  const edges = closed ? vertices.length : vertices.length - 1
  for (let i = 0; i < edges; i++) {
    const from = vertices[i] as DxfVertex
    const to = vertices[(i + 1) % vertices.length] as DxfVertex
    points.push(...bulgePoints(from, { x: to.x, y: to.y }, from.bulge))
  }
  return points
}

const scaled = (p: Point, k: number): Point => ({ x: p.x * k, y: p.y * k })

/** What each entity is in mm: a piece to join, a closed polyline, or a circle. */
function shapesOf(entities: readonly DxfEntity[], k: number): { pieces: Piece[]; closed: Piece[]; circles: Circle[] } {
  const pieces: Piece[] = []
  const closed: Piece[] = []
  const circles: Circle[] = []
  for (const entity of entities) {
    const layer = entity.layer
    if (entity.type === "LINE") pieces.push({ points: [scaled(entity.start, k), scaled(entity.end, k)], kind: "line", layer })
    else if (entity.type === "CIRCLE") circles.push({ centre: scaled(entity.centre, k), radius: entity.radius * k, layer })
    else if (entity.type === "ARC") {
      const sweep = (((entity.endAngle - entity.startAngle) % 360) + 360) % 360 || 360
      const points = arcPoints(scaled(entity.centre, k), entity.radius * k, (entity.startAngle * Math.PI) / 180, (sweep * Math.PI) / 180)
      pieces.push({ points, kind: "arc", layer })
    } else {
      const vertices = entity.vertices.map((v) => ({ ...scaled(v, k), bulge: v.bulge }))
      const piece = { points: polylinePoints(vertices, entity.closed), kind: "polyline" as const, layer }
      if (piece.points.length >= 2) (entity.closed ? closed : pieces).push(piece)
    }
  }
  return { pieces, closed, circles }
}

/** Joins pieces end to end, turning them round as needed. */
function chains(pieces: readonly Piece[]): Chain[] {
  const left = [...pieces]
  const found: Chain[] = []
  while (left.length > 0) {
    const first = left.shift() as Piece
    const chain: Chain = { points: [...first.points], pieces: [first] }
    for (let grown = true; grown; ) {
      grown = false
      for (let i = 0; i < left.length; i++) {
        const piece = left[i] as Piece
        const [start, end] = [chain.points[0] as Point, chain.points.at(-1) as Point]
        const [a, b] = [piece.points[0] as Point, piece.points.at(-1) as Point]
        if (meets(end, a)) chain.points.push(...piece.points.slice(1))
        else if (meets(end, b)) chain.points.push(...[...piece.points].reverse().slice(1))
        else if (meets(start, b)) chain.points.unshift(...piece.points.slice(0, -1))
        else if (meets(start, a)) chain.points.unshift(...[...piece.points].reverse().slice(0, -1))
        else continue
        chain.pieces.push(piece)
        left.splice(i, 1)
        grown = true
        break
      }
    }
    found.push(chain)
  }
  return found
}

const signedArea = (points: readonly Point[]) => points.reduce((sum, a, i) => {
  const b = points[(i + 1) % points.length] as Point
  return sum + a.x * b.y - b.x * a.y
}, 0) / 2

/** A closed chain as a loop: its last point (the first again) dropped, counter-clockwise. */
function loopOf(points: readonly Point[], layers: Iterable<string>): Loop {
  const open = meets(points[0] as Point, points.at(-1) as Point) && points.length > 1 ? points.slice(0, -1) : [...points]
  const area = signedArea(open)
  return { points: area < 0 ? open.reverse() : open, layers: new Set(layers), area: Math.abs(area) }
}

const isClosed = (chain: Chain) => chain.points.length > 3 && meets(chain.points[0] as Point, chain.points.at(-1) as Point)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

function chainWords(chain: Chain): string {
  const counts = (["line", "arc", "polyline"] as const).map((kind) => [kind, chain.pieces.filter((p) => p.kind === kind).length] as const)
  const words = counts.filter(([, n]) => n > 0).map(([kind, n]) => plural(n, kind))
  return `open chain of ${words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0]}`
}

/** "1 open chain of 3 lines"; equal ones counted together. */
function grouped(words: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1)
  return [...counts].map(([word, n]) => (n === 1 ? `1 ${word}` : `${n} ${word.replace(/^open chain/, "open chains")}`))
}

function circleLoop(circle: Circle): Loop {
  const points = arcPoints(circle.centre, circle.radius, 0, 2 * Math.PI).slice(0, -1)
  return { points, layers: new Set([circle.layer]), area: Math.PI * circle.radius ** 2 }
}

function unitsFor(drawing: DxfDrawing, asked: BoardFromDrawingOptions["units"]): BoardFromDrawing["units"] {
  if (asked) return { name: asked, from: "asked" }
  if (drawing.otherUnits) throw new DxfError(`The drawing's units (${drawing.otherUnits}) are not read; pass units mm or inch`)
  return drawing.units ? { name: drawing.units, from: "file" } : { name: "mm", from: "assumed" }
}

/** The outline: the largest closed shape (on `layer` when given); refuses none and a tie. */
function pickOutline(loops: readonly Loop[], circles: readonly Circle[], layer: string | undefined, found: () => string): { outline: Loop; circle?: Circle } {
  const candidates: { loop: Loop; circle?: Circle }[] = [
    ...loops.map((loop) => ({ loop })),
    ...circles.map((circle) => ({ loop: circleLoop(circle), circle })),
  ].filter(({ loop }) => layer === undefined || [...loop.layers].every((name) => name === layer))
  if (candidates.length === 0) throw new DxfError(layer === undefined ? `No closed shape was found: ${found()}` : `No closed shape on layer ${layer}; ${found()}`)
  const sorted = [...candidates].sort((a, b) => b.loop.area - a.loop.area)
  const [largest, next] = sorted as [(typeof sorted)[number], (typeof sorted)[number] | undefined]
  if (next && largest.loop.area - next.loop.area <= Math.max(1e-6, largest.loop.area * 1e-9)) {
    throw new DxfError(`Two closed shapes have the same largest area (${tidy(largest.loop.area)} mm²), so the outline is not clear; pass layer to choose the outline's layer`)
  }
  return { outline: largest.loop, ...(largest.circle ? { circle: largest.circle } : {}) }
}

/** Moves points by `offset` and rounds them; two in a row at the same place become one. */
function placed(points: readonly Point[], offset: Point): Point[] {
  const moved = points.map((p) => ({ x: tidy(p.x + offset.x), y: tidy(p.y + offset.y) }))
  return moved.filter((p, i) => {
    const before = moved[(i + moved.length - 1) % moved.length] as Point
    return moved.length === 1 || p.x !== before.x || p.y !== before.y
  })
}

/** The board a parsed drawing gives; refuses a drawing without a closed shape and one whose largest shape is not clear. */
export function boardFromDrawing(drawing: DxfDrawing, options: BoardFromDrawingOptions = {}): BoardFromDrawing {
  const units = unitsFor(drawing, options.units)
  const { pieces, closed, circles } = shapesOf(drawing.entities, MM_PER[units.name])
  const joined = chains(pieces)
  const loops = [...closed.map((piece) => loopOf(piece.points, [piece.layer])), ...joined.filter(isClosed).map((chain) => loopOf(chain.points, chain.pieces.map((p) => p.layer)))]
  const openChains = joined.filter((chain) => !isClosed(chain))
  const skipped = Object.entries(drawing.skipped).map(([type, n]) => `${n} ${type}`)
  const chainLines = grouped(openChains.map(chainWords))
  const layers = [...new Set(drawing.entities.map((e) => e.layer))].sort()
  const found = () => {
    if (options.layer !== undefined) return `the layers are ${layers.join(", ") || "none"}`
    const what = [...skipped, ...chainLines, ...(circles.length > 0 ? [plural(circles.length, "circle")] : [])]
    return what.length > 0 ? what.join(", ") : "the drawing has no lines, arcs, circles or polylines"
  }
  const { outline, circle } = pickOutline(loops, circles, options.layer, found)
  const inside = (p: Point) => pointInPolygon(p, outline.points)
  const otherLoops = loops.filter((loop) => loop !== outline)
  const keepLoops = otherLoops.filter((loop) => loop.points.every(inside))
  const otherCircles = circles.filter((one) => one !== circle)
  const holeCircles = otherCircles.filter((one) => inside(one.centre))
  const xs = outline.points.map((p) => p.x)
  const ys = outline.points.map((p) => p.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const offset = options.origin === "keep" ? { x: 0, y: 0 } : { x: tidy(-(minX + maxX) / 2), y: tidy(-(minY + maxY) / 2) }
  const outsideLoops = otherLoops.length - keepLoops.length
  const outsideCircles = otherCircles.length - holeCircles.length
  return {
    outline: placed(outline.points, offset),
    holes: holeCircles.map((one) => ({ x: tidy(one.centre.x + offset.x), y: tidy(one.centre.y + offset.y), diameter: tidy(one.radius * 2) })),
    keepouts: keepLoops.map((loop) => placed(loop.points, offset)),
    units,
    offset,
    width: tidy(maxX - minX),
    height: tidy(maxY - minY),
    notUsed: [
      ...skipped,
      ...chainLines,
      ...(outsideLoops > 0 ? [`${plural(outsideLoops, "closed shape")} outside the outline`] : []),
      ...(outsideCircles > 0 ? [`${plural(outsideCircles, "circle")} outside the outline`] : []),
    ],
  }
}

/** Reads an ASCII DXF and gives the board it draws. */
export function boardFromDxf(text: string, options: BoardFromDrawingOptions = {}): BoardFromDrawing {
  return boardFromDrawing(readDxf(text), options)
}
