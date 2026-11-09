// Wires follow moved parts, as in EasyEDA: when parts move on the schematic (a drag, an arrow key, align or
// distribute), every hand-drawn wire (a trace with corners) that ends on a pin of a moved part keeps its first segment
// from that pin horizontal or vertical. The corner next to the pin slides across that segment with the pin; a wire
// whose two ends move alike moves whole. A wire selected with the parts (a drag or an arrow key) is carried whole by
// the move: its corners move by the offset, an end whose part moves goes along, and an end that stays gets a new
// segment (wire-geometry.ts carryPath). Every trace gets one edit at most, in the move's edit list, so the move stays
// one history entry. Pure; gestures.ts and key-session.ts call it with the design on the sheet.
//
// The source can be ahead of the sheet: the arrow keys move from the code's literals without waiting for a build. So the
// corners are read from the trace in the source, and each pin from the sheet, shifted by how far the source has moved
// its part since the sheet was built.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import { roundPosition, type Point } from "./geometry.js"
import { nameList, wireWords, type GroupEdit } from "./group-edits.js"
import { sourcePosition, VIEWS, ZERO, type SourceCircuit } from "./positions.js"
import { NO_LOCKS } from "./trace-source.js"
import { describeWire, namedWireReason } from "./wire-actions.js"
import { directionOf } from "./wire-geometry.js"
import { carryPath, tidy, wireBlocker, wireOf, wireShapeEdits, type WireShape, type WireWriter } from "./wire-shape.js"

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

const plus = (p: Point, d: Point): Point => ({ x: roundPosition(p.x + d.x), y: roundPosition(p.y + d.y) })
const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y
const movedEnd = (end: PinEnd): Point => plus(end.at, end.by)

