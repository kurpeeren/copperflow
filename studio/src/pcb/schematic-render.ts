// copperflow's schematic renderer: wires, symbols, chip boxes with pins, net labels and text.
import { worldToScreen, type Camera, type Point, type Size } from "./geometry.js"
import { anchorAlignment, type Ctx } from "./ctx.js"

interface Element {
  type: string
  [key: string]: unknown
}

type SymbolPrimitive =
  | { type: "path"; points: Point[]; fill?: boolean; strokeWidth?: number; color?: string }
  | { type: "circle"; x: number; y: number; radius: number; fill?: boolean; color?: string }
  | { type: "text"; text: string; x: number; y: number; anchor: string }

export interface SchematicSymbol {
  center: Point
  size: { width: number; height: number }
  primitives: unknown[]
  ports: unknown[]
}

export type SymbolLibrary = Record<string, SchematicSymbol>

export interface SchematicDrawOptions {
  ratio: number
  /** Symbol shapes, usually the `symbols` export of the schematic-symbols package. */
  symbols: SymbolLibrary
  /** Marks every pin, for wiring. */
  showPorts?: boolean
  /** Pins to emphasise, e.g. the first pin of a wire being drawn and the pin under the pointer. */
  activePorts?: readonly string[]
  /** Draws one component shifted, while it is dragged. */
  moving?: { componentId: string; by: Point }
  /** Hand-drawn wires, drawn like tscircuit's, with junctions where they meet another wire. */
  wires?: readonly Point[][]
  junctions?: readonly Point[]
  /** schematic_trace and schematic_net_label ids the hand-drawn wires replace. */
  hidden?: ReadonlySet<string>
}

export const SCHEMATIC_PALETTE = {
  body: "#22262c",
  outline: "#d9d4c7",
  pinLabel: "#e9e6df",
  pinNumber: "#959ca6",
  reference: "#e0a46a",
  value: "#959ca6",
  text: "#c9c4b8",
  wire: "#c98a4b",
  junction: "#e0a46a",
  netLabel: "#6ea8d6",
  netLabelFill: "rgb(110 168 214 / 14%)",
  graphicFill: "rgb(217 212 199 / 35%)",
  port: "#6ea8d6",
  activePort: "#ffd08a",
}

export const SUPPORTED_SCHEMATIC_TYPES = new Set([
  "schematic_component",
  "schematic_port",
  "schematic_trace",
  "schematic_text",
  "schematic_net_label",
  "schematic_path",
  "schematic_circle",
  "schematic_line",
  "schematic_rect",
  "schematic_box",
])

// Metadata and debugging aids with nothing to draw.
const IGNORED = /^(schematic_group|schematic_sheet|schematic_symbol|schematic_layout_error)$|^schematic_debug_|_error$|_warning$/
const WIRE_WIDTH = 0.02
const SYMBOL_TEXT = 0.16
const PIN_LABEL_TEXT = 0.13
const PIN_NUMBER_TEXT = 0.1
const NET_LABEL_TEXT = 0.16
const MIN_TEXT_PX = 3
const PORT_RADIUS_PX = 3.5

interface Label {
  text: string
  at: Point
  size: number
  anchor: string
  color: string
  rotation?: number
}

