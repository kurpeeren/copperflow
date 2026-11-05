// copperflow's PCB renderer: draws circuit JSON onto a 2D canvas in layer order.
import { worldToScreen, type Camera, type Point, type Size } from "./geometry.js"
import { anchorAlignment, PALETTE, type Ctx, type Layers } from "./ctx.js"
import type { Nets } from "./nets.js"

export { anchorAlignment, PALETTE, type Ctx, type Layers }

interface Element {
  type: string
  [key: string]: unknown
}

export interface DrawOptions {
  /** Device pixels per CSS pixel. */
  ratio: number
  layers?: Partial<Layers>
  /** One net to highlight; other copper is dimmed. */
  highlight?: { net: string; nets: Nets }
  /** Shifts everything drawn, for the part being dragged. */
  offset?: Point
  /** Called after the board is filled and before copper, e.g. to draw unsupported elements. */
  underCopper?: () => void
}

export const SUPPORTED_TYPES = new Set([
  "pcb_board",
  "pcb_smtpad",
  "pcb_plated_hole",
  "pcb_hole",
  "pcb_via",
  "pcb_trace",
  "pcb_silkscreen_path",
  "pcb_silkscreen_line",
  "pcb_silkscreen_rect",
  "pcb_silkscreen_circle",
  "pcb_silkscreen_text",
  "pcb_courtyard_rect",
  "pcb_courtyard_outline",
  "pcb_courtyard_circle",
  "pcb_fabrication_note_path",
  "pcb_fabrication_note_text",
])

/** Elements that are data, not drawing, or that copperflow deliberately leaves out. */
const IGNORED = /^(pcb_component|pcb_port|pcb_solder_paste|pcb_group|pcb_trace_hint|pcb_breakout_point|pcb_debug_object|pcb_fabrication_note_rect|pcb_fabrication_note_dimension)$|_error$|_warning$/
const MIN_TEXT_PX = 3
const DIM = 0.3

const DEFAULT_LAYERS: Layers = { topCopper: true, bottomCopper: true, silkscreen: true, courtyard: true, fabrication: false }

