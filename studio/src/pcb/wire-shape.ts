// Selecting and reshaping a schematic wire: where a wire's points come from, which of them are
// fixed, which trace writes them, and the edit that saves a new shape. Pure; the canvas gestures call it.
// A hand-drawn wire is written as `schematicRouteHints` on its trace. A wire the engine drew on its
// own (between near pins of a named net) gets a new trace between its two pins, which changes no
// connection (both pins are on the net already) and only fixes the shape. One it routed from a pin to
// another wire of its net is written from the pin to the net (wire-on-wire.ts).
import type { Edit, TraceInfo } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { Connection, Pin } from "../../../src/engine/model.js"
import type { Point } from "./geometry.js"
import type { SourceCircuit } from "./positions.js"
import { endMatches, lockedPart, netNames, NO_LOCKS, pickRepeat, repeatBlocker, traceBlocker, tracesBetween, type EndMatch } from "./trace-source.js"
import { tidy } from "./wire-geometry.js"
import { bareTrace, onNetWire, onWireEdits, type OnWire } from "./wire-on-wire.js"
import { addressable, pinOfSelector, pinSelector } from "./wire-tool.js"

export { carryPath, dragCorner, dragSegment, removeCorner, tidy, type MovingEnds } from "./wire-geometry.js"

/** Edits that save the shape, or the reason they cannot be written. Same shape as a label drag's result. */
export type WireShapeResult = Edit[] | { blocked: string }

type TraceWriter = {
  kind: "trace"
  trace: TraceInfo
  /** The wire ends on a named net, at its label; that last point is a corner the trace writes. */
  toNet: boolean
  /** The trace names the net first, so its corners run against the wire. */
  reversed: boolean
  components: string[]
  /** Why an edit would reach another trace than this one. */
  repeat?: string
}

/** What writes a wire's corners. */
export type WireWriter =
  | TraceWriter
  /**
   * A wire the engine drew between two pins; saving the shape adds a trace between them. With `onWire` it runs from a
   * pin (`from`) to a point on another wire of its net (`to` names the net), and saving writes a trace between those.
   */
  | { kind: "engine"; from: string; to: string; components: string[]; unaddressable?: string; onWire?: OnWire }
  | { kind: "none"; reason: string }

export interface WireShape {
  id: string
  /** The wire as drawn, from its first to its last point. */
  points: Point[]
  /** Both ends stay where they are: a pin end, and the label end of a wire to a named net. */
  fixed: { start: true; end: true }
  writer: WireWriter
}

const ENGINE_WIRE = /^wire:.+:\d+$/
const isNet = (end: string): boolean => end.startsWith("net.")
const sameSpot = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y
const pinById = (design: Design, id: string): Pin | undefined => design.circuit.components.flatMap((c) => c.pins).find((pin) => pin.id === id)

function shape(id: string, points: Point[], writer: WireWriter): WireShape {
  return { id, points, fixed: { start: true, end: true }, writer }
}

/** The trace of a hand-drawn connection: the one between the same ends, written in the same direction, taking the n-th of a repeated pair. */
function traceOfConnection(design: Design, source: SourceCircuit, connection: Connection): TraceInfo | undefined {
  const endOf = (id: string): EndMatch => (isNet(id) ? { net: netNames(design, id) } : { pin: id })
  const sameWay = (t: TraceInfo) => endMatches(design, t.from, endOf(connection.from))
  const matches = tracesBetween(design, source, endOf(connection.from), endOf(connection.to)).filter(sameWay)
  return pickRepeat(matches, connection.id)
}

function handDrawn(design: Design, source: SourceCircuit, id: string, points: Point[], connection: Connection): WireShape {
  const trace = traceOfConnection(design, source, connection)
  if (!trace) return shape(id, points, { kind: "none", reason: "The wire is not written in a trace the Studio can find" })
  const pins = [connection.from, connection.to].filter((end) => !isNet(end))
  const components = pins.map((pin) => pinById(design, pin)?.component ?? "")
  const toNet = pins.length === 1
  const repeat = repeatBlocker(source, trace)
  return shape(id, points, { kind: "trace", trace, toNet, reversed: toNet && isNet(connection.from), components, ...(repeat ? { repeat } : {}) })
}

/** The pin of `pins` whose end on the sheet is `p`. */
function pinAtEnd(design: Design, pins: readonly string[], p: Point): Pin | undefined {
  const id = pins.find((pin) => design.schematic.symbols.some((symbol) => symbol.pinEnds[pin] !== undefined && sameSpot(symbol.pinEnds[pin] as Point, p)))
  return id === undefined ? undefined : pinById(design, id)
}

const unaddressableOf = (design: Design, pins: readonly Pin[]): { unaddressable?: string } => {
  const pin = pins.find((candidate) => !addressable(pinSelector(design, candidate)))
  return pin ? { unaddressable: `${pin.id} has a repeated name and cannot be wired from the Studio` } : {}
}