/** Draws the schematic and returns the drawable element types it does not support yet. */
export function drawSchematic(
  ctx: Ctx,
  input: readonly unknown[],
  view: { camera: Camera; size: Size },
  options: SchematicDrawOptions,
): { unsupported: string[] } {
  const elements = wellFormed(input)
  const { camera, size } = view
  const s = camera.scale * options.ratio
  const world = (shift: Point = { x: 0, y: 0 }) =>
    ctx.setTransform(
      s,
      0,
      0,
      -s,
      (size.width / 2 - (camera.cx - shift.x) * camera.scale) * options.ratio,
      (size.height / 2 + (camera.cy - shift.y) * camera.scale) * options.ratio,
    )
  const px = 1 / camera.scale
  const line = (width: number) => Math.max(width, 1.2 * px)
  const shiftOf = (componentId: unknown): Point =>
    options.moving && componentId === options.moving.componentId ? options.moving.by : { x: 0, y: 0 }
  const names = new Map<unknown, string>()
  for (const e of elements) if (e.type === "source_component") names.set(e.source_component_id, String(e.name))
  const labels: Label[] = []
  const label = (l: Label, shift: Point) => labels.push({ ...l, at: { x: l.at.x + shift.x, y: l.at.y + shift.y } })
  const portsOf = new Map<unknown, Element[]>()
  for (const port of byType(elements, "schematic_port")) {
    portsOf.set(port.schematic_component_id, [...(portsOf.get(port.schematic_component_id) ?? []), port])
  }

  ctx.save()
  world()
  ctx.lineCap = "round"
  ctx.lineJoin = "round"

  // Wires first, so symbols sit on top of their leads.
  ctx.strokeStyle = SCHEMATIC_PALETTE.wire
  ctx.fillStyle = SCHEMATIC_PALETTE.junction
  ctx.lineWidth = line(WIRE_WIDTH)
  const junctionRadius = Math.max(0.04, 3 * px)
  for (const trace of byType(elements, "schematic_trace")) {
    if (options.hidden?.has(String(trace.schematic_trace_id))) continue
    for (const edge of list(trace.edges)) {
      const from = point((edge as { from?: unknown } | null)?.from)
      const to = point((edge as { to?: unknown } | null)?.to)
      if (!from || !to) continue
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
    }
    for (const junction of list(trace.junctions).map(point)) {
      if (!junction) continue
      dot(ctx, junction, junctionRadius)
      ctx.fill()
    }
  }
  for (const wire of options.wires ?? []) {
    ctx.beginPath()
    wire.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
  }
  for (const junction of options.junctions ?? []) {
    dot(ctx, junction, junctionRadius)
    ctx.fill()
  }

  for (const component of byType(elements, "schematic_component")) {
    // A group is drawn by its members.
    if (component.is_schematic_group) continue
    const shift = shiftOf(component.schematic_component_id)
    world(shift)
    const symbol = symbolOf(options.symbols, component.symbol_name)
    const center = point(component.center) ?? { x: 0, y: 0 }
    if (symbol) {
      ctx.strokeStyle = SCHEMATIC_PALETTE.outline
      ctx.fillStyle = SCHEMATIC_PALETTE.outline
      const values = { "{REF}": names.get(component.source_component_id) ?? "", "{VAL}": String(component.symbol_display_value ?? "") }
      drawSymbol(ctx, symbol, center, line, values, (l) => label(l, shift))
      continue
    }
    const box = component.size as { width: number; height: number } | undefined
    if (!box) continue
    ctx.fillStyle = SCHEMATIC_PALETTE.body
    ctx.strokeStyle = SCHEMATIC_PALETTE.outline
    ctx.lineWidth = line(0.02)
    rect(ctx, center, box.width, box.height)
    ctx.fill()
    ctx.stroke()
    for (const port of portsOf.get(component.schematic_component_id) ?? []) {
      drawPin(ctx, port, line, (l) => label(l, shift))
    }
  }
  world()

  // Graphics a component or the circuit draws explicitly, such as a connector's outline.
  ctx.strokeStyle = SCHEMATIC_PALETTE.outline
  ctx.fillStyle = SCHEMATIC_PALETTE.graphicFill
  for (const e of elements) {
    if (!["schematic_path", "schematic_circle", "schematic_line", "schematic_rect", "schematic_box"].includes(e.type)) continue
    world(shiftOf(e.schematic_component_id))
    graphic(ctx, e, line)
  }
  world()

  for (const net of byType(elements, "schematic_net_label")) {
    if (options.hidden?.has(String(net.schematic_net_label_id))) continue
    const symbol = symbolOf(options.symbols, net.symbol_name)
    const center = point(net.center) ?? { x: 0, y: 0 }
    const text = String(net.text ?? "")
    if (symbol) {
      ctx.strokeStyle = SCHEMATIC_PALETTE.netLabel
      ctx.fillStyle = SCHEMATIC_PALETTE.netLabel
      drawSymbol(ctx, symbol, center, line, { "{REF}": text, "{VAL}": "" }, (l) => label({ ...l, color: SCHEMATIC_PALETTE.netLabel }, { x: 0, y: 0 }))
    } else {
      const upright = netFlag(ctx, net, text, line)
      labels.push({ text, at: center, size: NET_LABEL_TEXT, anchor: "center", color: SCHEMATIC_PALETTE.netLabel, rotation: upright ? 90 : 0 })
    }
  }

  for (const t of byType(elements, "schematic_text")) {
    const at = point(t.position) ?? { x: 0, y: 0 }
    label(
      { text: String(t.text ?? ""), at, size: Number(t.font_size) || SYMBOL_TEXT, anchor: String(t.anchor ?? "center"), color: SCHEMATIC_PALETTE.text, rotation: Number(t.rotation) || 0 },
      shiftOf(t.schematic_component_id),
    )
  }

  if (options.showPorts) {
    for (const port of byType(elements, "schematic_port")) {
      const active = options.activePorts?.includes(String(port.schematic_port_id)) ?? false
      const shift = shiftOf(port.schematic_component_id)
      const center = point(port.center) ?? { x: 0, y: 0 }
      world(shift)
      ctx.fillStyle = active ? SCHEMATIC_PALETTE.activePort : SCHEMATIC_PALETTE.port
      dot(ctx, center, (active ? 1.6 : 1) * PORT_RADIUS_PX * px)
      ctx.fill()
    }
    world()
  }

  // Text in screen space, upright and sized in pixels.
  ctx.setTransform(options.ratio, 0, 0, options.ratio, 0, 0)
  for (const l of labels) text(ctx, l, camera, size)
  ctx.restore()

  const unsupported = new Set<string>()
  for (const e of elements) {
    if (e.type.startsWith("schematic_") && !SUPPORTED_SCHEMATIC_TYPES.has(e.type) && !IGNORED.test(e.type)) unsupported.add(e.type)
  }
  return { unsupported: [...unsupported].sort() }
}

