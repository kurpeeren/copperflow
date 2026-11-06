// What the schematic wire tool can start or end on, and the edit it writes, read from the design.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { NetLabel } from "../../../src/engine/schematic.js"
import type { Net, Pin } from "../../../src/engine/model.js"
import type { Point } from "./geometry.js"
import { labelTag } from "./label-tag.js"

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

/** The pin, net label or wire nearest to `p` within `maxDistance`, in that order of preference. */
export function endAt(design: Design, p: Point, maxDistance: number): WireEnd | undefined {
  const hit = pinAt(design, p, maxDistance)
  const pin = hit && allPins(design).find((candidate) => candidate.id === hit.pin)
  if (hit && pin) return pinEnd(design, pin, hit.at)
  return labelEnd(design, p, maxDistance) ?? wireEnd(design, p, maxDistance)
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

function wireEnd(design: Design, p: Point, maxDistance: number): WireEnd | undefined {
  let best: { net: string; at: Point; d: number } | undefined
  for (const wire of design.schematic.wires) {
    for (let i = 1; i < wire.points.length; i++) {
      const [a, b] = [wire.points[i - 1], wire.points[i]]
      if (!a || !b) continue
      const at = closestOnSegment(p, a, b)
      const d = distance(at, p)
      if (d <= maxDistance && (!best || d < best.d)) best = { net: wire.net, at, d }
    }
  }
  return best && netEnd(design, best.net, best.at)
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
function endHint(end: WireEnd): Point[] {
  return end.selector.startsWith("net.") ? [end.at] : []
}

/** What the W tool writes: one addTrace, or nothing when the ends are already on one net or cannot be addressed. */
export function wireEdits(design: Design, start: WireEnd, end: WireEnd, corners: Point[]): Edit[] {
  if (!addressable(start.selector) || !addressable(end.selector)) return []
  const [a, b] = [netOfEnd(design, start), netOfEnd(design, end)]
  if (sameEnd(start, end) || (a !== undefined && a.id === b?.id)) return []
  const hints = dropRepeats([...endHint(start), ...corners, ...endHint(end)])
  return [{ kind: "addTrace", from: start.selector, to: end.selector, ...(hints.length > 0 ? { schematicRouteHints: hints } : {}) }]
}

function dropRepeats(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1]?.x || p.y !== points[i - 1]?.y)
}
