// The shapes of a drawing applied in the file's order, as a painter applies them: an ink shape adds to the picture,
// a clear (light) one takes away from what is already there. A clear stroke takes away its outline area. An ink stroke
// stays a stroke unless a clear shape really falls on it; then it becomes its outline area (round ends and corners,
// as the line it replaces is drawn) and is cut. A stroke of no width has no area and is left whole. A drawing with no
// clear shape comes out exactly as read; one with no ink shape at all has its light shapes drawn as ink.
//
// The polygon operations are clipper-lib's (as the pours use, through pour/clip.ts), non-zero rule, in whole steps
// that map the drawing's extent to at least MIN_STEPS, so a small drawing is cut as finely as a large one, and the
// same file always gives the same result. They run here, in the reader, so they run once per file: the board
// element caches what the reader gives. Results are not asked to be strictly simple (that costs time growing faster
// than the point count); placing the drawing unites its areas strictly anyway (graphic-place.ts).
import ClipperLib from "clipper-lib"
import type { Point } from "../model.js"
import type { Tone } from "./colour.js"
import { counted, type GraphicFill, type GraphicStroke } from "./shapes.js"

/** One painted part of one element, in the file's order. */
export interface PaintedItem {
  tone: Tone
  fills: GraphicFill[]
  strokes: GraphicStroke[]
}

type Path = ClipperLib.IntPoint[]
type Paths = Path[]

/** The fewest steps the drawing's extent is cut into. */
const MIN_STEPS = 1_000_000
/** The fewest steps per mm, whatever the drawing's size (1 µm). */
const MIN_STEPS_PER_MM = 1000
/** How far a round end's or corner's edges may fall inside the true arc, in mm. */
const ARC_TOLERANCE_MM = 0.002
/** An area changed by less than this many square steps is not changed. */
const SAME_AREA_STEPS = 1
/** Miter limit passed to the offset; joins are round, so it is not used. */
const OFFSET_MITER_LIMIT = 2

const NON_ZERO = ClipperLib.PolyFillType.pftNonZero

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Points to whole steps and back, from the drawing's lower left corner. */
interface Codec {
  path(points: readonly Point[]): Path
  points(path: Path): Point[]
  perMm: number
}

function codecFor(items: readonly PaintedItem[]): Codec {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const item of items) {
    for (const ring of [...item.fills.flatMap((f) => [f.outer, ...f.holes]), ...item.strokes.map((s) => s.points)]) {
      for (const p of ring) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    }
  }
  const extent = Number.isFinite(minX) ? Math.max(maxX - minX, maxY - minY) : 0
  const perMm = extent > 0 ? Math.max(MIN_STEPS_PER_MM, MIN_STEPS / extent) : MIN_STEPS_PER_MM
  const [ox, oy] = Number.isFinite(minX) ? [minX, minY] : [0, 0]
  return {
    path: (points) => points.map((p) => ({ X: Math.round((p.x - ox) * perMm), Y: Math.round((p.y - oy) * perMm) })),
    points: (path) => path.map((p) => ({ x: p.X / perMm + ox, y: p.Y / perMm + oy })),
    perMm,
  }
}

function boxOf(paths: Paths): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const path of paths) {
    for (const p of path) {
      box.minX = Math.min(box.minX, p.X)
      box.minY = Math.min(box.minY, p.Y)
      box.maxX = Math.max(box.maxX, p.X)
      box.maxY = Math.max(box.maxY, p.Y)
    }
  }
  return box
}

const meet = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
const areaOf = (paths: Paths) => paths.reduce((sum, path) => sum + ClipperLib.Clipper.Area(path), 0)

function engineFor(subject: Paths, clip: Paths): ClipperLib.Clipper {
  const engine = new ClipperLib.Clipper()
  engine.AddPaths(subject.filter((path) => path.length >= 3), ClipperLib.PolyType.ptSubject, true)
  engine.AddPaths(clip.filter((path) => path.length >= 3), ClipperLib.PolyType.ptClip, true)
  return engine
}

function difference(a: Paths, b: Paths): Paths {
  const out: Paths = []
  engineFor(a, b).Execute(ClipperLib.ClipType.ctDifference, out, NON_ZERO, NON_ZERO)
  return out
}

function regions(paths: Paths): { outer: Path; holes: Path[] }[] {
  const tree = new ClipperLib.PolyTree()
  engineFor(paths, []).Execute(ClipperLib.ClipType.ctUnion, tree, NON_ZERO, NON_ZERO)
  return ClipperLib.JS.PolyTreeToExPolygons(tree).map((piece) => ({ outer: piece.outer, holes: piece.holes }))
}

/** A stroke's outline area: the line grown by half its width each side, ends and corners round. */
function strokeArea(stroke: GraphicStroke, codec: Codec): Paths {
  if (stroke.width <= 0 || stroke.points.length === 0) return []
  const engine = new ClipperLib.ClipperOffset(OFFSET_MITER_LIMIT, ARC_TOLERANCE_MM * codec.perMm)
  const end = stroke.closed && stroke.points.length >= 3 ? ClipperLib.EndType.etClosedLine : ClipperLib.EndType.etOpenRound
  engine.AddPaths([codec.path(stroke.points)], ClipperLib.JoinType.jtRound, end)
  const out: Paths = []
  engine.Execute(out, (stroke.width / 2) * codec.perMm)
  return out
}

