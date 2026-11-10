// copperflow's schematic renderer: draws the engine's sheet layout (symbols, wires, junctions, labels) onto a 2D canvas.
// Only the symbol library comes from the engine at run time: its other modules reach Node-only code the Studio bundle cannot hold.
import type { SchematicDrawing } from "../../../src/engine/model.js"
import type { PlacedSymbol, SchematicLayout, NetLabel } from "../../../src/engine/schematic.js"
import { groundSymbol, powerSymbol, type SchSymbol, type Shape } from "../../../src/engine/symbols/index.js"
import { boundsOf } from "../../../src/engine/symbols/types.js"
import { HIGHLIGHT_DIM, type Ctx } from "./ctx.js"
import { labelTag, NET_LABEL_TEXT } from "./label-tag.js"
import { type Box, type Camera, type PartBox, type Point, type Size } from "./geometry.js"
import { drawViolationMarkers, type ViolationMarker } from "./markers.js"
import { schematicTheme as theme } from "./schematic-theme.js"
import { WIRE_WIDTH } from "./drawing-style.js"
import { drawDrawings, drawDrawingTexts, shownDrawings, type DrawingPaint } from "./drawing-draw.js"
import { drawSheetTexts, type SheetText } from "./schematic-text.js"
import type { TextKind } from "./text-level.js"

export interface SchematicDrawOptions {
  /** Device pixels per CSS pixel. */
  ratio: number
  /** Marks every pin, for wiring. */
  showPins?: boolean
  /** Pin ids to emphasise, e.g. the start of a wire being drawn and the pin under the pointer. */
  activePins?: readonly string[]
  /** The parts being dragged and how far they have moved, in sheet units. */
  moving?: { components: readonly string[]; by: Point }
  /** Wires waiting for their build, drawn dashed. */
  pending?: readonly (readonly Point[])[]
  /** A net label or ground or power symbol drawn dashed at `at`, in place of where the layout has it; `hideWire` is the wire it replaces. */
  movingLabels?: readonly { id: string; at: Point; side: NetLabel["side"]; hideWire?: string }[]
  /** The selected wires' ids: they are drawn in the selection colour, over a highlight. */
  selectedWires?: readonly string[]
  /** The selected net labels' and flags' ids: drawn in the selection colour too. */
  selectedLabels?: readonly string[]
  /** The selected drawings' ids: drawn in the selection colour too. */
  selectedDrawings?: readonly string[]
  /** Drawings a move takes, drawn where it puts them in place of where the layout has them. */
  movingDrawings?: readonly SchematicDrawing[]
  /** Drawings not in the layout: the one a drawing tool is drawing and those sent and waiting for their build. */
  pendingDrawings?: readonly SchematicDrawing[]
  /** One net to highlight, as on the PCB: its wires and labels are lit, everything else is dimmed. `pins` are the pins on it: they are marked, and their symbols are not dimmed. */
  highlight?: { net: string; pins?: readonly string[]; aliases?: readonly string[] }
  /** Labels sent and waiting for their build, drawn dashed where they will be. */
  ghostLabels?: readonly NetLabel[]
  /** Violations with a position, ringed above everything else. */
  violations?: readonly ViolationMarker[]
  /** The violation picked in the DRC tab, whose ring is thicker. */
  activeViolation?: string
}

type View = { camera: Camera; size: Size }
type Role = Extract<Shape, { type: "text" }>["role"]

interface Frame {
  x: number
  y: number
  rotation: number
}

type Label = SheetText