/** A wire from a pin to a point on another wire of its named net, or undefined when the wire is not one. */
function toNetWire(design: Design, source: SourceCircuit, id: string, points: Point[], pin: Pin, pinLast: boolean, netId: string): WireShape | undefined {
  const name = design.circuit.nets.find((candidate) => candidate.id === netId)?.names[0]
  const meeting = pinLast ? points[0] : points[points.length - 1]
  if (name === undefined || !meeting || !onNetWire(design, id, netId, meeting)) return undefined
  const trace = bareTrace(design, source, pin, netId)
  const onWire: OnWire = trace ? { pinLast, trace } : { pinLast }
  return shape(id, points, { kind: "engine", from: pinSelector(design, pin), to: `net.${name}`, components: [pin.component], ...unaddressableOf(design, [pin]), onWire })
}

function engineDrawn(design: Design, source: SourceCircuit, id: string, points: Point[], netId: string): WireShape {
  const net = design.circuit.nets.find((candidate) => candidate.id === netId)
  const [first, last] = [points[0], points[points.length - 1]]
  const [a, b] = first && last && net ? [pinAtEnd(design, net.pins, first), pinAtEnd(design, net.pins, last)] : []
  const onWire = a && !b ? toNetWire(design, source, id, points, a, false, netId) : !a && b ? toNetWire(design, source, id, points, b, true, netId) : undefined
  if (onWire) return onWire
  if (!a || !b) return shape(id, points, { kind: "none", reason: "The pins of this wire are not on the sheet" })
  return shape(id, points, { kind: "engine", from: pinSelector(design, a), to: pinSelector(design, b), components: [a.component, b.component], ...unaddressableOf(design, [a, b]) })
}

/** The wire `wireId` as the Studio can reshape it; undefined when the sheet has no such wire. */
export function wireOf(design: Design, source: SourceCircuit, wireId: string): WireShape | undefined {
  const wire = design.schematic.wires.find((candidate) => candidate.id === wireId)
  if (!wire) return undefined
  const points = wire.points.map((p) => ({ x: p.x, y: p.y }))
  const connection = design.circuit.connections.find((candidate) => candidate.id === wire.connection)
  if (connection) return handDrawn(design, source, wire.id, points, connection)
  if (ENGINE_WIRE.test(wire.id)) return engineDrawn(design, source, wire.id, points, wire.net)
  return shape(wire.id, points, { kind: "none", reason: "This wire is not drawn from the code" })
}

/** Why the wire's shape cannot be saved, or null when it can. */
export function wireBlocker(design: Design, wire: WireShape, locked: ReadonlySet<string> = NO_LOCKS): string | null {
  const { writer } = wire
  if (writer.kind === "none") return writer.reason
  const lockedName = lockedPart(design, writer.components, writer.kind === "trace" ? writer.trace : undefined, locked)
  if (lockedName !== undefined) return `${lockedName} is locked`
  if (writer.kind === "engine") return writer.unaddressable ?? null
  return writer.repeat ?? traceBlocker(writer.trace) ?? null
}

/** The corners a trace writes for `path`: the points between the ends (and the label end of a wire to a net), in the order the trace names its ends. */
function cornersOf(path: readonly Point[], writer: TraceWriter): Point[] {
  const corners = path.slice(1, writer.toNet ? undefined : -1)
  return writer.reversed ? [...corners].reverse() : corners
}

function sameEnds(path: readonly Point[], wire: WireShape): boolean {
  const [first, last] = [path[0], path[path.length - 1]]
  const [start, end] = [wire.points[0], wire.points[wire.points.length - 1]]
  return first !== undefined && last !== undefined && start !== undefined && end !== undefined && sameSpot(first, start) && sameSpot(last, end)
}

/** Whether two paths have the same points, in the same order. */
export const samePath = (a: readonly Point[], b: readonly Point[]): boolean => a.length === b.length && a.every((p, i) => sameSpot(p, b[i] as Point))

/**
 * The edit that saves `path` as the wire's shape: new corners on its trace, or a new trace between
 * the two pins of an engine-drawn wire. Nothing when the shape is the one `shown`: the wire as built,
 * or a new shape still waiting for its build (then a path back to the built shape is written, to restore it).
 */
export function wireShapeEdits(design: Design, wire: WireShape, path: readonly Point[], locked: ReadonlySet<string> = NO_LOCKS, shown: readonly Point[] = wire.points): WireShapeResult {
  const blocked = wireBlocker(design, wire, locked)
  if (blocked !== null) return { blocked }
  const next = tidy(path)
  if (!sameEnds(next, wire)) return { blocked: "The ends of a wire stay on their pins" }
  if (samePath(next, tidy(shown))) return []
  const { writer } = wire
  if (writer.kind === "trace") {
    return [{ kind: "setTraceHints", from: writer.trace.from ?? "", to: writer.trace.to ?? "", schematicRouteHints: cornersOf(next, writer) }]
  }
  if (writer.kind !== "engine") return []
  if (writer.onWire) return onWireEdits(writer.onWire, writer.from, writer.to, next)
  const corners = next.slice(1, -1)
  return [{ kind: "addTrace", from: writer.from, to: writer.to, ...(corners.length > 0 ? { schematicRouteHints: corners } : {}) }]
}