/** The part's position props as the source has them (positions.ts sourcePosition), and how far ahead of the sheet that puts it. */
function sourcePlace(design: Design, source: SourceCircuit, name: string): SourcePlace | undefined {
  const symbol = design.schematic.symbols.find((placed) => placed.component === name)
  if (!symbol) return undefined
  const group = design.circuit.components.find((component) => component.id === name)?.groupOffset.sch ?? ZERO
  const at = sourcePosition(source, name, "schematic", { origin: symbol, group })
  const props = { x: roundPosition(at.x), y: roundPosition(at.y) }
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

/** A trace wire as the source has it now: its pin ends, its corners as written, and the tidied path through them. */
interface SourceWire {
  start: PinEnd
  end: PinEnd | undefined
  corners: Point[]
  path: Point[]
}

/** The wire as the source has it; undefined when it has no corners (Studio draws it) or a pin is not on the sheet. */
function sourceWire(design: Design, source: SourceCircuit, wire: WireShape, writer: TraceWriter, moves: Moves): SourceWire | undefined {
  const corners = cornersNow(writer)
  const ends = corners.length > 0 ? pinEnds(design, source, wire, writer, moves) : undefined
  if (!ends) return undefined
  const [start, end] = ends
  return { start, end, corners, path: tidy([start.at, ...corners, ...(end ? [end.at] : [])]) }
}

/** The edits that write `next` as the wire's shape; nothing when it is the shape `shown` or the trace cannot be written. */
function shapeEdits(design: Design, wire: WireShape, next: Point[], locked: ReadonlySet<string>, shown: Point[]): Edit[] {
  const result = next.length < 2 ? [] : wireShapeEdits(design, { ...wire, points: next }, next, locked, shown)
  return Array.isArray(result) ? result : []
}

/** The edit that keeps one wire square at its moved pins; nothing when its shape did not change or it cannot be written. */
function followWire(design: Design, source: SourceCircuit, wire: WireShape, moves: Moves, locked: ReadonlySet<string>): Edit[] {
  const { writer } = wire
  if (writer.kind !== "trace" || !writer.components.some((name) => moves.has(name))) return []
  const now = sourceWire(design, source, wire, writer, moves)
  if (!now) return []
  const { start, end } = now
  const tail = end ? [movedEnd(end)] : []
  // The corner next to each pin is picked on the tidied path, so a point in the middle of a run is not taken for it.
  const current = now.path.slice(1, end ? -1 : undefined)
  const next = tidy([movedEnd(start), ...followCorners(start, current, end), ...tail])
  return shapeEdits(design, wire, next, locked, [movedEnd(start), ...now.corners, ...tail])
}

/**
 * The corner edits that keep the hand-drawn wires square at the pins of the moved parts, but for the wires in `skip`
 * (carried whole instead). A wire whose trace cannot be changed (read-only, corners written as an expression, a repeat,
 * a locked part at an end) is left as it is, so the move still goes through; a wire the engine draws needs nothing.
 */
export function wireFollowEdits(design: Design, source: SourceCircuit, moves: Moves, locked: ReadonlySet<string> = NO_LOCKS, skip: ReadonlySet<string> = new Set()): Edit[] {
  if (moves.size === 0) return []
  const pins = new Set(design.circuit.components.filter((component) => moves.has(component.id)).flatMap((component) => component.pins.map((pin) => pin.id)))
  const touched = new Set(design.circuit.connections.filter((c) => pins.has(c.from) || pins.has(c.to)).map((c) => c.id))
  return design.schematic.wires.flatMap((drawn) => {
    const followed = drawn.connection !== undefined && touched.has(drawn.connection) && !skip.has(drawn.id)
    const wire = followed ? wireOf(design, source, drawn.id) : undefined
    return wire ? followWire(design, source, wire, moves, locked) : []
  })
}

/** The selected wires a move carries, and the offset the move gives the selection. */
export interface Carry {
  wires: readonly string[]
  offset: Point
}

/**
 * What a move does to one selected wire: leaves it (Studio draws its shape and draws it again), names why it cannot
 * move, leaves it to the following when both its end parts move (it then moves whole), or carries it by the offset.
 */
type CarryOutcome =
  | { kind: "leave" }
  | { kind: "blocked"; reason: string }
  | { kind: "follow"; name: string }
  | { kind: "carry"; id: string; name: string; edits: Edit[] }

/** The edit that carries one wire whole by `offset`; its ends whose parts move go along (by the same offset). */
function carryWire(design: Design, source: SourceCircuit, wire: WireShape, writer: TraceWriter, offset: Point, moves: Moves, locked: ReadonlySet<string>): Edit[] {
  const now = sourceWire(design, source, wire, writer, moves)
  if (!now) return []
  const [first, second] = writer.components
  const moving = { start: first !== undefined && moves.has(first), end: now.end !== undefined && second !== undefined && moves.has(second) }
  return shapeEdits(design, wire, carryPath(now.path, offset, moving), locked, now.path)
}

function carryOutcome(follow: WireFollow, source: SourceCircuit, id: string, offset: Point, moves: Moves): CarryOutcome {
  const { design, locked } = follow
  const wire = wireOf(design, source, id)
  const writer = wire?.writer
  if (!wire || writer?.kind !== "trace" || cornersNow(writer).length === 0) return { kind: "leave" }
  const blocked = wireBlocker(design, wire, locked)
  if (blocked !== null) return { kind: "blocked", reason: namedWireReason(design, wire, blocked) }
  const name = describeWire(design, wire)
  if (!writer.toNet && writer.components.every((part) => moves.has(part))) return { kind: "follow", name }
  return { kind: "carry", id, name, edits: carryWire(design, source, wire, writer, offset, moves, locked) }
}

/** The selected wires' part in a move: their edits, the wires carried (the following leaves them), their names and why some stay. */
interface Carried {
  edits: Edit[]
  ids: ReadonlySet<string>
  names: string[]
  skipped: string[]
}

function carriedWires(follow: WireFollow, source: SourceCircuit, carry: Carry | undefined, moves: Moves): Carried {
  const outcomes = carry ? carry.wires.map((id) => carryOutcome(follow, source, id, carry.offset, moves)) : []
  return {
    edits: outcomes.flatMap((outcome) => (outcome.kind === "carry" ? outcome.edits : [])),
    ids: new Set(outcomes.flatMap((outcome) => (outcome.kind === "carry" ? [outcome.id] : []))),
    names: outcomes.flatMap((outcome) => (outcome.kind === "carry" || outcome.kind === "follow" ? [outcome.name] : [])),
    skipped: outcomes.flatMap((outcome) => (outcome.kind === "blocked" ? [outcome.reason] : [])),
  }
}

/** The history's line for a move of parts and wires: "move R1 and the wire from R1.pin2 to R2.pin1 in the schematic by (0, 0.5)". */
const carriedSummary = (parts: readonly string[], wires: readonly string[], offset: Point): string =>
  `move ${nameList([...parts, ...wireWords(wires)])}${VIEWS.schematic.where} by (${roundPosition(offset.x)}, ${roundPosition(offset.y)})`

/**
 * The plan with the wires its moves take along, in the same edit list: the selected wires in `carry`, carried whole,
 * and the hand-drawn wires at the moved pins, kept square. A selected wire that cannot move is named among those left
 * out. The plan itself without a sheet (the PCB).
 */
export function withFollowingWires(plan: GroupEdit, source: SourceCircuit, follow: WireFollow | undefined, carry?: Carry): GroupEdit {
  if (!follow) return plan
  const moves = movesOf(follow.design, source, plan.edits)
  const selected = carriedWires(follow, source, carry, moves)
  const edits = [...selected.edits, ...wireFollowEdits(follow.design, source, moves, follow.locked, selected.ids)]
  if (edits.length === 0 && selected.names.length === 0 && selected.skipped.length === 0) return plan
  const summary = carry && selected.names.length > 0 ? carriedSummary(plan.parts, selected.names, carry.offset) : plan.summary
  return { ...plan, edits: [...plan.edits, ...edits], summary, skipped: [...plan.skipped, ...selected.skipped] }
}