const NO_SHIFT: Point = { x: 0, y: 0 }
const SYMBOL_WIDTH = 0.02
const MIN_LINE_PX = 1.2
const PIN_DOT_PX = 3.5
/** A highlighted pin's marker is this big in sheet units, but never under 1.5 px or over a pin dot, so it stays smaller than a symbol at any zoom. */
const LIT_PIN_WORLD = 0.06
const LIT_PIN_MIN_PX = 1.5
const ACTIVE_PIN_FACTOR = 1.6
const MIN_JUNCTION = 0.04
const JUNCTION_PX = 3
const DASH: number[] = [0.1, 0.06]
const NUMBER_INSET = 0.1
const NUMBER_RISE = 0.07
/** A two-pin part's designator and value are at most this many symbol lengths wide. */
const TWO_PIN_TEXT_LENGTHS = 2.5
const TEXT_KINDS: Record<Role, TextKind> = { reference: "name", value: "detail", "pin-name": "detail", "pin-number": "pin-number" }
const TEXT_COLORS: Record<Role, string> = {
  reference: theme.designator,
  value: theme.value,
  "pin-name": theme.pinName,
  "pin-number": theme.pinNumber,
}
const OUTWARD: Record<NetLabel["side"], Point> = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, top: { x: 0, y: 1 }, bottom: { x: 0, y: -1 } }

const rad = (degrees: number) => (degrees * Math.PI) / 180

/** How wide the hit test counts a wire at this zoom (pixels per sheet unit), in CSS pixels: its width, never under 1.2. */
export const wireStrokePx = (scale: number): number => Math.max(WIRE_WIDTH * scale, MIN_LINE_PX)

/** How wide a wire is drawn, in CSS pixels: its width on the sheet, but never under one device pixel. */
export const wireDrawnPx = (scale: number, ratio: number): number => Math.max(WIRE_WIDTH * scale, 1 / ratio)

/** Draws wires and drawings, then symbols, labels and pins, then all text upright in screen space, then the violation rings. */
export function drawSchematic(ctx: Ctx, layout: SchematicLayout, view: View, options: SchematicDrawOptions): void {
  const { camera, size } = view
  const px = 1 / camera.scale
  /** Every stroke is its width on the sheet, never under one device pixel. */
  const line = (width: number) => Math.max(width, px / options.ratio)
  const texts: Label[] = []
  const shiftOf = (symbol: PlacedSymbol) => (options.moving?.components.includes(symbol.component) ? options.moving.by : NO_SHIFT)

  ctx.save()
  const s = camera.scale * options.ratio
  ctx.setTransform(s, 0, 0, -s, (size.width / 2 - camera.cx * camera.scale) * options.ratio, (size.height / 2 + camera.cy * camera.scale) * options.ratio)
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  drawWires(ctx, layout, options, px, line)
  const shown = shownDrawings(layout.drawings, options.movingDrawings)
  const pending = options.pendingDrawings ?? []
  const drawings = [...shown, ...pending]
  const paint: DrawingPaint = { ...(options.selectedDrawings ? { selected: options.selectedDrawings } : {}), dim: options.highlight !== undefined }
  drawDrawings(ctx, shown, px / options.ratio, paint)
  drawDrawings(ctx, pending, px / options.ratio, { pending: true, dim: paint.dim })
  for (const symbol of layout.symbols) drawSymbol(ctx, symbol, shiftOf(symbol), { line, px, fade: symbolFade(symbol, options.highlight) }, texts)
  for (const label of layout.labels) {
    const moving = options.movingLabels?.some((m) => m.id === label.id) ?? false
    const tone = options.selectedLabels?.includes(label.id) ? { color: theme.selection, alpha: 1 } : toneOf(label.net, options.highlight)
    drawLabel(ctx, movedLabel(label, options), line, texts, moving, tone)
  }
  for (const ghost of options.ghostLabels ?? []) drawLabel(ctx, ghost, line, texts, true, toneOf(ghost.net, undefined))
  drawPins(ctx, layout, options, px, shiftOf)

  // Text is drawn in screen space so it stays upright and readable at any zoom.
  ctx.setTransform(options.ratio, 0, 0, options.ratio, 0, 0)
  drawSheetTexts(ctx, texts, camera, size, options.ratio)
  drawDrawingTexts(ctx, drawings, camera, size, paint, options.ratio)
  drawViolationMarkers(ctx, view, options.violations ?? [], options.activeViolation, false)
  ctx.restore()
}

/**
 * One box per symbol, from its body and pins turned to the symbol's rotation; the id is the component. The part's name
 * and value are left out: they are picked on their own (part-text.ts), after the parts.
 */