/** Paths that make one shape together (an outline and its holes), with the box round them. */
interface Group {
  paths: Paths
  box: Box
}

interface InkStroke {
  stroke: GraphicStroke
  box: Box
}

interface Picture {
  /** The ink area so far, as shapes that may overlap (united at the end). */
  area: Group[]
  strokes: InkStroke[]
}

const group = (paths: Paths): Group => ({ paths, box: boxOf(paths) })
const pieces = (paths: Paths): Group[] => (paths.length === 0 ? [] : regions(paths).map((piece) => group([piece.outer, ...piece.holes])))

/** The shape less the clear groups that meet its box, or undefined when they take nothing away; marks those that did. */
function cutPaths(paths: Paths, box: Box, clear: readonly Group[], used: Set<Group>): Paths | undefined {
  const here = clear.filter((one) => meet(one.box, box))
  if (here.length === 0) return undefined
  const left = difference(paths, here.flatMap((one) => one.paths))
  if (Math.abs(areaOf(paths) - areaOf(left)) <= SAME_AREA_STEPS) return undefined
  here.forEach((one) => used.add(one))
  return left
}

/** The picture with a run of clear shapes taken away; each ink shape is cut only by those that meet its box. */
function cut(picture: Picture, clear: readonly Group[], used: Set<Group>, codec: Codec): Picture {
  const area = picture.area.flatMap((ink) => {
    const left = cutPaths(ink.paths, ink.box, clear, used)
    return left === undefined ? [ink] : pieces(left)
  })
  const strokes: InkStroke[] = []
  for (const one of picture.strokes) {
    const outline = one.stroke.width > 0 && clear.some((c) => meet(c.box, one.box)) ? strokeArea(one.stroke, codec) : []
    const left = outline.length === 0 ? undefined : cutPaths(outline, boxOf(outline), clear, used)
    if (left === undefined) strokes.push(one)
    else area.push(...pieces(left))
  }
  return { area, strokes }
}

const fillGroups = (fills: readonly GraphicFill[], codec: Codec): Group[] =>
  fills.map((fill) => [fill.outer, ...fill.holes].filter((ring) => ring.length >= 3).map(codec.path)).filter((paths) => paths.length > 0).map(group)

function clearGroups(items: readonly PaintedItem[], codec: Codec): Group[] {
  const strokes = items.flatMap((item) => item.strokes).map((s) => strokeArea(s, codec)).filter((paths) => paths.length > 0)
  return [...items.flatMap((item) => fillGroups(item.fills, codec)), ...strokes.map(group)]
}

/** Consecutive items of the same tone, together: one cut takes away a run of clear shapes at once. */
function runs(items: readonly PaintedItem[]): PaintedItem[][] {
  const out: PaintedItem[][] = []
  for (const item of items) {
    const last = out.at(-1)
    if (last && (last[0] as PaintedItem).tone === item.tone) last.push(item)
    else out.push([item])
  }
  return out
}

function paint(items: readonly PaintedItem[], codec: Codec): { picture: Picture; unused: number } {
  const used = new Set<Group>()
  let clearCount = 0
  const picture = runs(items).reduce<Picture>((before, run) => {
    if ((run[0] as PaintedItem).tone === "clear") {
      const clear = clearGroups(run, codec)
      clearCount += clear.length
      return cut(before, clear, used, codec)
    }
    const strokes = run.flatMap((item) => item.strokes).filter((s) => s.points.length > 0).map((stroke) => ({ stroke, box: boxOf([codec.path(stroke.points)]) }))
    return { area: [...before.area, ...run.flatMap((item) => fillGroups(item.fills, codec))], strokes: [...before.strokes, ...strokes] }
  }, { area: [], strokes: [] })
  return { picture, unused: clearCount - used.size }
}

/** The note when a drawing has no dark shape and its light shapes are drawn as ink. */
export const ALL_LIGHT_NOTE = "no dark shape, so the light shapes are drawn as ink"

const inkOnly = (items: readonly PaintedItem[]) => ({ fills: items.flatMap((item) => item.fills), strokes: items.flatMap((item) => item.strokes) })

/** The drawing's filled areas and lines once every item is applied in order, and what to say about it. */
export function applyInOrder(items: readonly PaintedItem[]): { fills: GraphicFill[]; strokes: GraphicStroke[]; notes: string[] } {
  const ink = items.filter((item) => item.tone === "ink")
  if (ink.length === items.length) return { ...inkOnly(items), notes: [] }
  if (ink.length === 0) return { ...inkOnly(items), notes: [ALL_LIGHT_NOTE] }
  const codec = codecFor(items)
  const { picture, unused } = paint(items, codec)
  const paths = picture.area.flatMap((one) => one.paths)
  const fills = (paths.length === 0 ? [] : regions(paths)).map((piece) => ({ outer: codec.points(piece.outer), holes: piece.holes.map(codec.points) }))
  const notes = unused > 0 ? [`${counted(unused, "light shape")} over no ink, left out`] : []
  return { fills: fills.filter((fill) => fill.outer.length >= 3), strokes: picture.strokes.map((one) => one.stroke), notes }
}
