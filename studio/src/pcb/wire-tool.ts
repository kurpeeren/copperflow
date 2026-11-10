// What the schematic wire tool can start or end on, and the edit it writes, read from the design.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { NetLabel } from "../../../src/engine/schematic.js"
import type { Net, Pin } from "../../../src/engine/model.js"
import type { Point } from "./geometry.js"
import { connectionRefusal } from "../../../src/core/connection-names.js"
import { connectionsWith } from "./instances.js"
import { labelTag } from "./label-tag.js"
import { wirePath, type Bends } from "./wire-path.js"

export interface WireEnd {
  /** What a trace writes: `R1.pin1` or `net.GND`. */
  selector: string
  /** Where the wire touches it. */
  at: Point
  /** A short name for messages, e.g. `R1.pin1` or `GND`. */
  label: string
  /** The named net it is on, if any. */
  net?: string
  /** The pin it stands for, e.g. `U1.pin4`, when it is a pin or the first pin of an unnamed net's wire. */
  pin?: string
  /**
   * A bus: the nets it stands for, one of which is picked before anything is written (memberEnd). Its selector is
   * `bus:<id>`, which no trace can name.
   */
  members?: readonly string[]
  /**
   * A pin of a sub-sheet instance's symbol: a port, which no trace can name. A wire to it writes the instance's
   * `connections` instead (portWire). Its selector is `port:<instance>.<port>`.
   */
  port?: { instance: string; name: string; bus: boolean; members?: readonly string[] }
}

/** A ground or power symbol is small; pointing near it counts. */
const SYMBOL_REACH = 0.2
const SELECTOR_NAME = /^[\w-]+$/
const SELECTOR_PART = /^[A-Za-z_][\w-]*$/
const WRITTEN_PIN = /^([A-Za-z_][\w-]*)\.([\w-]+)$/
const CLASS_PIN = /^\.([A-Za-z_][\w-]*)\s*>\s*\.([\w-]+)$/

/** The first name `pinLabels` gives pin `number`, if the part has one; kind aliases such as `left` are not labels. */
function labelOf(props: Record<string, unknown>, number: number): string | undefined {
  const labels = props["pinLabels"]
  if (typeof labels !== "object" || labels === null) return undefined
  for (const [key, value] of Object.entries(labels)) {
    if (!new RegExp(`^(?:pin)?${number}$`).test(key)) continue
    const first = (Array.isArray(value) ? value : [value]).find((name): name is string => typeof name === "string" && name !== "")
    if (first !== undefined) return first
  }
  return undefined
}

/**
 * `<component>.<name>` with the pin's `pinLabels` name when no other pin of the part has that name,
 * else `pin<n>`: a name two pins share (two GND pins) would connect to the first of them.
 */
export function pinSelector(design: Design, pin: Pin): string {
  const component = design.circuit.components.find((candidate) => candidate.id === pin.component)
  const name = labelOf(component?.props ?? {}, pin.number)
  const others = (component?.pins ?? []).filter((other) => other.id !== pin.id)
  const unique = name !== undefined && SELECTOR_NAME.test(name) && !others.some((other) => other.names.includes(name))
  return `${pin.component}.${unique ? name : `pin${pin.number}`}`
}

/** The pin a written selector (`R1.pin1`, `R1.anode` or `.R1 > .pin1`) names, by the engine's rule: the first pin of the part with that name. */
export function pinOfSelector(design: Design, selector: string): Pin | undefined {
  const text = selector.trim()
  const parts = WRITTEN_PIN.exec(text) ?? CLASS_PIN.exec(text)
  const component = parts && design.circuit.components.find((candidate) => candidate.id === parts[1])
  return component?.pins.find((pin) => pin.names.includes(parts?.[2] ?? ""))
}

const allPins = (design: Design): Pin[] => design.circuit.components.flatMap((component) => component.pins)
const netOfPin = (design: Design, pinId: string): Net | undefined => design.circuit.nets.find((net) => net.pins.includes(pinId))
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

function pinEnd(design: Design, pin: Pin, at: Point): WireEnd {
  const name = netOfPin(design, pin.id)?.names[0]
  const selector = pinSelector(design, pin)
  return { selector, at, label: selector, pin: pin.id, ...(name !== undefined ? { net: name } : {}) }
}