export function sheetBoxes(layout: SchematicLayout): PartBox[] {
  return layout.symbols.map((placed) => {
    const box = symbolBox(placed)
    return { name: placed.component, pcbComponentId: placed.component, center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, box }
  })
}

const isPartText = (shape: Shape) => shape.type === "text" && (shape.role === "reference" || shape.role === "value")

/** The symbol's body and pins, without its name and value, turned to its rotation, on the sheet. */
function symbolBox(placed: PlacedSymbol): Box {
  const { minX, minY, maxX, maxY } = boundsOf(placed.symbol.shapes.filter((shape) => !isPartText(shape)), placed.symbol.pins)
  const corners = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ].map((corner) => place(corner, placed))
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/** A symbol-local point turned counter-clockwise by the frame's rotation, then moved to its origin. */
function place(p: Point, frame: Frame): Point {
  const angle = rad(frame.rotation)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: frame.x + p.x * cos - p.y * sin, y: frame.y + p.x * sin + p.y * cos }
}

function path(ctx: Ctx, points: readonly Point[]): void {
  ctx.beginPath()
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
}

function dot(ctx: Ctx, p: Point, r: number): void {
  ctx.beginPath()
  ctx.arc(p.x, p.y, Math.max(r, 0), 0, Math.PI * 2)
}

/** How a net's wires and labels are drawn: lit when it is the highlighted net, dimmed when another is, else as usual. */
function toneOf(net: string, highlight: SchematicDrawOptions["highlight"]): { color: string | undefined; alpha: number } {
  if (!highlight) return { color: undefined, alpha: 1 }
  return net === highlight.net || highlight.aliases?.includes(net) ? { color: theme.highlight, alpha: 1 } : { color: undefined, alpha: HIGHLIGHT_DIM }
}

/** A symbol is dimmed while a net is highlighted, unless one of its pins is on that net. */
function symbolFade(symbol: PlacedSymbol, highlight: SchematicDrawOptions["highlight"]): number {
  if (!highlight) return 1
  return highlight.pins?.some((pin) => pin in symbol.pinEnds) ? 1 : HIGHLIGHT_DIM
}

const EPSILON = 1e-9

function onSegment(p: Point, a: Point, b: Point): boolean {
  const straight = Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) < EPSILON
  const within = (v: number, lo: number, hi: number) => v >= Math.min(lo, hi) - EPSILON && v <= Math.max(lo, hi) + EPSILON
  return straight && within(p.x, a.x, b.x) && within(p.y, a.y, b.y)
}

/** A junction is lit when a wire of the highlighted net passes through it. */
function junctionLit(layout: SchematicLayout, junction: Point, highlight: NonNullable<SchematicDrawOptions["highlight"]>): boolean {
  return layout.wires.some((wire) => toneOf(wire.net, highlight).color !== undefined && wire.points.some((b, i) => i > 0 && onSegment(junction, wire.points[i - 1] ?? b, b)))
}

function drawWires(ctx: Ctx, layout: SchematicLayout, options: SchematicDrawOptions, px: number, line: (w: number) => number): void {
  ctx.lineWidth = line(WIRE_WIDTH)
  for (const wire of layout.wires) {
    if (options.movingLabels?.some((m) => m.hideWire === wire.id)) continue
    const tone = options.selectedWires?.includes(wire.id) ? { color: theme.selection, alpha: 1 } : toneOf(wire.net, options.highlight)
    ctx.strokeStyle = tone.color ?? theme.wire
    ctx.globalAlpha = tone.alpha
    path(ctx, wire.points)
    ctx.stroke()
  }
  for (const junction of layout.junctions) {
    const lit = options.highlight !== undefined && junctionLit(layout, junction, options.highlight)
    ctx.fillStyle = lit ? theme.highlight : theme.junction
    ctx.globalAlpha = options.highlight && !lit ? HIGHLIGHT_DIM : 1
    dot(ctx, junction, Math.max(MIN_JUNCTION, JUNCTION_PX * px))
    ctx.fill()
  }
  ctx.globalAlpha = 1
  ctx.strokeStyle = theme.wire
  const pending = (options.pending ?? []).filter((points) => points.length >= 2)
  if (pending.length === 0) return
  ctx.setLineDash(DASH)
  for (const points of pending) {
    path(ctx, points)
    ctx.stroke()
  }
  ctx.setLineDash([])
}

