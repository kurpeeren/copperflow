// The board's drawings (`<boardgraphic>`) on the PCB canvas: the very areas and lines the Gerber files carry
// (engine/graphic-place.ts), on the silkscreen in the side's silk colour, on the mask as a hatched outline in the
// side's copper colour (an opening shows what lies under it). A selected or hovered one is ringed; a dragged one is
// drawn where it is going. Drawn in world units, under the canvas's world transform. Pure over the Ctx.
import { graphicBox } from "../../../src/engine/graphic-place.js"
import type { BoardGraphic } from "../../../src/engine/model.js"
import { PALETTE, type Ctx } from "./ctx.js"
import type { Point } from "./geometry.js"
import { copperLayerShown, type LayerVisibility } from "./layers.js"
import type { SilkTextScene } from "./silk-text-draw.js"

const RING_GAP_PX = 3
const RING_PX = 1.5
const HOVER_ALPHA = 0.5
/** A mask opening is washed in, not painted solid, so the copper under it still shows. */
const MASK_ALPHA = 0.35

/** A drawing on copper off the working copper layer is dimmed as a track there is. */
const INACTIVE_COPPER_ALPHA = 0.4
const COPPER_COLOURS: Readonly<Record<string, string>> = { top: PALETTE.topCopper, bottom: PALETTE.bottomCopper, inner1: PALETTE.inner1Copper, inner2: PALETTE.inner2Copper }

const bottom = (graphic: BoardGraphic) => graphic.layer.startsWith("bottom")
const isMask = (graphic: BoardGraphic) => graphic.layer.endsWith("mask")
const isCopper = (graphic: BoardGraphic) => COPPER_COLOURS[graphic.layer] !== undefined

/** Whether the drawing's layer is shown: the silk layer of its side; for a mask opening that side's copper; for copper its own copper layer, an inner one too. */
export function graphicShown(layers: LayerVisibility, graphic: BoardGraphic): boolean {
  if (isCopper(graphic)) return copperLayerShown(graphic.layer, layers)
  if (isMask(graphic)) return layers[bottom(graphic) ? "bottom" : "top"]
  return layers[bottom(graphic) ? "bottomSilk" : "topSilk"]
}

const colourOf = (graphic: BoardGraphic): string =>
  COPPER_COLOURS[graphic.layer] ?? (isMask(graphic) ? (bottom(graphic) ? PALETTE.bottomCopper : PALETTE.topCopper) : bottom(graphic) ? PALETTE.bottomSilk : PALETTE.topSilk)

/** The drawing where the canvas shows it: moved by a drag in progress. */
export function shownGraphic(graphic: BoardGraphic, scene: SilkTextScene | undefined): BoardGraphic {
  const moving = scene?.moving
  if (!moving || moving.id !== graphic.id) return graphic
  const by = (p: Point) => ({ x: p.x + moving.by.x, y: p.y + moving.by.y })
  return {
    ...graphic,
    x: graphic.x + moving.by.x,
    y: graphic.y + moving.by.y,
    areas: graphic.areas.map((area) => ({ outer: area.outer.map(by), holes: area.holes.map((hole) => hole.map(by)) })),
    lines: graphic.lines.map((line) => ({ ...line, points: line.points.map(by) })),
  }
}

function ringPath(ctx: Ctx, ring: readonly Point[]): void {
  ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.closePath()
}

function paint(ctx: Ctx, graphic: BoardGraphic): void {
  ctx.fillStyle = colourOf(graphic)
  ctx.strokeStyle = colourOf(graphic)
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  if (graphic.areas.length > 0) {
    ctx.beginPath()
    for (const area of graphic.areas) for (const ring of [area.outer, ...area.holes]) ringPath(ctx, ring)
    ctx.fill("evenodd")
  }
  for (const line of graphic.lines) {
    const first = line.points[0]
    if (!first) continue
    ctx.lineWidth = line.width
    ctx.beginPath()
    if (line.points.length === 1) {
      ctx.arc(first.x, first.y, line.width / 2, 0, 2 * Math.PI)
      ctx.fill()
      continue
    }
    line.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
  }
}

function ring(ctx: Ctx, graphic: BoardGraphic, selected: boolean, px: number): void {
  const box = graphicBox(graphic)
  const gap = RING_GAP_PX * px
  ctx.save()
  ctx.strokeStyle = PALETTE.selection
  ctx.globalAlpha = selected ? 1 : HOVER_ALPHA
  ctx.lineWidth = RING_PX * px
  ctx.beginPath()
  ringPath(ctx, [
    { x: box.minX - gap, y: box.minY - gap },
    { x: box.maxX + gap, y: box.minY - gap },
    { x: box.maxX + gap, y: box.maxY + gap },
    { x: box.minX - gap, y: box.maxY + gap },
  ])
  ctx.stroke()
  ctx.restore()
}

/** Draws every drawing whose layer is shown; `px` is one CSS pixel in mm; copper off `activeLayer` is dimmed. */
export function drawGraphics(ctx: Ctx, graphics: readonly BoardGraphic[], layers: LayerVisibility, scene: SilkTextScene | undefined, px: number, activeLayer = "top"): void {
  for (const original of graphics) {
    if (!graphicShown(layers, original)) continue
    const graphic = shownGraphic(original, scene)
    ctx.save()
    if (isMask(graphic)) ctx.globalAlpha = MASK_ALPHA
    if (isCopper(graphic) && graphic.layer !== activeLayer) ctx.globalAlpha = INACTIVE_COPPER_ALPHA
    paint(ctx, graphic)
    ctx.restore()
    if (scene?.selected.has(graphic.id) || scene?.hovered === graphic.id) ring(ctx, graphic, scene.selected.has(graphic.id), px)
  }
}

/** The drawing under a point (mm), topmost first: within its box grown by `slack` mm; only drawings on shown layers. */
export function graphicAt(graphics: readonly BoardGraphic[], p: Point, layers: LayerVisibility, slack: number): BoardGraphic | undefined {
  for (const graphic of [...graphics].reverse()) {
    if (!graphicShown(layers, graphic)) continue
    const box = graphicBox(graphic)
    if (p.x >= box.minX - slack && p.x <= box.maxX + slack && p.y >= box.minY - slack && p.y <= box.maxY + slack) return graphic
  }
  return undefined
}