/** A pin with nothing connected: a click on it starts a wire without the wire tool. */
export function freePin(design: Design, pinId: string): boolean {
  const net = netOfPin(design, pinId)
  return net === undefined || (net.pins.length < 2 && net.names.length === 0)
}

/** A pin of an instance's sheet symbol ("PS1.VIN") as a wire end. */
function portEnd(design: Design, pinId: string, at: Point): WireEnd | undefined {
  for (const instance of design.circuit.instances ?? []) {
    if (instance.path.includes("/")) continue
    const port = instance.ports.find((candidate) => `${instance.path}.${candidate.name}` === pinId)
    if (!port) continue
    const label = `${instance.path}.${port.name}`
    const members = port.members ? { members: port.members } : {}
    return { selector: `port:${label}`, at, label, port: { instance: instance.path, name: port.name, bus: port.bus === true, ...members } }
  }
  return undefined
}

/**
 * A wire that starts or ends on a sheet symbol's pin connects that port, never by a trace: it writes the instance's
 * `connections` with the net the other end names (a net label, a flag, a pin or wire already on a named net), or for a
 * bus pin the bus the other end is, with the same members. Undefined when neither end is a port.
 */
export function portWire(design: Design, start: WireEnd, end: WireEnd): { edits: Edit[]; summary: string } | { notice: string } | undefined {
  const [pin, other] = start.port ? [start, end] : end.port ? [end, start] : []
  if (!pin?.port || !other) return undefined
  const { port } = pin
  if (other.port) return { notice: `Connect ${pin.label} and ${other.label} through a named net: wire each to a net label` }
  const instance = (design.circuit.instances ?? []).find((candidate) => candidate.path === port.instance)
  if (!instance) return { notice: `${port.instance} is gone; wait for the build` }
  const target = port.bus ? busTarget(port, other) : netTarget(other)
  if (target === undefined) {
    const what = port.bus ? `a bus with the members ${(port.members ?? []).join(", ")}` : "the net a name first (a net label)"
    return { notice: port.bus ? `${pin.label} is a bus pin; wire it to ${what}` : `Give ${what}, then wire ${pin.label} to it` }
  }
  const refusal = connectionRefusal(instance.sheet, port.name, target, port.bus)
  if (refusal !== undefined) return { notice: refusal }
  const edits: Edit[] = [{ kind: "setConnections", part: instance.path, connections: connectionsWith(instance, port.name, target) }]
  return { edits, summary: `connect ${pin.label} to ${target}` }
}

/** The named net a wire end is on: a net selector, or a pin or wire on a named net. */
const netTarget = (end: WireEnd): string | undefined => (end.members ? undefined : end.selector.startsWith("net.") ? end.selector.slice("net.".length) : end.net)

/** The bus a bus pin may take: a bus end whose members are the port's, by name. */
function busTarget(port: NonNullable<WireEnd["port"]>, end: WireEnd): string | undefined {
  const wanted = port.members ?? []
  const has = end.members ?? []
  return has.length === wanted.length && wanted.every((member) => has.includes(member)) ? end.label : undefined
}

/** The pin whose end is nearest to `p` within `maxDistance`. */
export function pinAt(design: Design, p: Point, maxDistance: number): { pin: string; at: Point } | undefined {
  let best: { pin: string; at: Point; d: number } | undefined
  for (const symbol of design.schematic.symbols) {
    for (const [pin, at] of Object.entries(symbol.pinEnds)) {
      const d = distance(at, p)
      if (d <= maxDistance && (!best || d < best.d)) best = { pin, at, d }
    }
  }
  return best && { pin: best.pin, at: best.at }
}

/**
 * Where a wire meets a bus or a wire: along the line on the grid `step` while `snap` is on, and on the axis of the
 * wire's last corner `from` when the pointer is within reach of it, so the written wire has no small jog.
 */
export interface Meet {
  step?: number
  snap?: boolean
  from?: Point
}

