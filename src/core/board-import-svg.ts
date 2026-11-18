// The board from an SVG drawing, for import_board, `copperflow board --svg` and the Studio's Import board: the drawing
// is read as any drawing is (engine/graphics), and its closed shapes are sorted into what the DXF import gives
// (engine/dxf, BoardFromDrawing), so the rest of the import is the same. The largest closed shape (a filled area's
// outer ring, one of its openings, or a closed line) is the outline; a closed shape inside it is a hole when it is a
// circle and an inner shape otherwise, carried as the DXF import carries it (a keepout: a board here has no cut-outs).
// Colour is not read here: a white circle is a hole like a black one. An SVG has no layers. Its size must be physical (mm, cm, in, pt or pc), since a board has real dimensions.
import { pointInPolygon } from "../engine/checks/geometry.js"
import type { BoardFromDrawing, BoardFromDrawingOptions } from "../engine/dxf/index.js"
import { parseGraphic, svgHasPhysicalSize, type GraphicShapes } from "../engine/graphics/index.js"
import type { Point } from "../engine/model.js"

export class SvgBoardError extends Error {}

/** A closed shape is a circle when every corner and every edge's middle lies this close to the fitted circle, in mm. */
const CIRCLE_FIT_MM = 0.05
/** The fewest corners a flattened circle has (the reader flattens a full turn of 0.2 mm radius or more into at least 32, and one of 0.02 mm into 10). */
const MIN_CIRCLE_CORNERS = 8
/** The most closed shapes a board drawing may have: each is compared with the outline. */
export const MAX_BOARD_SHAPES = 5000
/** Two rings whose areas and boxes agree to this (mm, mm²) are the same shape drawn twice (a fill and its outline). */
const SAME_RING_MM = 1e-3
/** Corners closer than this, in mm, are one corner (the drawing's coordinates are kept to 0.1 µm). */
const SAME_POINT_MM = 1e-4

const tidy = (v: number) => Math.round(v * 10_000) / 10_000 || 0
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

interface Ring {
  points: Point[]
  area: number
  box: [number, number, number, number]
}

/** The ring without a corner at the same place as the one before it (the last is before the first). */
function withoutRepeats(points: readonly Point[]): Point[] {
  return points.filter((p, i) => {
    const before = points[(i + points.length - 1) % points.length] as Point
    return points.length === 1 || Math.hypot(p.x - before.x, p.y - before.y) > SAME_POINT_MM
  })
}

function ringOf(corners: readonly Point[]): Ring {
  const points = withoutRepeats(corners)
  const signed = points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length] as Point
    return sum + a.x * b.y - b.x * a.y
  }, 0) / 2
  const box: Ring["box"] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const p of points) {
    box[0] = Math.min(box[0], p.x)
    box[1] = Math.min(box[1], p.y)
    box[2] = Math.max(box[2], p.x)
    box[3] = Math.max(box[3], p.y)
  }
  return { points: signed < 0 ? [...points].reverse() : [...points], area: Math.abs(signed), box }
}

/** A key equal for the same shape drawn twice (a fill and its outline): its area and box on a SAME_RING_MM grid. */
const ringKey = (ring: Ring) => [ring.area, ...ring.box].map((v) => Math.round(v / SAME_RING_MM)).join(",")

/** Every closed shape of the drawing once: filled areas' rings and closed lines. Refuses more than MAX_BOARD_SHAPES. */
function closedRings(shapes: GraphicShapes): Ring[] {
  const all = [...shapes.fills.flatMap((fill) => [fill.outer, ...fill.holes]), ...shapes.strokes.filter((s) => s.closed).map((s) => s.points)]
  const seen = new Set<string>()
  const rings: Ring[] = []
  for (const ring of all.map(ringOf)) {
    const key = ringKey(ring)
    if (ring.points.length < 3 || seen.has(key)) continue
    seen.add(key)
    rings.push(ring)
    if (rings.length > MAX_BOARD_SHAPES) throw new SvgBoardError(`The drawing has more than ${MAX_BOARD_SHAPES} closed shapes; simplify it first`)
  }
  return rings
}

const boxHolds = (outer: Ring["box"], inner: Ring["box"]) => outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]

/** Whether a closed shape lies inside the outline: its box inside the outline's, then one of its corners inside it (shapes are taken not to cross). */
const insideOutline = (ring: Ring, outline: Ring) => boxHolds(outline.box, ring.box) && pointInPolygon(ring.points[0] as Point, outline.points)