function drawSymbol(ctx: Ctx, placed: PlacedSymbol, shift: Point, pen: { line: (w: number) => number; px: number; fade: number }, texts: Label[]): void {
  const frame = { x: placed.x + shift.x, y: placed.y + shift.y, rotation: placed.rotation }
  // A part Studio placed is drawn as any other, as EasyEDA does; Properties and the Component tree say who placed it.
  const alpha = pen.fade
  const own: Label[] = []
  ctx.globalAlpha = alpha
  ctx.lineWidth = pen.line(SYMBOL_WIDTH)
  drawShapes(ctx, placed.symbol.shapes, frame, theme.symbolOutline, own)
  ctx.globalAlpha = 1
  if (!placed.symbol.shapes.some((shape) => shape.type === "text" && shape.role === "pin-number")) own.push(...pinNumbers(placed.symbol, frame))
  texts.push(...own.map((label) => ({ ...label, alpha, ...textBounds(label, placed) })))
}

/** A pin name's symbol (the names are fitted symbol by symbol); a two-pin part's designator and value, their widest (the symbol's length is from pin end to pin end). */
function textBounds(label: Label, placed: PlacedSymbol): Partial<Label> {
  if (label.pinOf) return { pinOf: { ...label.pinOf, symbol: placed.component } }
  if ((label.role !== "reference" && label.role !== "value") || placed.symbol.pins.length !== 2) return {}
  const [a, b] = placed.symbol.pins
  return a && b ? { maxWidth: TWO_PIN_TEXT_LENGTHS * Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y) } : {}
}


/** Numbers for symbols that do not draw their own: on the lead, just above it. */
function pinNumbers(symbol: SchSymbol, frame: Frame): Label[] {
  return symbol.pins.map((pin) => {
    const inward = OUTWARD[pin.side]
    const local = { x: pin.end.x - inward.x * NUMBER_INSET, y: pin.end.y - inward.y * NUMBER_INSET }
    const alongLead = inward.x !== 0
    const lifted = alongLead ? { x: local.x, y: local.y + NUMBER_RISE } : { x: local.x + NUMBER_RISE, y: local.y }
    return { text: String(pin.number), at: place(lifted, frame), size: 0.1, anchor: "center", color: theme.pinNumber, mono: true, kind: "pin-number" }
  })
}

/** Draws shapes given in a symbol's own coordinates through the frame; text is queued for the screen pass. */
function drawShapes(ctx: Ctx, shapes: readonly Shape[], frame: Frame, color: string, texts: Label[]): void {
  ctx.save()
  ctx.translate(frame.x, frame.y)
  if (frame.rotation) ctx.rotate(rad(frame.rotation))
  ctx.strokeStyle = color
  ctx.fillStyle = color
  for (const shape of shapes) {
    if (shape.type === "text") texts.push(textLabel(shape, frame, color))
    else paintShape(ctx, shape)
  }
  ctx.restore()
}

function paintShape(ctx: Ctx, shape: Exclude<Shape, { type: "text" }>): void {
  if (shape.type === "polyline") {
    path(ctx, shape.points)
    if (shape.closed || shape.fill) ctx.closePath()
    if (shape.fill) ctx.fill()
    ctx.stroke()
  } else if (shape.type === "circle") {
    dot(ctx, shape.center, shape.radius)
    if (shape.fill) ctx.fill()
    ctx.stroke()
  } else {
    const end = shape.end < shape.start ? shape.end + 360 : shape.end
    ctx.beginPath()
    ctx.arc(shape.center.x, shape.center.y, shape.radius, rad(shape.start), rad(end))
    ctx.stroke()
  }
}

