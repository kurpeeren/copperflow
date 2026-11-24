// A perfboard or stripboard as built, one side, as pixels: render's view "board" on such a board. The top shows the
// holes, the parts (their outlines, legs and designators) and the links with their names; the bottom, seen from below
// with left and right swapped, shows the pads (perfboard) or the strips with their cuts (stripboard), the solder runs
// and a solder joint at every leg and link end, each cut marked with a red cross. Row letters and column numbers stand
// round the board on both sides. Pure: coverage images (fab/picture/raster.ts) painted over each other in order.
import type { CutRecord, LinkRecord, ProtoRecord, SolderRecord } from "../../core/layout-proto.js"
import { textStrokes } from "../fab/stroke-font.js"
import type { Side } from "../fab/picture/board-picture.js"
import type { Rgb } from "../fab/picture/looks.js"
import { box, capsule, disc, emptyCoverage, gridFor, polygons, toPixel, type Box, type Coverage, type Grid } from "../fab/picture/raster.js"
import type { Point } from "../model.js"
import type { PcbLayout, PlacedFootprint } from "../pcb.js"
import { alongStrip, holeKey, holePoint, rowName, type Hole, type ProtoGrid } from "./grid.js"
import { cutKeys, gridHole, pairKey } from "./joins.js"
import { pinHoles } from "./placement.js"

/** Room round the board for the row letters and column numbers, in mm. */
const LABEL_ROOM = 3.2
const LABEL_HEIGHT = 1.3
const NAME_HEIGHT = 1.2

const COLOURS = {
  paper: [255, 255, 255],
  board: [214, 180, 120],
  hole: [58, 44, 30],
  copper: [196, 120, 64],
  solder: [196, 200, 206],
  solderEdge: [120, 124, 130],
  cut: [214, 40, 40],
  ink: [40, 40, 40],
  part: [70, 76, 84],
  partFill: [232, 228, 218],
  leg: [150, 150, 150],
} satisfies Record<string, Rgb>

/** The links' wire colours, taken in turn. */
const WIRES: readonly Rgb[] = [
  [30, 90, 200],
  [200, 40, 40],
  [30, 140, 60],
  [220, 140, 20],
  [120, 50, 170],
  [20, 150, 160],
]

export interface ProtoPicture {
  width: number
  height: number
  rgba: Uint8ClampedArray
}

/** Paints a coverage image in one colour over the picture so far. */
function paint(rgba: Float32Array, layer: Coverage, colour: Rgb, alpha = 1): void {
  for (let i = 0; i < layer.data.length; i += 1) {
    const c = (layer.data[i] as number) * alpha
    if (c <= 0) continue
    for (let k = 0; k < 3; k += 1) rgba[i * 4 + k] = (rgba[i * 4 + k] as number) * (1 - c) + (colour[k] as number) * c
  }
}

interface Canvas {
  grid: Grid
  proto: ProtoGrid
  rgba: Float32Array
  px: (p: Point) => Point
  s: number
}

const layerOf = (canvas: Canvas) => emptyCoverage(canvas.grid)

function strokes(canvas: Canvas, layer: Coverage, lines: readonly Point[][], width: number): void {
  for (const line of lines) {
    const points = line.map(canvas.px)
    for (let i = 1; i < points.length; i += 1) capsule(layer, points[i - 1] as Point, points[i] as Point, (width / 2) * canvas.s)
  }
}

/** Text that reads the right way round on either side. */
function text(canvas: Canvas, layer: Coverage, words: string, at: Point, height: number): void {
  strokes(canvas, layer, textStrokes(words, at, height, canvas.grid.mirrored), height * 0.12)
}

function boardBody(canvas: Canvas, outline: readonly Point[]): void {
  const body = layerOf(canvas)
  polygons(body, [outline.map(canvas.px)], "nonzero")
  paint(canvas.rgba, body, COLOURS.board)
}

function labels(canvas: Canvas): void {
  const { proto } = canvas
  const ink = layerOf(canvas)
  const left = proto.first.x - proto.pitch / 2 - LABEL_ROOM / 2
  const right = proto.first.x + (proto.columns - 0.5) * proto.pitch + LABEL_ROOM / 2
  const top = proto.first.y + proto.pitch / 2 + LABEL_ROOM / 2
  const bottom = proto.first.y - (proto.rows - 0.5) * proto.pitch - LABEL_ROOM / 2
  for (let row = 0; row < proto.rows; row += 1) {
    const y = holePoint(proto, { col: 0, row }).y
    for (const x of [left, right]) text(canvas, ink, rowName(row), { x, y }, LABEL_HEIGHT)
  }
  for (let col = 0; col < proto.columns; col += 1) {
    const x = holePoint(proto, { col, row: 0 }).x
    const height = col >= 9 ? LABEL_HEIGHT * 0.8 : LABEL_HEIGHT
    for (const y of [top, bottom]) text(canvas, ink, String(col + 1), { x, y }, height)
  }
  paint(canvas.rgba, ink, COLOURS.ink)
}