/** Draws the board and returns the drawable element types it does not support yet. */
export function drawPcb(ctx: Ctx, elements: Element[], view: { camera: Camera; size: Size }, options: DrawOptions): { unsupported: string[] } {
  const layers = { ...DEFAULT_LAYERS, ...options.layers }
  const { camera, size } = view
  const offset = options.offset ?? { x: 0, y: 0 }
  const s = camera.scale * options.ratio
  const world = () =>
    ctx.setTransform(
      s,
      0,
      0,
      -s,
      (size.width / 2 - (camera.cx - offset.x) * camera.scale) * options.ratio,
      (size.height / 2 + (camera.cy - offset.y) * camera.scale) * options.ratio,
    )
  const px = 1 / camera.scale
  const byType = (type: string) => elements.filter((e) => e.type === type)
  const copperColor = (layer: string, lit: boolean) => (lit ? PALETTE.highlight : layer === "bottom" ? PALETTE.bottomCopper : PALETTE.topCopper)
  const portLit = (e: Element) => (options.highlight && typeof e.pcb_port_id === "string" ? options.highlight.nets.ofPort(e.pcb_port_id) === options.highlight.net : false)
  const traceLit = (e: Element) => (options.highlight && typeof e.pcb_trace_id === "string" ? options.highlight.nets.ofTrace(e.pcb_trace_id) === options.highlight.net : false)
  const alphaFor = (lit: boolean) => (options.highlight && !lit ? DIM : 1)

  ctx.save()
  world()
  ctx.lineCap = "round"
  ctx.lineJoin = "round"

  for (const board of byType("pcb_board")) boardShape(ctx, board, () => {
    ctx.fillStyle = PALETTE.board
    ctx.fill()
  })
  if (options.underCopper) {
    ctx.save()
    options.underCopper()
    ctx.restore()
    world()
  }

  for (const layer of ["bottom", "top"] as const) {
    if (!(layer === "top" ? layers.topCopper : layers.bottomCopper)) continue
    for (const trace of byType("pcb_trace")) {
      const lit = traceLit(trace)
      ctx.globalAlpha = alphaFor(lit)
      drawTrace(ctx, trace, layer, copperColor(layer, lit))
    }
    for (const pad of byType("pcb_smtpad").filter((e) => e.layer === layer)) {
      const lit = portLit(pad)
      ctx.globalAlpha = alphaFor(lit)
      ctx.fillStyle = copperColor(layer, lit)
      padShape(ctx, pad)
      ctx.fill()
    }
  }
  if (layers.topCopper || layers.bottomCopper) {
    for (const hole of byType("pcb_plated_hole")) {
      const lit = portLit(hole)
      ctx.globalAlpha = alphaFor(lit)
      ctx.fillStyle = copperColor(layers.topCopper ? "top" : "bottom", lit)
      platedHoleCopper(ctx, hole)
    }
    for (const via of byType("pcb_via")) {
      ctx.globalAlpha = alphaFor(false)
      ctx.fillStyle = PALETTE.viaRing
      circle(ctx, num(via, "x"), num(via, "y"), num(via, "outer_diameter") / 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = PALETTE.drill
  for (const hole of byType("pcb_plated_hole")) platedHoleDrill(ctx, hole)
  for (const hole of byType("pcb_hole")) {
    holeShape(ctx, hole)
    ctx.fill()
  }
  for (const via of byType("pcb_via")) {
    circle(ctx, num(via, "x"), num(via, "y"), num(via, "hole_diameter") / 2)
    ctx.fill()
  }

  if (layers.silkscreen) {
    for (const layer of ["bottom", "top"] as const) {
      const color = layer === "top" ? PALETTE.topSilk : PALETTE.bottomSilk
      ctx.strokeStyle = color
      ctx.fillStyle = color
      for (const e of elements.filter((x) => x.type.startsWith("pcb_silkscreen_") && x.layer === layer)) {
        if (e.type === "pcb_silkscreen_text") continue
        silkscreen(ctx, e)
      }
    }
  }

  if (layers.courtyard) {
    ctx.strokeStyle = PALETTE.courtyard
    ctx.lineWidth = px
    ctx.setLineDash([4 * px, 3 * px])
    for (const e of elements.filter((x) => x.type.startsWith("pcb_courtyard_"))) {
      courtyard(ctx, e)
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  if (layers.fabrication) {
    ctx.strokeStyle = PALETTE.fabrication
    for (const e of byType("pcb_fabrication_note_path")) path(ctx, e.route as Point[], num(e, "stroke_width") || px)
  }

  for (const board of byType("pcb_board")) boardShape(ctx, board, () => {
    ctx.strokeStyle = PALETTE.boardEdge
    ctx.lineWidth = 1.5 * px
    ctx.stroke()
  })

  // Text is drawn in screen space so it stays upright and readable at any zoom.
  ctx.setTransform(options.ratio, 0, 0, options.ratio, 0, 0)
  const texts = [
    ...(layers.silkscreen ? byType("pcb_silkscreen_text") : []),
    ...(layers.fabrication ? byType("pcb_fabrication_note_text") : []),
  ]
  for (const e of texts) {
    const color = e.type === "pcb_fabrication_note_text" ? PALETTE.fabrication : e.layer === "bottom" ? PALETTE.bottomSilk : PALETTE.topSilk
    text(ctx, e, camera, size, offset, color)
  }
  ctx.restore()

  const unsupported = new Set<string>()
  for (const e of elements) {
    if (e.type.startsWith("pcb_") && !SUPPORTED_TYPES.has(e.type) && !IGNORED.test(e.type)) unsupported.add(e.type)
  }
  return { unsupported: [...unsupported].sort() }
}

/** Whether the renderer can draw this element itself; the rest goes to the fallback drawer. */
export function isSupported(e: Element): boolean {
  return SUPPORTED_TYPES.has(e.type) || IGNORED.test(e.type) || !e.type.startsWith("pcb_")
}

function num(e: Element, key: string): number {
  return typeof e[key] === "number" ? (e[key] as number) : 0
}

function rad(degrees: number): number {
  return (degrees * Math.PI) / 180
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

/** Runs `shape` in a frame centred at (x, y) and turned counter-clockwise by `degrees`. */
function framed(ctx: Ctx, x: number, y: number, degrees: number, shape: () => void): void {
  ctx.save()
  ctx.translate(x, y)
  if (degrees) ctx.rotate(rad(degrees))
  shape()
  ctx.restore()
}

function polygon(ctx: Ctx, points: Point[]): void {
  ctx.beginPath()
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.closePath()
}

function path(ctx: Ctx, route: Point[] | undefined, width: number): void {
  if (!route || route.length < 2) return
  ctx.lineWidth = width
  ctx.beginPath()
  route.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()
}

function boardShape(ctx: Ctx, board: Element, paint: () => void): void {
  if (Array.isArray(board.outline) && board.outline.length > 2) {
    polygon(ctx, board.outline as Point[])
    paint()
    return
  }
  const center = (board.center as Point | undefined) ?? { x: 0, y: 0 }
  framed(ctx, center.x, center.y, 0, () => {
    roundRect(ctx, num(board, "width"), num(board, "height"), 0)
    paint()
  })
}

function padShape(ctx: Ctx, pad: Element): void {
  const x = num(pad, "x")
  const y = num(pad, "y")
  switch (pad.shape) {
    case "circle":
      circle(ctx, x, y, num(pad, "radius"))
      return
    case "polygon":
      polygon(ctx, (pad.points as Point[] | undefined) ?? [])
      return
    case "pill":
    case "rotated_pill":
      framed(ctx, x, y, num(pad, "ccw_rotation"), () => roundRect(ctx, num(pad, "width"), num(pad, "height"), num(pad, "radius")))
      return
    default: {
      const radius = num(pad, "corner_radius") || num(pad, "rect_border_radius")
      framed(ctx, x, y, num(pad, "ccw_rotation"), () => roundRect(ctx, num(pad, "width"), num(pad, "height"), radius))
    }
  }
}

function pill(ctx: Ctx, w: number, h: number): void {
  roundRect(ctx, w, h, Math.min(w, h) / 2)
}

function platedHoleCopper(ctx: Ctx, hole: Element): void {
  const x = num(hole, "x")
  const y = num(hole, "y")
  switch (hole.shape) {
    case "circle":
      circle(ctx, x, y, num(hole, "outer_diameter") / 2)
      ctx.fill()
      return
    case "oval":
    case "pill":
      framed(ctx, x, y, num(hole, "ccw_rotation"), () => pill(ctx, num(hole, "outer_width"), num(hole, "outer_height")))
      ctx.fill()
      return
    default:
      if (typeof hole.rect_pad_width === "number") {
        framed(ctx, x, y, num(hole, "rect_ccw_rotation"), () =>
          roundRect(ctx, num(hole, "rect_pad_width"), num(hole, "rect_pad_height"), num(hole, "rect_border_radius")),
        )
        ctx.fill()
      }
  }
}

function platedHoleDrill(ctx: Ctx, hole: Element): void {
  const x = num(hole, "x") + num(hole, "hole_offset_x")
  const y = num(hole, "y") + num(hole, "hole_offset_y")
  if (typeof hole.hole_width === "number") {
    framed(ctx, x, y, num(hole, "hole_ccw_rotation") || num(hole, "ccw_rotation"), () => pill(ctx, num(hole, "hole_width"), num(hole, "hole_height")))
  } else {
    circle(ctx, x, y, num(hole, "hole_diameter") / 2)
  }
  ctx.fill()
}

function holeShape(ctx: Ctx, hole: Element): void {
  const x = num(hole, "x")
  const y = num(hole, "y")
  if (typeof hole.hole_width === "number") {
    const square = hole.hole_shape === "rect" || hole.hole_shape === "square"
    framed(ctx, x, y, num(hole, "ccw_rotation"), () =>
      square ? roundRect(ctx, num(hole, "hole_width"), num(hole, "hole_height"), 0) : pill(ctx, num(hole, "hole_width"), num(hole, "hole_height")),
    )
  } else {
    circle(ctx, x, y, num(hole, "hole_diameter") / 2)
  }
}

function drawTrace(ctx: Ctx, trace: Element, layer: string, color: string): void {
  const route = (trace.route as Array<Record<string, unknown>> | undefined) ?? []
  ctx.strokeStyle = color
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as Record<string, unknown>
    const b = route[i] as Record<string, unknown>
    if (a.route_type !== "wire" || b.route_type !== "wire" || a.layer !== layer || b.layer !== layer) continue
    ctx.lineWidth = Math.max(Number(a.width) || 0, Number(b.width) || 0, 0.05)
    ctx.beginPath()
    ctx.moveTo(Number(a.x), Number(a.y))
    ctx.lineTo(Number(b.x), Number(b.y))
    ctx.stroke()
  }
  if (layer !== "top") return
  for (const point of route.filter((p) => p.route_type === "via")) {
    const outer = Number(point.outer_diameter) || 0.6
    const hole = Number(point.hole_diameter) || 0.3
    ctx.fillStyle = PALETTE.viaRing
    circle(ctx, Number(point.x), Number(point.y), outer / 2)
    ctx.fill()
    ctx.fillStyle = PALETTE.drill
    circle(ctx, Number(point.x), Number(point.y), hole / 2)
    ctx.fill()
  }
}

function silkscreen(ctx: Ctx, e: Element): void {
  const width = num(e, "stroke_width") || 0.1
  switch (e.type) {
    case "pcb_silkscreen_path":
      path(ctx, e.route as Point[], width)
      return
    case "pcb_silkscreen_line":
      path(ctx, [{ x: num(e, "x1"), y: num(e, "y1") }, { x: num(e, "x2"), y: num(e, "y2") }], width)
      return
    case "pcb_silkscreen_rect": {
      const center = (e.center as Point | undefined) ?? { x: 0, y: 0 }
      framed(ctx, center.x, center.y, num(e, "ccw_rotation"), () => roundRect(ctx, num(e, "width"), num(e, "height"), num(e, "corner_radius")))
      if (e.is_filled) ctx.fill()
      if (e.has_stroke !== false) {
        ctx.lineWidth = width
        ctx.stroke()
      }
      return
    }
    case "pcb_silkscreen_circle": {
      const center = (e.center as Point | undefined) ?? { x: 0, y: 0 }
      circle(ctx, center.x, center.y, num(e, "radius"))
      if (e.is_filled) ctx.fill()
      ctx.lineWidth = width
      ctx.stroke()
    }
  }
}

function courtyard(ctx: Ctx, e: Element): void {
  if (e.type === "pcb_courtyard_outline") return polygon(ctx, (e.outline as Point[] | undefined) ?? [])
  const center = (e.center as Point | undefined) ?? { x: 0, y: 0 }
  if (e.type === "pcb_courtyard_circle") return circle(ctx, center.x, center.y, num(e, "radius"))
  framed(ctx, center.x, center.y, num(e, "ccw_rotation"), () => roundRect(ctx, num(e, "width"), num(e, "height"), 0))
}

/** Text at its anchor, in screen space: upright, aligned, rotated, mirrored on the bottom layer. */
function text(ctx: Ctx, e: Element, camera: Camera, size: Size, offset: Point, color: string): void {
  const fontPx = num(e, "font_size") * camera.scale
  const content = typeof e.text === "string" ? e.text : ""
  if (fontPx < MIN_TEXT_PX || content === "") return
  const anchor = (e.anchor_position as Point | undefined) ?? { x: 0, y: 0 }
  const p = worldToScreen(camera, size, { x: anchor.x + offset.x, y: anchor.y + offset.y })
  const [vertical, horizontal] = anchorAlignment(String(e.anchor_alignment ?? "center"))
  ctx.save()
  ctx.translate(p.x, p.y)
  if (num(e, "ccw_rotation")) ctx.rotate(-rad(num(e, "ccw_rotation")))
  if (e.layer === "bottom" || e.is_mirrored) ctx.scale(-1, 1)
  ctx.fillStyle = color
  ctx.font = `600 ${fontPx}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`
  ctx.textAlign = horizontal
  ctx.textBaseline = vertical
  ctx.fillText(content, 0, 0)
  ctx.restore()
}