/** Where a text shape lands on the sheet, and which side of that point the upright text extends to. */
function textLabel(shape: Extract<Shape, { type: "text" }>, frame: Frame, fallback: string): Label {
  const along = shape.anchor === "left" ? 1 : shape.anchor === "right" ? -1 : 0
  const angle = rad(frame.rotation)
  const dx = along * Math.cos(angle)
  const dy = along * Math.sin(angle)
  const anchor = Math.abs(dx) > 0.5 ? (dx > 0 ? "left" : "right") : Math.abs(dy) > 0.5 ? (dy > 0 ? "bottom" : "top") : "center"
  const role = { role: shape.role, kind: TEXT_KINDS[shape.role], ...(shape.role === "pin-name" ? { pinOf: pinFrame(shape, frame) } : {}), ...(shape.role === "reference" ? { strong: true } : {}), ...(shape.role === "pin-number" ? { mono: true } : {}) }
  return { text: shape.text, at: place(shape.at, frame), size: shape.size, anchor, color: TEXT_COLORS[shape.role] ?? fallback, ...role }
}

/** Where a pin name sits in its symbol's own frame: the side its anchor faces, and whether the symbol is turned a quarter. */
function pinFrame(shape: Extract<Shape, { type: "text" }>, frame: Frame): NonNullable<Label["pinOf"]> {
  const side = shape.anchor === "left" ? "left" : shape.anchor === "right" ? "right" : shape.at.y > 0 ? "top" : "bottom"
  return { symbol: "", local: shape.at, side, quarter: Math.abs(Math.sin(rad(frame.rotation))) > 0.5 }
}

/** The label where it is dragged to, or as the layout has it. */
function movedLabel(label: NetLabel, options: SchematicDrawOptions): NetLabel {
  const moving = options.movingLabels?.find((m) => m.id === label.id)
  return moving ? { ...label, at: moving.at, side: moving.side } : label
}

type Tone = ReturnType<typeof toneOf>

function drawLabel(ctx: Ctx, label: NetLabel, line: (w: number) => number, texts: Label[], moving: boolean, tone: Tone): void {
  ctx.setLineDash(moving ? DASH : [])
  ctx.globalAlpha = tone.alpha
  drawLabelShape(ctx, label, line, texts, tone)
  ctx.globalAlpha = 1
  ctx.setLineDash([])
}

function drawLabelShape(ctx: Ctx, label: NetLabel, line: (w: number) => number, texts: Label[], tone: Tone): void {
  if (label.style !== "label") {
    const shapes = label.style === "ground" ? groundSymbol() : powerSymbol(label.text)
    ctx.lineWidth = line(SYMBOL_WIDTH)
    const first = texts.length
    drawShapes(ctx, shapes, { x: label.at.x, y: label.at.y, rotation: 0 }, tone.color ?? theme.symbolOutline, texts)
    for (let i = first; i < texts.length; i++) texts[i] = { ...(texts[i] as Label), strong: true, kind: "name", color: tone.color ?? theme.netName, alpha: tone.alpha }
    return
  }
  const { middle, upright } = labelTag(label)
  texts.push({ text: label.text, at: middle, size: NET_LABEL_TEXT, anchor: "center", strong: true, kind: "name", color: tone.color ?? theme.netName, rotation: upright ? 90 : 0, alpha: tone.alpha })
}

function drawPins(ctx: Ctx, layout: SchematicLayout, options: SchematicDrawOptions, px: number, shiftOf: (s: PlacedSymbol) => Point): void {
  for (const symbol of layout.symbols) {
    const shift = shiftOf(symbol)
    for (const [id, end] of Object.entries(symbol.pinEnds)) {
      const lit = options.highlight?.pins?.includes(id) ?? false
      const active = (options.activePins?.includes(id) ?? false) || lit
      if (!active && !options.showPins) continue
      ctx.fillStyle = active ? theme.highlight : theme.pin
      const radius = lit ? Math.min(PIN_DOT_PX * px, Math.max(LIT_PIN_WORLD, LIT_PIN_MIN_PX * px)) : (active ? ACTIVE_PIN_FACTOR : 1) * PIN_DOT_PX * px
      dot(ctx, { x: end.x + shift.x, y: end.y + shift.y }, radius)
      ctx.fill()
    }
  }
}