/** The schematic_port id nearest to a world point, within `maxDistance`. */
export function portAt(elements: readonly unknown[], p: Point, maxDistance: number): string | undefined {
  let best: { id: string; distance: number } | undefined
  for (const port of byType(wellFormed(elements), "schematic_port")) {
    const center = point(port.center)
    if (!center || typeof port.schematic_port_id !== "string") continue
    const distance = Math.hypot(center.x - p.x, center.y - p.y)
    if (distance <= maxDistance && (!best || distance < best.distance)) best = { id: port.schematic_port_id, distance }
  }
  return best?.id
}

function byType(elements: Element[], type: string): Element[] {
  return elements.filter((e) => e.type === type)
}

/** Circuit JSON can be edited by hand or by an agent; skip entries that are not elements. */
function wellFormed(input: readonly unknown[]): Element[] {
  return input.filter((e): e is Element => typeof e === "object" && e !== null && typeof (e as Element).type === "string")
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function point(value: unknown): Point | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const { x, y } = value as { x?: unknown; y?: unknown }
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined
}

/** A symbol by name; own keys only, so names like "constructor" find nothing. */
function symbolOf(symbols: SymbolLibrary, name: unknown): SchematicSymbol | undefined {
  return typeof name === "string" && Object.hasOwn(symbols, name) ? symbols[name] : undefined
}

function dot(ctx: Ctx, p: Point, r: number): void {
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
}

function rect(ctx: Ctx, center: Point, width: number, height: number): void {
  ctx.beginPath()
  ctx.moveTo(center.x - width / 2, center.y - height / 2)
  ctx.lineTo(center.x + width / 2, center.y - height / 2)
  ctx.lineTo(center.x + width / 2, center.y + height / 2)
  ctx.lineTo(center.x - width / 2, center.y + height / 2)
  ctx.closePath()
}

/** A symbol from the library, placed so its centre sits on `center`. */
function drawSymbol(
  ctx: Ctx,
  symbol: SchematicSymbol,
  center: Point,
  line: (width: number) => number,
  values: Record<string, string>,
  addLabel: (l: Label) => void,
): void {
  const dx = center.x - symbol.center.x
  const dy = center.y - symbol.center.y
  for (const primitive of symbol.primitives as SymbolPrimitive[]) {
    // Invisible helpers that only stretch a symbol's bounds.
    if (primitive.type !== "text" && primitive.color === "transparent") continue
    if (primitive.type === "path") {
      ctx.lineWidth = line(Math.max(primitive.strokeWidth ?? 0.02, 0.02))
      ctx.beginPath()
      primitive.points.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x + dx, q.y + dy) : ctx.lineTo(q.x + dx, q.y + dy)))
      if (primitive.fill) {
        ctx.closePath()
        ctx.fill()
      }
      ctx.stroke()
    } else if (primitive.type === "circle") {
      ctx.lineWidth = line(0.02)
      dot(ctx, { x: primitive.x + dx, y: primitive.y + dy }, primitive.radius)
      if (primitive.fill) ctx.fill()
      ctx.stroke()
    } else if (primitive.type === "text") {
      const content = values[primitive.text] ?? primitive.text
      const color = primitive.text === "{REF}" ? SCHEMATIC_PALETTE.reference : SCHEMATIC_PALETTE.value
      addLabel({ text: content, at: { x: primitive.x + dx, y: primitive.y + dy }, size: SYMBOL_TEXT, anchor: primitive.anchor, color })
    }
  }
}

