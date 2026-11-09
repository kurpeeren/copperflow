// Wires follow moved parts, as in EasyEDA: when parts move on the schematic (a drag, an arrow key, align or
// distribute), every hand-drawn wire (a trace with corners) that ends on a pin of a moved part keeps its first segment
// from that pin horizontal or vertical. The corner next to the pin slides across that segment with the pin; a wire
// whose two ends move alike moves whole. The corner edits go in the move's edit list, so the move stays one history
// entry. Pure; gestures.ts and key-session.ts call it with the design on the sheet.
//
// The source can be ahead of the sheet: the arrow keys move from the code's literals without waiting for a build. So the
// corners are read from the trace in the source, and each pin from the sheet, shifted by how far the source has moved
// its part since the sheet was built.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import { roundPosition, type Point } from "./geometry.js"
import type { GroupEdit } from "./group-edits.js"
import type { SourceCircuit } from "./positions.js"
import { NO_LOCKS } from "./trace-source.js"
import { directionOf } from "./wire-geometry.js"
import { tidy, wireOf, wireShapeEdits, type WireShape, type WireWriter } from "./wire-shape.js"

/** How far each moved part goes on the sheet, by name, in sheet units. */
export type Moves = ReadonlyMap<string, Point>

/** What the wires of a move are worked out from: the design on the sheet and the locked parts. Only the schematic has it. */
export interface WireFollow {
  design: Design
  locked: ReadonlySet<string>
}

type TraceWriter = Extract<WireWriter, { kind: "trace" }>

/** Where the source puts a part: its position props, and how far that is from where the sheet draws it (zero once the sheet is built from it). */
interface SourcePlace {
  props: Point
  ahead: Point
}

/** One end of a wire on a pin: where the pin is by the source, and how far the move takes it. */
interface PinEnd {
  at: Point
  by: Point
}

const ZERO: Point = { x: 0, y: 0 }
const plus = (p: Point, d: Point): Point => ({ x: roundPosition(p.x + d.x), y: roundPosition(p.y + d.y) })
const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y
const movedEnd = (end: PinEnd): Point => plus(end.at, end.by)

/** The part's position props as the source has them (the literals, else where the sheet draws it less its groups), and how far ahead of the sheet that puts it. */
function sourcePlace(design: Design, source: SourceCircuit, name: string): SourcePlace | undefined {
  const symbol = design.schematic.symbols.find((placed) => placed.component === name)
  if (!symbol) return undefined
  const group = design.circuit.components.find((component) => component.id === name)?.groupOffset.sch ?? ZERO
  const literals = source.model.parts.find((part) => part.name === name)?.props
  const prop = (key: "schX" | "schY", drawn: number, offset: number): number => {
    const literal = literals?.[key]?.literal
    return typeof literal === "number" ? literal : roundPosition(drawn - offset)
  }
  const props = { x: prop("schX", symbol.x, group.x), y: prop("schY", symbol.y, group.y) }
  return { props, ahead: { x: roundPosition(props.x + group.x - symbol.x), y: roundPosition(props.y + group.y - symbol.y) } }
}

/** How far a position prop goes: to `next` when the edit sets it, else nowhere. */
const shiftTo = (next: unknown, now: number): number => (typeof next === "number" ? roundPosition(next - now) : 0)

/** How far setProps edits move each part on the schematic: the new position props less the ones the source has. */
export function movesOf(design: Design, source: SourceCircuit, edits: readonly Edit[]): Map<string, Point> {
  const moves = new Map<string, Point>()
  for (const edit of edits) {
    if (edit.kind !== "setProps") continue
    const { schX, schY } = edit.props
    const place = typeof schX === "number" || typeof schY === "number" ? sourcePlace(design, source, edit.part) : undefined
    if (place) moves.set(edit.part, { x: shiftTo(schX, place.props.x), y: shiftTo(schY, place.props.y) })
  }
  return moves
}

/** The corners as the trace in the source writes them, in the wire's order (from its pin). */
function cornersNow(writer: TraceWriter): Point[] {
  const hints = writer.trace.schematicRouteHints ?? []
  return writer.reversed ? [...hints].reverse() : [...hints]
}

