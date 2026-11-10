// The PCB's copper pours and holes on the canvas: each fill in its layer's colour (View → Pour fill: solid at 35%
// alpha, hatched, or its outline only), the reliefs and clearances showing as the gaps in it; the drawn outlines
// dashed, the selected pour's outline white with a handle on each corner, the pour being drawn; and the holes. The
// inactive layer's fills go first, so the active layer's lie on top. Plain TypeScript with .js imports, so the tests
// run it against a recording context.
import type { CopperPour, Hole, Point } from "../../../src/engine/model.js"
import type { PcbLayout, PourFill } from "../../../src/engine/pcb.js"
import { PALETTE, type Ctx } from "./ctx.js"
import type { ActiveLayer, LayerVisibility } from "./layers.js"
import { pourOutline, pourShown } from "./pour-hit.js"
import { POUR_FILL_ALPHA, type PourFillMode } from "./pour-view.js"

/** What the pours and holes look like now. */
export interface PourScene {
  mode: PourFillMode
  /** The pours hidden in the Layer panel, by id. */
  hidden: ReadonlySet<string>
  /** The selected pours and holes, by id. */
  selected: ReadonlySet<string>
  /** The pour or hole under the pointer. */
  hover?: string
  activeLayer: ActiveLayer
  /** Outlines shown in place of the design's: a pour whose corner is being dragged, or whose edit waits for its build. */
  outlines?: ReadonlyMap<string, readonly Point[]>
  /** The corners of the pour being drawn, closed back to the first. */
  preview?: readonly Point[]
}

export const POUR_COLORS: Readonly<Record<string, string>> = { top: PALETTE.topCopper, bottom: PALETTE.bottomCopper, inner1: PALETTE.inner1Copper, inner2: PALETTE.inner2Copper }
const LAYER_COLOR = POUR_COLORS
const HATCH_MM = 0.5
const MAX_HATCH = 400
const HANDLE_PX = 6
const OUTLINE_PX = 1
const SELECTED_PX = 1.5

function ringPath(ctx: Pick<Ctx, "moveTo" | "lineTo" | "closePath">, ring: readonly Point[]): void {
  ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.closePath()
}

/** One path of every piece and hole of the fill, for an even-odd fill or clip. */
function fillPath(ctx: Ctx | Path2D, fill: Pick<PourFill, "polygons">): void {
  if (!(hasPath2D() && ctx instanceof Path2D)) (ctx as Ctx).beginPath()
  for (const polygon of fill.polygons) {
    ringPath(ctx, polygon.outer)
    for (const hole of polygon.holes) ringPath(ctx, hole)
  }
}

/** The fewest CSS pixels between two hatch lines at the current zoom, so a zoomed-out fill does not turn solid. */
export const HATCH_MIN_PX = 6

/**
 * 45 degree lines HATCH_MM apart over the fill's bounds, and at least HATCH_MIN_PX apart at the zoom `px` (mm per CSS
 * pixel) gives; further apart when there would be more than MAX_HATCH.
 */
export function pourHatch(fill: Pick<PourFill, "polygons">, px = 0): Array<[Point, Point]> {
  const points = fill.polygons.flatMap((polygon) => polygon.outer)
  if (points.length === 0) return []
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const height = maxY - minY
  const start = minX - height
  const span = maxX - start
  const step = Math.max(HATCH_MM, HATCH_MIN_PX * px, span / (MAX_HATCH - 1))
  const count = Math.floor(span / step + 1e-9) + 1
  return Array.from({ length: count }, (_, i): [Point, Point] => [
    { x: start + i * step, y: minY },
    { x: start + i * step + height, y: maxY },
  ])
}

/**
 * Each fill's rings as one Path2D, and its hatch for the last zoom it was drawn at, kept by the fill object itself: a
 * build makes new fills, so a pointer move or a redraw at the same zoom rebuilds nothing. Without Path2D (the tests)
 * the paths are traced on the context each time.
 */
interface FillPaths {
  rings?: Path2D
  hatch?: { px: number; path: Path2D }
}
const FILL_PATHS = new WeakMap<object, FillPaths>()
const hasPath2D = (): boolean => typeof Path2D === "function"

function pathsOf(fill: object): FillPaths {
  const known = FILL_PATHS.get(fill)
  if (known) return known
  const made: FillPaths = {}
  FILL_PATHS.set(fill, made)
  return made
}

function ringsOf(fill: Pick<PourFill, "polygons">): Path2D | undefined {
  if (!hasPath2D()) return undefined
  const paths = pathsOf(fill)
  if (!paths.rings) {
    paths.rings = new Path2D()
    fillPath(paths.rings, fill)
  }
  return paths.rings
}

function hatchOf(fill: Pick<PourFill, "polygons">, px: number): Path2D | undefined {
  if (!hasPath2D()) return undefined
  const paths = pathsOf(fill)
  if (paths.hatch?.px !== px) {
    const path = new Path2D()
    for (const [a, b] of pourHatch(fill, px)) {
      path.moveTo(a.x, a.y)
      path.lineTo(b.x, b.y)
    }
    paths.hatch = { px, path }
  }
  return paths.hatch.path
}

function strokeRings(ctx: Ctx, fill: Pick<PourFill, "polygons">, width: number): void {
  ctx.lineWidth = width
  const rings = ringsOf(fill)
  if (rings) return ctx.stroke(rings)
  fillPath(ctx, fill)
  ctx.stroke()
}

function fillRings(ctx: Ctx, fill: Pick<PourFill, "polygons">, use: "fill" | "clip"): void {
  const rings = ringsOf(fill)
  if (rings) return use === "fill" ? ctx.fill(rings, "evenodd") : ctx.clip(rings, "evenodd")
  fillPath(ctx, fill)
  if (use === "fill") ctx.fill("evenodd")
  else ctx.clip("evenodd")
}

