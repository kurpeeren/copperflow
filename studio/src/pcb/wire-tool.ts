// What the schematic wire tool can start or end on, and the edit it writes, read from the design.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { Net, Pin } from "../../../src/engine/model.js"
import type { Point } from "./geometry.js"

export interface WireEnd {
  /** What a trace writes: `R1.pin1` or `net.GND`. */
  selector: string
  /** Where the wire touches it. */
  at: Point
  /** A short name for messages, e.g. `R1.pin1` or `GND`. */
  label: string
  /** The named net it is on, if any. */
  net?: string
}

/** A net label is a small tag; pointing anywhere on it counts. */
const LABEL_REACH = 0.2
const SELECTOR_NAME = /^[\w-]+$/
const SELECTOR_PART = /^[A-Za-z_][\w-]*$/

/** `<component>.<name>`, with the pin's first label name when it has one, else `pin<n>`. */
function pinSelector(pin: Pin): string {
  const name = pin.names[1]
  return `${pin.component}.${name !== undefined && SELECTOR_NAME.test(name) ? name : `pin${pin.number}`}`
}

const allPins = (design: Design): Pin[] => design.circuit.components.flatMap((component) => component.pins)
const netOfPin = (design: Design, pinId: string): Net | undefined => design.circuit.nets.find((net) => net.pins.includes(pinId))
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

function pinEnd(design: Design, pin: Pin, at: Point): WireEnd {
  const name = netOfPin(design, pin.id)?.names[0]
  const selector = pinSelector(pin)
  return { selector, at, label: selector, ...(name !== undefined ? { net: name } : {}) }
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
    const d = distance(label.at, p) - LABEL_REACH
    if (name !== undefined && d <= maxDistance && (!best || d < best.d)) best = { name, at: label.at, d }
  }
  return best && { selector: `net.${best.name}`, at: best.at, label: best.name, net: best.name }
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
  return pin ? { selector: pinSelector(pin), at, label: pinSelector(pin) } : undefined
}

function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

/** The net a selector is on, or undefined when it is on none yet. */
function netOfSelector(design: Design, selector: string): Net | undefined {
  if (selector.startsWith("net.")) return design.circuit.nets.find((net) => net.names.includes(selector.slice("net.".length)))
  const pin = allPins(design).find((candidate) => pinSelector(candidate) === selector)
  return pin && netOfPin(design, pin.id)
}

/** The two different named nets a wire between `start` and `end` would join, so the caller can ask first. */
export function namedNetsJoined(design: Design, start: WireEnd, end: WireEnd): [string, string] | undefined {
  const [a, b] = [netOfSelector(design, start.selector), netOfSelector(design, end.selector)]
  const [nameA, nameB] = [nameOf(start, a), nameOf(end, b)]
  if (!a || !b || a.id === b.id || nameA === undefined || nameB === undefined) return undefined
  return [nameA, nameB]
}

const nameOf = (end: WireEnd, net: Net | undefined): string | undefined =>
  end.selector.startsWith("net.") ? end.selector.slice("net.".length) : net?.names[0]

function addressable(selector: string): boolean {
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
  const [a, b] = [netOfSelector(design, start.selector), netOfSelector(design, end.selector)]
  if (start.selector === end.selector || (a !== undefined && a.id === b?.id)) return []
  const hints = dropRepeats([...endHint(start), ...corners, ...endHint(end)])
  return [{ kind: "addTrace", from: start.selector, to: end.selector, ...(hints.length > 0 ? { schematicRouteHints: hints } : {}) }]
}

function dropRepeats(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1]?.x || p.y !== points[i - 1]?.y)
}
