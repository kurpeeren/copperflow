// copperflow's PCB renderer: draws the engine's board layout onto a 2D canvas in layer order.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import { DESIGNATOR_HEIGHT, designatorAnchor, designatorTurn, SILK_WIDTH } from "../../../src/engine/fab/designators.js"
import { textStrokes } from "../../../src/engine/fab/stroke-font.js"
import type { PcbLayout, PlacedFootprint, WorldPad } from "../../../src/engine/pcb.js"
import { drawCopperItems, type CopperScene } from "./copper-draw.js"
import { devicePixelIn } from "./crisp.js"
import { PALETTE, PCB_DIM, type Ctx } from "./ctx.js"
import { type Camera, type PartBox, type Point, type Size } from "./geometry.js"
import { DEFAULT_LAYERS, padLayer, type LayerVisibility } from "./layers.js"
import { drawViolationMarkers, type ViolationMarker } from "./markers.js"
import { drawHoles, drawPourFills, drawPourOutlines, type PourScene } from "./pour-draw.js"
import { drawSilkTexts, strokeLine, type SilkTextScene } from "./silk-text-draw.js"
import { drawGraphics } from "./graphic-draw.js"
import { devicePxFor, sharpenText, textShown } from "./text-level.js"

export interface PcbDrawOptions {
  /** Device pixels per CSS pixel. */
  ratio: number
  /** Which layers are drawn; every layer is by default. */
  layers?: Partial<LayerVisibility>
  /** The nets to highlight; other copper is dimmed. */
  highlight?: { nets: readonly string[] }
  /** The parts being dragged and how far they have moved, in mm. */
  moving?: { components: readonly string[]; by: Point }
  /** Defaults to true. */
  ratsnest?: boolean
  /** Violations with a position, ringed above everything else. */
  violations?: readonly ViolationMarker[]
  /** The violation picked in the DRC tab, whose ring is thicker. */
  activeViolation?: string
  /** The layout file's tracks and vias (as dragged, or waiting for their build), with their selection and hover. */
  copper?: CopperScene
  /** How the pours are drawn and which are selected, hovered or hidden; without it the fills are solid and nothing is marked. */
  pours?: PourScene
  /** Which of the board's silkscreen texts are selected, hovered or being dragged. */
  silkTexts?: SilkTextScene
}

const PLAIN_POURS: PourScene = { mode: "solid", hidden: new Set(), selected: new Set(), activeLayer: "top" }

type View = { camera: Camera; size: Size }

const NO_SHIFT: Point = { x: 0, y: 0 }
export { PCB_DIM }
/** The dashed courtyard of an auto-placed part stays at full alpha and a little thicker, so it reads on black. */
const AUTO_COURTYARD_PX = 1.5
const LIT_WASH_ALPHA = 0.35
const LIT_OUTLINE_PX = 1.5
const RATSNEST_ALPHA = 0.6
const SILK_WIDTH_MM = 0.12
const BOARD_EDGE_PX = 1.5
const KEEPOUT_ALPHA = 0.7
const KEEPOUT_HATCH_MM = 0.5
/** The most hatch lines one keepout gets, so a keepout of metres cannot stall a redraw. */
export const MAX_HATCH_LINES = 400
/** Lets the last line land on the box's edge despite rounding in span / step. */
const HATCH_SLACK = 1e-9
const DEFAULT_CORNER = 0.25
/** Parts the engine placed for itself are drawn faded, so the person sees they have no position yet. */
const AUTO_PLACED_ALPHA = 0.6

const rad = (degrees: number) => (degrees * Math.PI) / 180
/** Whether the layer of `kind` (Silk or Assembly) on the part's side is shown. */
const shownOn = (layers: LayerVisibility, part: PlacedFootprint, kind: "Silk" | "Assembly") => layers[`${part.side === "top" ? "top" : "bottom"}${kind}`]
const alphaOf = (part: PlacedFootprint) => (part.autoPlaced ? AUTO_PLACED_ALPHA : 1)
const assemblyColor = (part: PlacedFootprint) => (part.side === "top" ? PALETTE.topAssembly : PALETTE.bottomAssembly)

