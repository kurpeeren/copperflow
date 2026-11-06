// copperflow's PCB renderer: draws the engine's board layout onto a 2D canvas in layer order.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { PcbLayout, PlacedFootprint, WorldPad } from "../../../src/engine/pcb.js"
import { HIGHLIGHT_DIM, PALETTE, type Ctx, type Layers } from "./ctx.js"
import { worldToScreen, type Camera, type PartBox, type Point, type Size } from "./geometry.js"

export interface PcbDrawOptions {
  /** Device pixels per CSS pixel. */
  ratio: number
  layers?: Partial<Layers>
  /** One net to highlight; other copper is dimmed. */
  highlight?: { net: string }
  /** The part being dragged and how far it has moved, in mm. */
  moving?: { component: string; by: Point }
  /** Defaults to true. */
  ratsnest?: boolean
}

type View = { camera: Camera; size: Size }

const DEFAULT_LAYERS: Layers = { topCopper: true, bottomCopper: true, silkscreen: true, courtyard: true, fabrication: false }
const NO_SHIFT: Point = { x: 0, y: 0 }
const MIN_TEXT_PX = 3
const DIM = HIGHLIGHT_DIM
const RATSNEST_ALPHA = 0.6
const SILK_WIDTH_MM = 0.12
const BOARD_EDGE_PX = 1.5
const DEFAULT_CORNER = 0.25
const DESIGNATOR_MM = 0.8
const DESIGNATOR_GAP_PX = 2
/** Parts the engine placed for itself are drawn faded, so the person sees they have no position yet. */
const AUTO_PLACED_ALPHA = 0.6

const rad = (degrees: number) => (degrees * Math.PI) / 180
const alphaOf = (part: PlacedFootprint) => (part.autoPlaced ? AUTO_PLACED_ALPHA : 1)

/** Draws the board, then the ratsnest. Auto-placed parts are faded and always show their dashed courtyard. */
export function drawPcb(ctx: Ctx, layout: PcbLayout, view: View, options: PcbDrawOptions): void {
  const layers = { ...DEFAULT_LAYERS, ...options.layers }
  const { camera, size } = view
  const px = 1 / camera.scale
  const shiftOf = (part: PlacedFootprint) => (options.moving?.component === part.component ? options.moving.by : NO_SHIFT)
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
  drawBoard(ctx, layout, () => {
    ctx.fillStyle = PALETTE.board
    ctx.fill()
  })
  drawCopper(ctx, layers, options.highlight, each)
  drawDrills(ctx, each)
  if (layers.silkscreen) each((part) => drawPolylines(ctx, part.silkscreen, part.side === "top" ? PALETTE.topSilk : PALETTE.bottomSilk, SILK_WIDTH_MM, false))
  drawCourtyards(ctx, each, px, layers.courtyard)
  if (layers.fabrication) each((part) => drawPolylines(ctx, part.fabrication, PALETTE.fabrication, px, false))
  drawBoard(ctx, layout, () => {
    ctx.strokeStyle = PALETTE.boardEdge
    ctx.lineWidth = BOARD_EDGE_PX * px
    ctx.stroke()
  })
  if (options.ratsnest !== false) drawRatsnest(ctx, layout, options, px)

  // Text is drawn in screen space so it stays upright and readable at any zoom.
  ctx.setTransform(options.ratio, 0, 0, options.ratio, 0, 0)
  if (layers.silkscreen) for (const part of layout.parts) drawDesignator(ctx, part, camera, size, shiftOf(part))
  ctx.restore()
}