/**
 * The circle a closed shape is, or undefined: centre the mean of its corners, radius their mean distance from it; a
 * circle when every corner and every edge's middle is within CIRCLE_FIT_MM of that radius.
 */
function fitCircle(points: readonly Point[]): { centre: Point; radius: number } | undefined {
  if (points.length < MIN_CIRCLE_CORNERS) return undefined
  const centre = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length }
  const from = (p: Point) => Math.hypot(p.x - centre.x, p.y - centre.y)
  const radius = points.reduce((s, p) => s + from(p), 0) / points.length
  const middles = points.map((p, i) => {
    const q = points[(i + 1) % points.length] as Point
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
  })
  const fits = [...points, ...middles].every((p) => Math.abs(from(p) - radius) <= CIRCLE_FIT_MM)
  return fits && radius > 0 ? { centre, radius } : undefined
}

function pickOutline(rings: readonly Ring[], openLines: number): Ring {
  const sorted = [...rings].sort((a, b) => b.area - a.area)
  const [largest, next] = sorted
  if (!largest) throw new SvgBoardError(`No closed shape was found: ${openLines > 0 ? plural(openLines, "open line") : "the drawing draws nothing"}`)
  if (next && largest.area - next.area <= Math.max(1e-6, largest.area * 1e-9)) {
    throw new SvgBoardError(`Two closed shapes have the same largest area (${tidy(largest.area)} mm²), so the outline is not clear`)
  }
  return largest
}

const moved = (points: readonly Point[], offset: Point): Point[] => withoutRepeats(points.map((p) => ({ x: tidy(p.x + offset.x), y: tidy(p.y + offset.y) })))

function refuseOptions(options: BoardFromDrawingOptions): void {
  if (options.layer !== undefined) throw new SvgBoardError("An SVG has no layers; leave out layer")
  if (options.units !== undefined) throw new SvgBoardError("An SVG's units come from its width and height; leave out units")
}

function readShapes(text: string): GraphicShapes {
  const shapes = parseGraphic(text, "svg", { colour: false })
  if ("error" in shapes) throw new SvgBoardError(shapes.error)
  if (!svgHasPhysicalSize(text)) throw new SvgBoardError("The SVG gives no physical size (width and height in mm, cm, in, pt or pc); a board must have real dimensions")
  return shapes
}

/**
 * The board an SVG draws, as the DXF import gives it; "keep" leaves the drawing's lower left corner at the origin.
 * Colour does not change a board: every painted shape is read as ink, a line as its centre line. Anything that goes
 * wrong is refused in words (SvgBoardError).
 */
export function boardFromSvg(text: string, options: BoardFromDrawingOptions = {}): BoardFromDrawing {
  try {
    return readBoard(text, options)
  } catch (error) {
    if (error instanceof SvgBoardError) throw error
    if (error instanceof RangeError) throw new SvgBoardError("The drawing is too large to read as a board; simplify it first")
    throw new SvgBoardError(`The drawing could not be read as a board: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function readBoard(text: string, options: BoardFromDrawingOptions): BoardFromDrawing {
  refuseOptions(options)
  const shapes = readShapes(text)
  const openLines = shapes.strokes.filter((s) => !s.closed).length
  const rings = closedRings(shapes)
  const outline = pickOutline(rings, openLines)
  const inner = rings.filter((ring) => ring !== outline && insideOutline(ring, outline))
  const outside = rings.length - 1 - inner.length
  const [minX, minY, maxX, maxY] = outline.box
  const offset = options.origin === "keep" ? { x: 0, y: 0 } : { x: tidy(-(minX + maxX) / 2), y: tidy(-(minY + maxY) / 2) }
  const circles = inner.map((ring) => ({ ring, circle: fitCircle(ring.points) }))
  return {
    outline: moved(outline.points, offset),
    holes: circles.flatMap(({ circle }) => (circle ? [{ x: tidy(circle.centre.x + offset.x), y: tidy(circle.centre.y + offset.y), diameter: tidy(circle.radius * 2) }] : [])),
    keepouts: circles.filter(({ circle }) => !circle).map(({ ring }) => moved(ring.points, offset)),
    units: { name: "mm", from: "file" },
    offset,
    width: tidy(maxX - minX),
    height: tidy(maxY - minY),
    notUsed: [
      ...shapes.skipped,
      ...(openLines > 0 ? [plural(openLines, "open line")] : []),
      ...(outside > 0 ? [`${plural(outside, "closed shape")} outside the outline`] : []),
    ],
  }
}