/** The lead of a chip pin, its label inside the box and its number on the lead. */
function drawPin(ctx: Ctx, port: Element, line: (width: number) => number, addLabel: (l: Label) => void): void {
  const end = point(port.center) ?? { x: 0, y: 0 }
  const length = Number(port.distance_from_component_edge) || 0
  const facing = String(port.facing_direction)
  const direction = (Object.hasOwn(DIRECTIONS, facing) ? DIRECTIONS[facing] : undefined) ?? { x: 0, y: 0 }
  const edge = { x: end.x - direction.x * length, y: end.y - direction.y * length }
  ctx.strokeStyle = SCHEMATIC_PALETTE.outline
  ctx.lineWidth = line(0.02)
  ctx.beginPath()
  ctx.moveTo(edge.x, edge.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()
  const inward = { x: -direction.x * 0.06, y: -direction.y * 0.06 }
  if (typeof port.display_pin_label === "string" && port.display_pin_label !== "") {
    const anchor = direction.x > 0 ? "right" : direction.x < 0 ? "left" : direction.y > 0 ? "top" : "bottom"
    addLabel({ text: port.display_pin_label, at: { x: edge.x + inward.x, y: edge.y + inward.y }, size: PIN_LABEL_TEXT, anchor, color: SCHEMATIC_PALETTE.pinLabel })
  }
  if (port.pin_number !== undefined && length > 0) {
    const middle = { x: (edge.x + end.x) / 2, y: (edge.y + end.y) / 2 + (direction.y === 0 ? 0.04 : 0) }
    addLabel({ text: String(port.pin_number), at: middle, size: PIN_NUMBER_TEXT, anchor: direction.y === 0 ? "bottom" : "left", color: SCHEMATIC_PALETTE.pinNumber })
  }
}

const DIRECTIONS: Record<string, Point> = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, up: { x: 0, y: 1 }, down: { x: 0, y: -1 } }

/** A net label without a symbol: a tag reaching from its centre to the wire. Returns whether it stands upright. */
function netFlag(ctx: Ctx, net: Element, text: string, line: (width: number) => number): boolean {
  const center = point(net.center) ?? { x: 0, y: 0 }
  const anchor = point(net.anchor_position) ?? center
  const upright = net.anchor_side === "top" || net.anchor_side === "bottom"
  const thickness = NET_LABEL_TEXT * 1.5
  const reach = upright ? Math.abs(anchor.y - center.y) : Math.abs(anchor.x - center.x)
  const length = Math.max(reach * 2, text.length * NET_LABEL_TEXT * 0.62 + thickness)
  ctx.fillStyle = SCHEMATIC_PALETTE.netLabelFill
  ctx.strokeStyle = SCHEMATIC_PALETTE.netLabel
  ctx.lineWidth = line(0.015)
  rect(ctx, center, upright ? thickness : length, upright ? length : thickness)
  ctx.fill()
  ctx.stroke()
  return upright
}

function graphic(ctx: Ctx, e: Element, line: (width: number) => number): void {
  const width = line(Number(e.stroke_width) || 0.02)
  ctx.lineWidth = width
  switch (e.type) {
    case "schematic_path": {
      const points = list(e.points).map(point).filter((p): p is Point => p !== undefined)
      ctx.beginPath()
      points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      if (e.is_filled) {
        ctx.closePath()
        ctx.fill()
      }
      ctx.setLineDash(e.is_dashed ? [0.1, 0.06] : [])
      ctx.stroke()
      ctx.setLineDash([])
      return
    }
    case "schematic_circle": {
      dot(ctx, point(e.center) ?? { x: 0, y: 0 }, Number(e.radius) || 0)
      if (e.is_filled) ctx.fill()
      else ctx.stroke()
      return
    }
    case "schematic_line":
      ctx.beginPath()
      ctx.moveTo(Number(e.x1), Number(e.y1))
      ctx.lineTo(Number(e.x2), Number(e.y2))
      ctx.stroke()
      return
    case "schematic_rect": {
      const center = point(e.center) ?? { x: 0, y: 0 }
      ctx.save()
      ctx.translate(center.x, center.y)
      ctx.rotate(((Number(e.rotation) || 0) * Math.PI) / 180)
      rect(ctx, { x: 0, y: 0 }, Number(e.width) || 0, Number(e.height) || 0)
      if (e.is_filled) ctx.fill()
      ctx.stroke()
      ctx.restore()
      return
    }
    case "schematic_box": {
      const w = Number(e.width) || 0
      const h = Number(e.height) || 0
      rect(ctx, { x: Number(e.x) + w / 2, y: Number(e.y) + h / 2 }, w, h)
      ctx.setLineDash(e.is_dashed ? [0.1, 0.06] : [])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
}

function text(ctx: Ctx, l: Label, camera: Camera, size: Size): void {
  const fontPx = l.size * camera.scale
  if (fontPx < MIN_TEXT_PX || l.text === "") return
  const p = worldToScreen(camera, size, l.at)
  const [vertical, horizontal] = anchorAlignment(l.anchor)
  ctx.save()
  ctx.translate(p.x, p.y)
  if (l.rotation) ctx.rotate((-l.rotation * Math.PI) / 180)
  ctx.fillStyle = l.color
  ctx.font = `500 ${fontPx}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`
  ctx.textAlign = horizontal
  ctx.textBaseline = vertical
  ctx.fillText(l.text, 0, 0)
  ctx.restore()
}