function holes(canvas: Canvas, radius: number): void {
  const layer = layerOf(canvas)
  for (let row = 0; row < canvas.proto.rows; row += 1) {
    for (let col = 0; col < canvas.proto.columns; col += 1) disc(layer, canvas.px(holePoint(canvas.proto, { col, row })), radius * canvas.s)
  }
  paint(canvas.rgba, layer, COLOURS.hole)
}

/** The bottom's copper: a pad round every hole, or the strips less their cuts. */
function copper(canvas: Canvas, cuts: readonly CutRecord[]): void {
  const { proto, s } = canvas
  const layer = layerOf(canvas)
  if (proto.kind === "perfboard") {
    for (let row = 0; row < proto.rows; row += 1) for (let col = 0; col < proto.columns; col += 1) disc(layer, canvas.px(holePoint(proto, { col, row })), 0.95 * s)
  } else {
    const cut = cutKeys(proto, cuts)
    for (let row = 0; row < proto.rows; row += 1) {
      for (let col = 0; col < proto.columns; col += 1) {
        const hole = { col, row }
        const next = alongStrip(proto, hole)
        const at = holePoint(proto, hole)
        box(layer, canvas.px(at), 1.05 * s, 1.05 * s, 0, 0)
        if (!next) continue
        const [a, b] = [holeKey(proto, hole), holeKey(proto, next)]
        if (!cut.between.has(pairKey(a, b))) capsule(layer, canvas.px(at), canvas.px(holePoint(proto, next)), 1.05 * s)
      }
    }
    for (const key of cut.at) disc(layer, canvas.px(holePoint(proto, { col: key % proto.columns, row: Math.floor(key / proto.columns) })), 1.25 * s, "clear")
    for (const pair of cut.between) {
      const [a, b] = pair.split("|").map(Number) as [number, number]
      const [pa, pb] = [a, b].map((key) => holePoint(proto, { col: key % proto.columns, row: Math.floor(key / proto.columns) })) as [Point, Point]
      const mid = canvas.px({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 })
      const across = proto.strips === "columns" ? [1.2, 0.25] : [0.25, 1.2]
      box(layer, mid, (across[0] as number) * s, (across[1] as number) * s, 0, 0, "clear")
    }
  }
  paint(canvas.rgba, layer, COLOURS.copper)
}

/** The solder: the runs, and a joint at every leg and link end. */
function solder(canvas: Canvas, layout: Pick<PcbLayout, "parts">, records: readonly ProtoRecord[]): void {
  const { proto, s } = canvas
  const layer = layerOf(canvas)
  const joint = (hole: Hole | undefined) => hole && disc(layer, canvas.px(holePoint(proto, hole)), 0.8 * s)
  for (const run of records.filter((r): r is SolderRecord => r.t === "solder")) {
    const points = run.holes.map((name) => gridHole(proto, name))
    points.forEach(joint)
    for (let i = 1; i < points.length; i += 1) {
      const [a, b] = [points[i - 1], points[i]]
      if (a && b) capsule(layer, canvas.px(holePoint(proto, a)), canvas.px(holePoint(proto, b)), 0.65 * s)
    }
  }
  for (const link of records.filter((r): r is LinkRecord => r.t === "link")) [link.from, link.to].forEach((name) => joint(gridHole(proto, name)))
  for (const { hole } of pinHoles(proto, layout.parts).values()) joint(hole)
  paint(canvas.rgba, layer, COLOURS.solder)
}

function cutMarks(canvas: Canvas, cuts: readonly CutRecord[]): void {
  const { proto, s } = canvas
  const layer = layerOf(canvas)
  const cross = (at: Point) => {
    const c = canvas.px(at)
    const r = 0.9 * s
    capsule(layer, { x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r }, 0.14 * s)
    capsule(layer, { x: c.x - r, y: c.y + r }, { x: c.x + r, y: c.y - r }, 0.14 * s)
  }
  for (const cut of cuts) {
    const holes = (cut.at !== undefined ? [cut.at] : (cut.between ?? [])).map((name) => gridHole(proto, name))
    if (holes.some((hole) => hole === undefined)) continue
    const points = (holes as Hole[]).map((hole) => holePoint(proto, hole))
    cross({ x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length })
  }
  paint(canvas.rgba, layer, COLOURS.cut)
}