/** The pad under a point, or undefined. Pads of the same part are tried in order. */
export function padAt(layout: PcbLayout, p: Point): WorldPad | undefined {
  for (const part of layout.parts) {
    const hit = part.pads.find((pad) => insidePad(pad, p))
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

function padPath(ctx: Ctx, pad: WorldPad): void {
  framed(ctx, pad.x, pad.y, pad.rotation, () => {
    if (pad.shape === "circle") circle(ctx, 0, 0, pad.width / 2)
    else if (pad.shape === "oval") stadium(ctx, pad.width, pad.height)
    else roundRect(ctx, pad.width, pad.height, pad.shape === "roundrect" ? (pad.cornerRadius ?? DEFAULT_CORNER * Math.min(pad.width, pad.height)) : 0)
  })
}

function padColor(pad: WorldPad, lit: boolean): string {
  if (lit) return PALETTE.highlight
  return pad.layers === "bottom" ? PALETTE.bottomCopper : PALETTE.topCopper
}

type Each = (paint: (part: PlacedFootprint) => void) => void

/** Bottom copper first, then top copper; through pads count as both. */
function drawCopper(ctx: Ctx, layers: Layers, highlight: PcbDrawOptions["highlight"], each: Each): void {
  const passes: Array<[boolean, (pad: WorldPad) => boolean]> = [
    [layers.bottomCopper, (pad) => pad.layers === "bottom"],
    [layers.topCopper, (pad) => pad.layers === "top"],
    [layers.topCopper || layers.bottomCopper, (pad) => pad.layers === "through"],
  ]
  for (const [visible, wanted] of passes) {
    if (!visible) continue
    each((part) => {
      for (const pad of part.pads.filter(wanted)) {
        const lit = highlight !== undefined && pad.net === highlight.net
        ctx.globalAlpha = (highlight && !lit ? DIM : 1) * alphaOf(part)
        ctx.fillStyle = padColor(pad, lit)
        padPath(ctx, pad)
        ctx.fill()
      }
    })
  }
  ctx.globalAlpha = 1
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

/** Every courtyard when the layer is shown; an auto-placed part's courtyard always. */
function drawCourtyards(ctx: Ctx, each: Each, px: number, all: boolean): void {
  ctx.setLineDash([4 * px, 3 * px])
  each((part) => {
    if (all || part.autoPlaced) drawPolylines(ctx, [part.courtyard], PALETTE.courtyard, px, true)
  })
  ctx.setLineDash([])
}

function drawRatsnest(ctx: Ctx, layout: PcbLayout, options: PcbDrawOptions, px: number): void {
  const moving = options.moving
  const movingPads = new Set(layout.parts.filter((p) => p.component === moving?.component).flatMap((p) => p.pads.map((pad) => pad.id)))
  const end = (point: Point, pad: string) => (moving && movingPads.has(pad) ? { x: point.x + moving.by.x, y: point.y + moving.by.y } : point)
  ctx.strokeStyle = PALETTE.ratsnest
  ctx.lineWidth = px
  for (const line of layout.ratsnest) {
    ctx.globalAlpha = options.highlight && options.highlight.net !== line.net ? RATSNEST_ALPHA * DIM : RATSNEST_ALPHA
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

/** The component id as silkscreen text, centred above the courtyard's top edge. */
function drawDesignator(ctx: Ctx, part: PlacedFootprint, camera: Camera, size: Size, shift: Point): void {
  const fontPx = DESIGNATOR_MM * camera.scale
  if (fontPx < MIN_TEXT_PX) return
  const box = courtyardBox(part)
  const p = worldToScreen(camera, size, { x: (box.minX + box.maxX) / 2 + shift.x, y: box.maxY + shift.y })
  ctx.fillStyle = PALETTE.topSilk
  ctx.globalAlpha = alphaOf(part)
  ctx.font = `600 ${fontPx}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "bottom"
  ctx.fillText(part.component, p.x, p.y - DESIGNATOR_GAP_PX)
  ctx.globalAlpha = 1
}

function insidePad(pad: WorldPad, p: Point): boolean {
  const turn = rad(-pad.rotation)
  const dx = p.x - pad.x
  const dy = p.y - pad.y
  const x = dx * Math.cos(turn) - dy * Math.sin(turn)
  const y = dx * Math.sin(turn) + dy * Math.cos(turn)
  if (pad.shape === "circle") return Math.hypot(x, y) <= pad.width / 2
  if (pad.shape === "oval") return insideStadium(x, y, pad.width, pad.height)
  return Math.abs(x) <= pad.width / 2 && Math.abs(y) <= pad.height / 2
}

/** The distance to the stadium's centre segment is at most its radius. */
function insideStadium(x: number, y: number, w: number, h: number): boolean {
  const radius = Math.min(w, h) / 2
  const reach = Math.max(w, h) / 2 - radius
  const [ax, ay] = w >= h ? [Math.max(-reach, Math.min(reach, x)), 0] : [0, Math.max(-reach, Math.min(reach, y))]
  return Math.hypot(x - ax, y - ay) <= radius
}