/**
 * Draws the board, then the ratsnest and the violation rings. Auto-placed parts are faded, and their dashed courtyard
 * is a little thicker; it follows the Courtyard layer, as every courtyard does.
 */
export function drawPcb(ctx: Ctx, layout: PcbLayout, view: View, options: PcbDrawOptions): void {
  const layers: LayerVisibility = { ...DEFAULT_LAYERS, ...options.layers }
  const { camera, size } = view
  const px = 1 / camera.scale
  /** One device pixel in world units: the thinnest any stroke is drawn. */
  const hair = devicePixelIn(px, options.ratio)
  const shiftOf = (part: PlacedFootprint) => (options.moving?.components.includes(part.component) ? options.moving.by : NO_SHIFT)
  const each = (paint: (part: PlacedFootprint) => void) => {
    for (const part of layout.parts) {
      framed(ctx, shiftOf(part).x, shiftOf(part).y, 0, () => {
        ctx.globalAlpha = alphaOf(part)
        paint(part)
      })
    }
    ctx.globalAlpha = 1
  }

  ctx.save()
  ctx.setTransform(...worldMatrix(view, options.ratio))
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  if (layers.keepout) drawKeepouts(ctx, layout, px, hair)
  const pours = options.pours ?? PLAIN_POURS
  drawPourFills(ctx, layout, pours, layers, px)
  drawCopper(ctx, layers, options.highlight, each, px)
  if (options.copper) drawCopperItems(ctx, options.copper, layers, options.highlight, px)
  if (layers.hole) drawDrills(ctx, each)
  drawHoles(ctx, layout.holes ?? [], pours, layers, px, hair)
  drawPourOutlines(ctx, layout, pours, layers, px, hair)
  each((part) => {
    if (shownOn(layers, part, "Silk")) drawPolylines(ctx, part.silkscreen, part.side === "top" ? PALETTE.topSilk : PALETTE.bottomSilk, Math.max(SILK_WIDTH_MM, hair), false)
  })
  drawGraphics(ctx, layout.graphics ?? [], layers, options.silkTexts, px, options.copper?.activeLayer)
  drawSilkTexts(ctx, layout.silkTexts ?? [], layers, options.silkTexts, px)
  if (textShown("name", devicePxFor(DESIGNATOR_HEIGHT, camera.scale, options.ratio), devicePxFor(DESIGNATOR_HEIGHT, camera.scale, options.ratio))) {
    each((part) => {
      if (shownOn(layers, part, "Silk")) drawDesignator(ctx, part, hair)
    })
  }
  if (layers.courtyard) drawCourtyards(ctx, each, px, hair)
  each((part) => {
    if (shownOn(layers, part, "Assembly")) drawPolylines(ctx, part.fabrication, assemblyColor(part), hair, false)
  })
  if (layers.boardOutline) {
    drawBoard(ctx, layout, () => {
      ctx.strokeStyle = PALETTE.boardEdge
      ctx.lineWidth = BOARD_EDGE_PX * px
      ctx.stroke()
    })
  }
  if (options.ratsnest !== false && layers.ratline) drawRatsnest(ctx, layout, options, hair)

  // Text is drawn in screen space so it stays upright and readable at any zoom.
  ctx.setTransform(options.ratio, 0, 0, options.ratio, 0, 0)
  sharpenText(ctx)
  drawViolationMarkers(ctx, view, options.violations ?? [], options.activeViolation, true)
  ctx.restore()
}

/**
 * The pad under a point, or undefined. Pads of the same part are tried in order; with `visible`, pads on hidden layers
 * are skipped, and with `pickable`, the pads of a part that may not be picked (pick.ts canPick: the Filter tab).
 */