function parts(canvas: Canvas, layout: Pick<PcbLayout, "parts">): void {
  const placed = layout.parts.filter((part) => Number.isFinite(part.x) && Number.isFinite(part.y) && !part.autoPlaced)
  const fill = layerOf(canvas)
  const edge = layerOf(canvas)
  const legs = layerOf(canvas)
  const names = layerOf(canvas)
  for (const part of placed) {
    if (part.courtyard.length >= 3) polygons(fill, [part.courtyard.map(canvas.px)], "nonzero")
    strokes(canvas, edge, outlineOf(part), 0.2)
    for (const pad of part.pads) disc(legs, canvas.px(pad), 0.45 * canvas.s)
    text(canvas, names, part.component, nameSpot(part), NAME_HEIGHT)
  }
  paint(canvas.rgba, fill, COLOURS.partFill, 0.85)
  paint(canvas.rgba, edge, COLOURS.part)
  paint(canvas.rgba, legs, COLOURS.leg)
  paint(canvas.rgba, names, COLOURS.ink)
}

/** The part's body lines, or its courtyard closed when it has none. */
function outlineOf(part: PlacedFootprint): Point[][] {
  if (part.fabrication.length > 0) return part.fabrication
  const ring = part.courtyard
  return ring.length >= 3 ? [[...ring, ring[0] as Point]] : []
}

/** The middle of the courtyard, or the part's origin. */
function nameSpot(part: PlacedFootprint): Point {
  if (part.courtyard.length < 3) return { x: part.x, y: part.y }
  const xs = part.courtyard.map((p) => p.x)
  const ys = part.courtyard.map((p) => p.y)
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
}

function links(canvas: Canvas, records: readonly ProtoRecord[]): void {
  const { proto, s } = canvas
  records
    .filter((r): r is LinkRecord => r.t === "link")
    .forEach((link, index) => {
      const [from, to] = [gridHole(proto, link.from), gridHole(proto, link.to)]
      if (!from || !to) return
      const [a, b] = [holePoint(proto, from), holePoint(proto, to)]
      const wire = layerOf(canvas)
      capsule(wire, canvas.px(a), canvas.px(b), 0.45 * s)
      paint(canvas.rgba, wire, WIRES[index % WIRES.length] as Rgb)
      const name = layerOf(canvas)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const vertical = from.col === to.col
      text(canvas, name, link.id.toUpperCase(), { x: mid.x + (vertical ? 1.3 : 0), y: mid.y + (vertical ? 0 : 1.1) }, 1)
      paint(canvas.rgba, name, COLOURS.ink)
    })
}

/** The box drawn: the board and the room for the labels. */
function pictureBox(outline: readonly Point[]): Box {
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  return { minX: Math.min(...xs) - LABEL_ROOM, minY: Math.min(...ys) - LABEL_ROOM, maxX: Math.max(...xs) + LABEL_ROOM, maxY: Math.max(...ys) + LABEL_ROOM }
}

/** The pixels per mm that make the picture `width` pixels wide. */
export function protoScale(layout: Pick<PcbLayout, "board">, width: number): number {
  const area = pictureBox(layout.board?.outline ?? [])
  return width / (area.maxX - area.minX)
}

/** One side of a proto board as built. */
export function protoPicture(layout: Pick<PcbLayout, "board" | "parts" | "proto">, side: Side, pxPerMm: number): ProtoPicture {
  const proto = layout.board?.proto
  const outline = layout.board?.outline ?? []
  if (!proto || outline.length < 3) throw new Error("The board is not a perfboard or stripboard")
  const grid = gridFor(pictureBox(outline), pxPerMm, side === "bottom")
  const rgba = new Float32Array(grid.width * grid.height * 4)
  for (let i = 0; i < grid.width * grid.height; i += 1) rgba.set([...COLOURS.paper, 255], i * 4)
  const canvas: Canvas = { grid, proto, rgba, px: (p) => toPixel(grid, p), s: grid.pxPerMm }
  const records = layout.proto ?? []
  const cuts = records.filter((r): r is CutRecord => r.t === "cut")
  boardBody(canvas, outline)
  labels(canvas)
  if (side === "bottom") {
    copper(canvas, cuts)
    holes(canvas, 0.5)
    solder(canvas, layout, records)
    cutMarks(canvas, cuts)
  } else {
    holes(canvas, 0.5)
    parts(canvas, layout)
    links(canvas, records)
  }
  return { width: grid.width, height: grid.height, rgba: Uint8ClampedArray.from(rgba) }
}