/** The pin, net label, bus or wire nearest to `p` within `maxDistance`, in that order of preference. */
export function endAt(design: Design, p: Point, maxDistance: number, meet: Meet = {}): WireEnd | undefined {
  const hit = pinAt(design, p, maxDistance)
  const pin = hit && allPins(design).find((candidate) => candidate.id === hit.pin)
  if (hit && pin) return pinEnd(design, pin, hit.at)
  const port = hit && portEnd(design, hit.pin, hit.at)
  if (port) return port
  return labelEnd(design, p, maxDistance) ?? busEnd(design, p, maxDistance, meet) ?? wireEnd(design, p, maxDistance, meet)
}

interface Near {
  at: Point
  d: number
  a: Point
  b: Point
}

/** The point of a line (a wire's or a bus's points) nearest to `p`, how far it is, and the segment it is on. */
function nearestOnLine(points: readonly Point[], p: Point): Near | undefined {
  let best: Near | undefined
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    if (!a || !b) continue
    const at = closestOnSegment(p, a, b)
    const d = distance(at, p)
    if (!best || d < best.d) best = { at, d, a, b }
  }
  return best
}

const round = (value: number): number => Math.round(value * 10000) / 10000 || 0

/** One coordinate along a segment from `lo` to `hi`: the corner's axis in reach, else on the grid, else as it is. */
function along(value: number, pointer: number, range: [number, number], reach: number, fixed: number | undefined, meet: Meet): number {
  const inside = (v: number) => v >= range[0] && v <= range[1]
  if (fixed !== undefined && Math.abs(pointer - fixed) <= reach && inside(fixed)) return fixed
  if (!meet.snap || !meet.step) return value
  const snapped = round(Math.round(value / meet.step) * meet.step)
  return inside(snapped) ? snapped : value
}

/** The meeting point on a horizontal or vertical segment, by the Meet rules; a slanted segment keeps the nearest point. */
function meetingPoint(near: Near, p: Point, reach: number, meet: Meet): Point {
  const { a, b, at } = near
  const axis = a.y === b.y && a.x !== b.x ? "x" : a.x === b.x && a.y !== b.y ? "y" : undefined
  if (!axis) return at
  const value = along(at[axis], p[axis], [Math.min(a[axis], b[axis]), Math.max(a[axis], b[axis])], reach, meet.from?.[axis], meet)
  return axis === "x" ? { x: value, y: a.y } : { x: a.x, y: value }
}

/** The bus nearest to `p` within `maxDistance`, met at the nearest point of its line. */
function busEnd(design: Design, p: Point, maxDistance: number, meet: Meet): WireEnd | undefined {
  let best: { id: string; name: string; members: readonly string[]; near: Near } | undefined
  for (const drawing of design.schematic.drawings) {
    if (drawing.kind !== "bus") continue
    const near = nearestOnLine(drawing.points, p)
    if (near && near.d <= maxDistance && (!best || near.d < best.near.d)) best = { id: drawing.id, name: drawing.name, members: drawing.members, near }
  }
  const at = best && meetingPoint(best.near, p, maxDistance, meet)
  return best && at && { selector: `bus:${best.id}`, at: { x: round(at.x), y: round(at.y) }, label: best.name, members: best.members }
}

/** The member picked from a bus end: its net, met where the wire meets the bus, so the label sits on the bus. */
export function memberEnd(bus: WireEnd, member: string): WireEnd {
  return { selector: `net.${member}`, at: bus.at, label: member, net: member }
}

function labelEnd(design: Design, p: Point, maxDistance: number): WireEnd | undefined {
  let best: { name: string; at: Point; d: number } | undefined
  for (const label of design.schematic.labels) {
    const net = design.circuit.nets.find((candidate) => candidate.id === label.net)
    const name = net?.names.includes(label.text) ? label.text : net?.names[0]
    const d = distanceToLabel(label, p)
    if (name !== undefined && d <= maxDistance && (!best || d < best.d)) best = { name, at: label.at, d }
  }
  return best && { selector: `net.${best.name}`, at: best.at, label: best.name, net: best.name }
}

/** How far `p` is from what the label draws: its tag, or for a ground or power symbol a small reach around it. */
function distanceToLabel(label: NetLabel, p: Point): number {
  if (label.style !== "label") return Math.max(distance(label.at, p) - SYMBOL_REACH, 0)
  const { box } = labelTag(label)
  return Math.hypot(Math.max(box.minX - p.x, 0, p.x - box.maxX), Math.max(box.minY - p.y, 0, p.y - box.maxY))
}