/** The wire's ends on pins, where the source has them: its first point, and its last unless that is a net label. */
function pinEnds(design: Design, source: SourceCircuit, wire: WireShape, writer: TraceWriter, moves: Moves): [PinEnd, PinEnd | undefined] | undefined {
  const endAt = (point: Point | undefined, name: string | undefined): PinEnd | undefined => {
    if (point === undefined || name === undefined) return undefined
    const place = sourcePlace(design, source, name)
    return place && { at: plus(point, place.ahead), by: moves.get(name) ?? ZERO }
  }
  const start = endAt(wire.points[0], writer.components[0])
  if (!start || writer.toNet) return start && [start, undefined]
  const end = endAt(wire.points[wire.points.length - 1], writer.components[1])
  return end && [start, end]
}

/** How far a corner next to a pin moves with it: across the segment between them only, so that keeps its direction; a slanted one stays. */
function across(pin: Point, corner: Point, by: Point): Point {
  const direction = directionOf(pin, corner)
  if (direction === "horizontal") return { x: 0, y: by.y }
  return direction === "vertical" ? { x: by.x, y: 0 } : ZERO
}

/** The corners after the move: all carried along when both ends move alike, else the one next to each pin slid across with it. */
function followCorners(start: PinEnd, corners: readonly Point[], end: PinEnd | undefined): Point[] {
  if (end && same(start.by, end.by)) return corners.map((corner) => plus(corner, start.by))
  const last = corners.length - 1
  const [first, final] = [corners[0], corners[last]]
  const fromStart = first ? across(start.at, first, start.by) : ZERO
  const fromEnd = end && final ? across(end.at, final, end.by) : ZERO
  return corners.map((corner, i) => plus(plus(corner, i === 0 ? fromStart : ZERO), i === last ? fromEnd : ZERO))
}

/** The edit that keeps one wire square at its moved pins; nothing when its shape did not change or it cannot be written. */
function followWire(design: Design, source: SourceCircuit, wire: WireShape, moves: Moves, locked: ReadonlySet<string>): Edit[] {
  const { writer } = wire
  if (writer.kind !== "trace" || !writer.components.some((name) => moves.has(name))) return []
  const corners = cornersNow(writer)
  const ends = corners.length > 0 ? pinEnds(design, source, wire, writer, moves) : undefined
  if (!ends) return []
  const [start, end] = ends
  const tail = end ? [movedEnd(end)] : []
  const next = tidy([movedEnd(start), ...followCorners(start, corners, end), ...tail])
  if (next.length < 2) return []
  const result = wireShapeEdits(design, { ...wire, points: next }, next, locked, [movedEnd(start), ...corners, ...tail])
  return Array.isArray(result) ? result : []
}

/**
 * The corner edits that keep the hand-drawn wires square at the pins of the moved parts. A wire whose trace cannot be
 * changed (read-only, corners written as an expression, a repeat, a locked part at an end) is left as it is, so the
 * move still goes through; a wire the engine draws needs nothing.
 */
export function wireFollowEdits(design: Design, source: SourceCircuit, moves: Moves, locked: ReadonlySet<string> = NO_LOCKS): Edit[] {
  if (moves.size === 0) return []
  const pins = new Set(design.circuit.components.filter((component) => moves.has(component.id)).flatMap((component) => component.pins.map((pin) => pin.id)))
  const touched = new Set(design.circuit.connections.filter((c) => pins.has(c.from) || pins.has(c.to)).map((c) => c.id))
  return design.schematic.wires.flatMap((drawn) => {
    const wire = drawn.connection !== undefined && touched.has(drawn.connection) ? wireOf(design, source, drawn.id) : undefined
    return wire ? followWire(design, source, wire, moves, locked) : []
  })
}

/** The plan with the corner edits of the wires its moves take along, in the same edit list; the plan itself without a sheet. */
export function withFollowingWires(plan: GroupEdit, source: SourceCircuit, follow: WireFollow | undefined): GroupEdit {
  if (!follow || plan.edits.length === 0) return plan
  const wires = wireFollowEdits(follow.design, source, movesOf(follow.design, source, plan.edits), follow.locked)
  return wires.length === 0 ? plan : { ...plan, edits: [...plan.edits, ...wires] }
}