function strokeHatch(ctx: Ctx, fill: Pick<PourFill, "polygons">, px: number): void {
  const hatch = hatchOf(fill, px)
  if (hatch) return ctx.stroke(hatch)
  ctx.beginPath()
  for (const [a, b] of pourHatch(fill, px)) {
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
  }
  ctx.stroke()
}

function drawFill(ctx: Ctx, fill: PourFill, mode: PourFillMode, px: number): void {
  const color = LAYER_COLOR[fill.layer] ?? PALETTE.topCopper
  ctx.fillStyle = color
  ctx.strokeStyle = color
  if (mode === "outline") {
    ctx.globalAlpha = 1
    strokeRings(ctx, fill, OUTLINE_PX * px)
    return
  }
  ctx.globalAlpha = POUR_FILL_ALPHA
  if (mode === "solid") return fillRings(ctx, fill, "fill")
  ctx.save()
  fillRings(ctx, fill, "clip")
  ctx.lineWidth = OUTLINE_PX * px
  ctx.globalAlpha = 1
  strokeHatch(ctx, fill, px)
  ctx.restore()
  ctx.globalAlpha = 1
  strokeRings(ctx, fill, OUTLINE_PX * px)
}

/** The fills of the shown pours, the inactive layer's first; under the pads, tracks and vias. */
export function drawPourFills(ctx: Ctx, layout: Pick<PcbLayout, "pours">, scene: PourScene, layers: LayerVisibility, px: number): void {
  const shown = (layout.pours ?? []).filter((fill) => pourShown(fill, layers, scene.hidden))
  const ordered = [...shown.filter((fill) => fill.layer !== scene.activeLayer), ...shown.filter((fill) => fill.layer === scene.activeLayer)]
  for (const fill of ordered) drawFill(ctx, fill, scene.mode, px)
  ctx.globalAlpha = 1
}

function square(ctx: Ctx, at: Point, size: number): void {
  const half = size / 2
  ctx.beginPath()
  ctx.moveTo(at.x - half, at.y - half)
  ctx.lineTo(at.x + half, at.y - half)
  ctx.lineTo(at.x + half, at.y + half)
  ctx.lineTo(at.x - half, at.y + half)
  ctx.closePath()
}

/** The selected pour's outline, white, with a handle on each corner of a drawn one. */
function drawSelectedOutline(ctx: Ctx, outline: readonly Point[], handles: boolean, px: number): void {
  ctx.strokeStyle = PALETTE.selection
  ctx.lineWidth = SELECTED_PX * px
  ctx.beginPath()
  ringPath(ctx, outline)
  ctx.stroke()
  if (!handles) return
  ctx.fillStyle = PALETTE.selection
  for (const corner of outline) {
    square(ctx, corner, HANDLE_PX * px)
    ctx.fill()
  }
}

function drawOutline(ctx: Ctx, pour: CopperPour, outline: readonly Point[], scene: PourScene, px: number, hair: number): void {
  if (scene.selected.has(pour.id)) return drawSelectedOutline(ctx, outline, pour.outline !== undefined, px)
  const hovered = scene.hover === pour.id
  if (!hovered && pour.outline === undefined) return
  ctx.strokeStyle = hovered ? PALETTE.hover : (LAYER_COLOR[pour.layer] ?? PALETTE.topCopper)
  ctx.lineWidth = Math.max(hair, OUTLINE_PX * px)
  ctx.setLineDash([4 * px, 3 * px])
  ctx.beginPath()
  ringPath(ctx, outline)
  ctx.stroke()
  ctx.setLineDash([])
}

/** The pour being drawn: its corners joined and closed back to the first, dashed white. */
function drawPreview(ctx: Ctx, corners: readonly Point[], px: number): void {
  if (corners.length < 2) return
  ctx.strokeStyle = PALETTE.selection
  ctx.lineWidth = OUTLINE_PX * px
  ctx.setLineDash([4 * px, 3 * px])
  ctx.beginPath()
  ringPath(ctx, corners)
  ctx.stroke()
  ctx.setLineDash([])
}

/** The outlines of the shown pours (a whole-board pour's only while it is hovered or selected), and the one being drawn. */
export function drawPourOutlines(ctx: Ctx, layout: Pick<PcbLayout, "board">, scene: PourScene, layers: LayerVisibility, px: number, hair: number): void {
  for (const pour of layout.board?.pours ?? []) {
    if (!pourShown(pour, layers, scene.hidden)) continue
    drawOutline(ctx, pour, scene.outlines?.get(pour.id) ?? pourOutline(pour, layout.board), scene, px, hair)
  }
  if (scene.preview) drawPreview(ctx, scene.preview, px)
}

/** The holes, while the Hole layer is shown: the drill, a ring round it, and the selection or hover. */
export function drawHoles(ctx: Ctx, holes: readonly Hole[], scene: Pick<PourScene, "selected" | "hover">, layers: LayerVisibility, px: number, hair: number): void {
  if (!layers.hole) return
  for (const hole of holes) {
    const r = hole.diameter / 2
    ctx.fillStyle = PALETTE.drill
    ctx.beginPath()
    ctx.arc(hole.x, hole.y, r, 0, Math.PI * 2)
    ctx.fill()
    const selected = scene.selected.has(hole.id)
    ctx.strokeStyle = selected ? PALETTE.selection : scene.hover === hole.id ? PALETTE.hover : PALETTE.multiLayer
    ctx.lineWidth = selected ? SELECTED_PX * px : hair
    ctx.stroke()
  }
}