export function padAt(layout: PcbLayout, p: Point, visible?: LayerVisibility, pickable?: (part: string) => boolean): WorldPad | undefined {
  for (const part of layout.parts) {
    if (pickable && !pickable(part.component)) continue
    const hit = part.pads.find((pad) => (!visible || visible[padLayer(pad)]) && insidePad(pad, p))
    if (hit) return hit
  }
  return undefined
}

/** One box per part, from its courtyard; the id is the component. */
export function pcbBoxes(layout: PcbLayout): PartBox[] {
  return layout.parts.map((part) => {
    const box = courtyardBox(part)
    return { name: part.component, pcbComponentId: part.component, center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, box }
  })
}

function worldMatrix({ camera, size }: View, ratio: number): [number, number, number, number, number, number] {
  const s = camera.scale * ratio
  return [s, 0, 0, -s, (size.width / 2 - camera.cx * camera.scale) * ratio, (size.height / 2 + camera.cy * camera.scale) * ratio]
}

function courtyardBox(part: PlacedFootprint) {
  const xs = part.courtyard.map((c) => c.x)
  const ys = part.courtyard.map((c) => c.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/** Runs `shape` in a frame centred at (x, y) and turned counter-clockwise by `degrees`. */
function framed(ctx: Ctx, x: number, y: number, degrees: number, shape: () => void): void {
  ctx.save()
  ctx.translate(x, y)
  if (degrees) ctx.rotate(rad(degrees))
  shape()
  ctx.restore()
}

function polygon(ctx: Ctx, points: readonly Point[]): void {
  ctx.beginPath()
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.closePath()
}

function circle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath()
  ctx.arc(x, y, Math.max(r, 0), 0, Math.PI * 2)
}

/** A rounded rectangle centred on the origin of the current frame. */
function roundRect(ctx: Ctx, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  const x = -w / 2
  const y = -h / 2
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

const stadium = (ctx: Ctx, w: number, h: number) => roundRect(ctx, w, h, Math.min(w, h) / 2)

function drawBoard(ctx: Ctx, layout: PcbLayout, paint: () => void): void {
  const outline = layout.board?.outline
  if (!outline || outline.length < 3) return
  polygon(ctx, outline)
  paint()
}

/** A dashed outline with diagonal hatch lines inside it, under the copper. */
function drawKeepouts(ctx: Ctx, layout: PcbLayout, px: number, hair: number): void {
  const keepouts = layout.board?.keepouts ?? []
  if (keepouts.length === 0) return
  ctx.strokeStyle = PALETTE.keepout
  ctx.globalAlpha = KEEPOUT_ALPHA
  for (const keepout of keepouts) {
    ctx.lineWidth = hair
    ctx.setLineDash([4 * px, 3 * px])
    polygon(ctx, keepout.outline)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.save()
    polygon(ctx, keepout.outline)
    ctx.clip()
    for (const [a, b] of hatchLines(keepout.outline)) drawLine(ctx, a, b)
    ctx.restore()
  }
  ctx.globalAlpha = 1
}

/**
 * 45 degree lines KEEPOUT_HATCH_MM apart that cover the polygon's bounding box. A box too big for
 * MAX_HATCH_LINES at that spacing gets them further apart; a box that is not finite gets none.
 */
export function hatchLines(outline: readonly Point[]): Array<[Point, Point]> {
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return []
  const height = maxY - minY
  const start = minX - height
  const span = maxX - start
  const step = Math.max(KEEPOUT_HATCH_MM, span / (MAX_HATCH_LINES - 1))
  const count = Math.floor(span / step + HATCH_SLACK) + 1
  return Array.from({ length: count }, (_, i): [Point, Point] => {
    const x = start + i * step
    return [{ x, y: minY }, { x: x + height, y: maxY }]
  })
}

function padPath(ctx: Ctx, pad: WorldPad): void {
  framed(ctx, pad.x, pad.y, pad.rotation, () => {
    if (pad.shape === "circle") circle(ctx, 0, 0, pad.width / 2)
    else if (pad.shape === "oval") stadium(ctx, pad.width, pad.height)
    else roundRect(ctx, pad.width, pad.height, pad.shape === "roundrect" ? (pad.cornerRadius ?? DEFAULT_CORNER * Math.min(pad.width, pad.height)) : 0)
  })
}

function padColor(pad: WorldPad): string {
  if (pad.layers === "through") return PALETTE.multiLayer
  return pad.layers === "bottom" ? PALETTE.bottomCopper : PALETTE.topCopper
}

type Each = (paint: (part: PlacedFootprint) => void) => void

/** Bottom copper first, then top copper; through pads count as both. */
function drawCopper(ctx: Ctx, layers: LayerVisibility, highlight: PcbDrawOptions["highlight"], each: Each, px: number): void {
  const passes: Array<[boolean, (pad: WorldPad) => boolean]> = [
    [layers.bottom, (pad) => pad.layers === "bottom"],
    [layers.top, (pad) => pad.layers === "top"],
    [layers.multiLayer, (pad) => pad.layers === "through"],
  ]
  for (const [visible, wanted] of passes) {
    if (!visible) continue
    each((part) => {
      for (const pad of part.pads.filter(wanted)) {
        const lit = highlight !== undefined && pad.net !== undefined && highlight.nets.includes(pad.net)
        ctx.globalAlpha = (highlight && !lit ? PCB_DIM : 1) * alphaOf(part)
        ctx.fillStyle = padColor(pad)
        padPath(ctx, pad)
        ctx.fill()
        if (lit) lightPad(ctx, pad, px, alphaOf(part))
      }
    })
  }
  ctx.globalAlpha = 1
}

/** A lit pad keeps its layer colour and gains a light white wash and a white outline. */
function lightPad(ctx: Ctx, pad: WorldPad, px: number, alpha: number): void {
  ctx.globalAlpha = LIT_WASH_ALPHA * alpha
  ctx.fillStyle = PALETTE.highlight
  padPath(ctx, pad)
  ctx.fill()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = PALETTE.highlight
  ctx.lineWidth = LIT_OUTLINE_PX * px
  ctx.stroke()
}

function drawDrills(ctx: Ctx, each: Each): void {
  ctx.fillStyle = PALETTE.drill
  each((part) => {
    for (const pad of part.pads) {
      const { drill } = pad
      if (!drill) continue
      if (drill.width === drill.height) circle(ctx, pad.x, pad.y, drill.width / 2)
      else framed(ctx, pad.x, pad.y, pad.rotation, () => stadium(ctx, drill.width, drill.height))
      ctx.fill()
    }
  })
}

function drawPolylines(ctx: Ctx, lines: readonly (readonly Point[])[], color: string, width: number, closed: boolean): void {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  for (const line of lines) {
    if (line.length < 2) continue
    ctx.beginPath()
    line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    if (closed) ctx.closePath()
    ctx.stroke()
  }
}

/** Every courtyard, dashed; an auto-placed part's is a little thicker. */
function drawCourtyards(ctx: Ctx, each: Each, px: number, hair: number): void {
  ctx.setLineDash([4 * px, 3 * px])
  each((part) => {
    ctx.globalAlpha = 1
    drawPolylines(ctx, [part.courtyard], assemblyColor(part), part.autoPlaced ? AUTO_COURTYARD_PX * px : hair, true)
  })
  ctx.setLineDash([])
}

function drawRatsnest(ctx: Ctx, layout: PcbLayout, options: PcbDrawOptions, hair: number): void {
  const moving = options.moving
  const movingPads = new Set(layout.parts.filter((p) => moving?.components.includes(p.component)).flatMap((p) => p.pads.map((pad) => pad.id)))
  const end = (point: Point, pad: string) => (moving && movingPads.has(pad) ? { x: point.x + moving.by.x, y: point.y + moving.by.y } : point)
  ctx.lineWidth = hair
  for (const line of layout.ratsnest) {
    const lit = options.highlight?.nets.includes(line.net) ?? false
    ctx.strokeStyle = lit ? PALETTE.highlight : PALETTE.ratsnest
    ctx.globalAlpha = lit ? 1 : options.highlight ? RATSNEST_ALPHA * PCB_DIM : RATSNEST_ALPHA
    drawLine(ctx, end(line.a, line.from), end(line.b, line.to))
  }
  ctx.globalAlpha = 1
}

function drawLine(ctx: Ctx, a: Point, b: Point): void {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
}

/**
 * The component id as the silkscreen carries it: the same strokes, height and line width the fabrication export writes
 * (designators.ts, stroke-font.ts), where it puts them or where pcbNameAt does, turned to read from the bottom up when
 * its turn is 90, mirrored on the bottom side. Drawn in world units, under the canvas's world transform.
 */
function drawDesignator(ctx: Ctx, part: PlacedFootprint, hair: number): void {
  const strokes = textStrokes(part.component, designatorAnchor(part), DESIGNATOR_HEIGHT, part.side === "bottom", designatorTurn(part) === 90)
  const colour = part.side === "top" ? PALETTE.topSilk : PALETTE.bottomSilk
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  ctx.lineWidth = Math.max(SILK_WIDTH, hair)
  for (const line of strokes) strokeLine(ctx, line)
}

/**
 * The pad within `reach` mm of a point (the nearest; one under the point counts as 0 mm away): the track tool reaches
 * a pad as it reaches a track, so a click just off a small pad's edge still starts or ends on it. With `visible`,
 * pads on hidden layers are skipped.
 */
export function padNear(layout: PcbLayout, p: Point, reach: number, visible?: LayerVisibility): WorldPad | undefined {
  let best: { pad: WorldPad; distance: number } | undefined
  for (const part of layout.parts) {
    for (const pad of part.pads) {
      if (visible && !visible[padLayer(pad)]) continue
      const distance = padDistance(pad, p)
      if (distance <= reach && (!best || distance < best.distance)) best = { pad, distance }
    }
  }
  return best?.pad
}

const insidePad = (pad: WorldPad, p: Point): boolean => padDistance(pad, p) <= 0

/** The point in the pad's own frame: from its centre, turned back by its rotation. */
function padFrame(pad: WorldPad, p: Point): Point {
  const turn = rad(-pad.rotation)
  const dx = p.x - pad.x
  const dy = p.y - pad.y
  return { x: dx * Math.cos(turn) - dy * Math.sin(turn), y: dx * Math.sin(turn) + dy * Math.cos(turn) }
}

/** How far outside the pad's copper the point is; 0 on or inside it. */
export function padDistance(pad: WorldPad, p: Point): number {
  const { x, y } = padFrame(pad, p)
  if (pad.shape === "circle") return Math.max(0, Math.hypot(x, y) - pad.width / 2)
  if (pad.shape === "oval") return stadiumDistance(x, y, pad.width, pad.height)
  return Math.hypot(Math.max(0, Math.abs(x) - pad.width / 2), Math.max(0, Math.abs(y) - pad.height / 2))
}

/** The distance to the stadium's centre segment, less its radius; 0 inside. */
function stadiumDistance(x: number, y: number, w: number, h: number): number {
  const radius = Math.min(w, h) / 2
  const reach = Math.max(w, h) / 2 - radius
  const [ax, ay] = w >= h ? [Math.max(-reach, Math.min(reach, x)), 0] : [0, Math.max(-reach, Math.min(reach, y))]
  return Math.max(0, Math.hypot(x - ax, y - ay) - radius)
}