function wireEnd(design: Design, p: Point, maxDistance: number, meet: Meet): WireEnd | undefined {
  let best: { net: string; near: Near } | undefined
  for (const wire of design.schematic.wires) {
    const near = nearestOnLine(wire.points, p)
    if (near && near.d <= maxDistance && (!best || near.d < best.near.d)) best = { net: wire.net, near }
  }
  return best && netEnd(design, best.net, meetingPoint(best.near, p, maxDistance, meet))
}

/** A wire stands for its net: `net.<name>` when the net is named, else its first pin. */
function netEnd(design: Design, netId: string, at: Point): WireEnd | undefined {
  const net = design.circuit.nets.find((candidate) => candidate.id === netId)
  const name = net?.names[0]
  if (name !== undefined) return { selector: `net.${name}`, at, label: name, net: name }
  const first = net?.pins[0] ?? (netId.startsWith("net:") ? netId.slice("net:".length) : undefined)
  const pin = allPins(design).find((candidate) => candidate.id === first)
  return pin ? { selector: pinSelector(design, pin), at, label: pinSelector(design, pin), pin: pin.id } : undefined
}

function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

/** The net an end is on, or undefined when it is on none yet. A pin end is on the net of the pin clicked. */
function netOfEnd(design: Design, end: WireEnd): Net | undefined {
  if (end.pin !== undefined) return netOfPin(design, end.pin)
  const { selector } = end
  if (selector.startsWith("net.")) return design.circuit.nets.find((net) => net.names.includes(selector.slice("net.".length)))
  const pin = allPins(design).find((candidate) => pinSelector(design, candidate) === selector)
  return pin && netOfPin(design, pin.id)
}

/** Two ends on the same pin, or with the same selector, are one end. */
export function sameEnd(a: WireEnd, b: WireEnd): boolean {
  return a.selector === b.selector || (a.pin !== undefined && a.pin === b.pin)
}

/** The two different named nets a wire between `start` and `end` would join, so the caller can ask first. */
export function namedNetsJoined(design: Design, start: WireEnd, end: WireEnd): [string, string] | undefined {
  const [a, b] = [netOfEnd(design, start), netOfEnd(design, end)]
  const [nameA, nameB] = [nameOf(start, a), nameOf(end, b)]
  if (!a || !b || a.id === b.id || nameA === undefined || nameB === undefined) return undefined
  return [nameA, nameB]
}

const nameOf = (end: WireEnd, net: Net | undefined): string | undefined =>
  end.selector.startsWith("net.") ? end.selector.slice("net.".length) : net?.names[0]

export function addressable(selector: string): boolean {
  const part = selector.startsWith("net.") ? undefined : selector.split(".")[0]
  return part === undefined || (SELECTOR_PART.test(part) && !part.includes("~"))
}

/** A point on a net's wire or label is kept as a corner, so the wire stops there. */
const keepsEnd = (end: WireEnd): boolean => end.selector.startsWith("net.")

/**
 * The corners a wire is saved with: the interior points of the squared, tidied path from `start` to `end`
 * through `corners`, with each leg's bend. A net end keeps its own point.
 */
export function savedCorners(start: WireEnd, end: WireEnd, corners: Point[], bends: Bends = []): Point[] {
  const path = wirePath([start.at, ...corners, end.at], bends)
  return path.slice(keepsEnd(start) ? 0 : 1, keepsEnd(end) ? path.length : path.length - 1)
}

/** What the W tool writes: one addTrace, or nothing when the ends are already on one net or cannot be addressed. */
export function wireEdits(design: Design, start: WireEnd, end: WireEnd, corners: Point[], bends: Bends = []): Edit[] {
  if (start.members || end.members || !addressable(start.selector) || !addressable(end.selector)) return []
  const [a, b] = [netOfEnd(design, start), netOfEnd(design, end)]
  if (sameEnd(start, end) || (a !== undefined && a.id === b?.id)) return []
  const hints = savedCorners(start, end, corners, bends)
  return [{ kind: "addTrace", from: start.selector, to: end.selector, ...(hints.length > 0 ? { schematicRouteHints: hints } : {}) }]
}
