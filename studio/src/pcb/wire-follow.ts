// Wires follow moved parts, as in EasyEDA: when parts move on the schematic (a drag, an arrow key, align or
// distribute), every hand-drawn wire (a trace with corners) that ends on a pin of a moved part keeps its first segment
// from that pin horizontal or vertical. The corner next to the pin slides across that segment with the pin; a wire
// whose two ends move alike moves whole. A wire selected with the parts (a drag or an arrow key) is carried whole by
// the move: its corners move by the offset, an end whose part moves goes along, and an end that stays gets a new
// segment (wire-geometry.ts carryPath). Net labels and flags selected with them go too (label-follow.ts). Every trace
// gets one edit at most, in the move's edit list, so the move stays one history entry. Pure; gestures.ts and
// key-session.ts call it with the design on the sheet.
//
// The source can be ahead of the sheet: the arrow keys move from the code's literals without waiting for a build. So the
// corners are read from the trace in the source, and each pin from the sheet, shifted by how far the source has moved
// its part since the sheet was built.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import { roundPosition, type Point } from "./geometry.js"
import { nameList, wireWords, type GroupEdit } from "./group-edits.js"
import type { LabelMove } from "./label-drag.js"
import { labelNames, labelWords, ownLabelMoves, sortLabels, type LabelSort } from "./label-follow.js"
import { sourcePosition, VIEWS, ZERO, type SourceCircuit } from "./positions.js"
import { NO_LOCKS } from "./trace-source.js"
import { describeWire, namedWireReason } from "./wire-actions.js"
import { directionOf } from "./wire-geometry.js"
import { carryPath, tidy, wireBlocker, wireOf, wireShapeEdits, type WireShape, type WireWriter } from "./wire-shape.js"
import type { WireLine } from "./wire-hit.js"

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

/** A wire's new shape in a move, and the edits that write it: the shape is drawn until the build with the move lands. */
interface WireMove {
  line: WireLine
  edits: Edit[]
}

/** The move that writes `next` as the wire's shape; none when it is the shape `shown` or the trace cannot be written. */
function shapeMove(design: Design, wire: WireShape, next: Point[], locked: ReadonlySet<string>, shown: Point[]): WireMove | undefined {
  const result = next.length < 2 ? [] : wireShapeEdits(design, { ...wire, points: next }, next, locked, shown)
  return Array.isArray(result) && result.length > 0 ? { line: { id: wire.id, points: next }, edits: result } : undefined
}

/** The new shape that keeps one wire square at its moved pins; none when its shape did not change or it cannot be written. */
function followWire(design: Design, source: SourceCircuit, wire: WireShape, moves: Moves, locked: ReadonlySet<string>): WireMove | undefined {
  const { writer } = wire
  if (writer.kind !== "trace" || !writer.components.some((name) => moves.has(name))) return undefined
  const now = sourceWire(design, source, wire, writer, moves)
  if (!now) return undefined
  const { start, end } = now
  const tail = end ? [movedEnd(end)] : []
  // The corner next to each pin is picked on the tidied path, so a point in the middle of a run is not taken for it.
  const current = now.path.slice(1, end ? -1 : undefined)
  const next = tidy([movedEnd(start), ...followCorners(start, current, end), ...tail])
  return shapeMove(design, wire, next, locked, [movedEnd(start), ...now.corners, ...tail])
}

/** The new shapes of the hand-drawn wires at the moved pins, but for the wires in `skip` (wireFollowEdits says which). */
function wireFollowMoves(design: Design, source: SourceCircuit, moves: Moves, locked: ReadonlySet<string>, skip: ReadonlySet<string>): WireMove[] {
  if (moves.size === 0) return []
  const pins = new Set(design.circuit.components.filter((component) => moves.has(component.id)).flatMap((component) => component.pins.map((pin) => pin.id)))
  const touched = new Set(design.circuit.connections.filter((c) => pins.has(c.from) || pins.has(c.to)).map((c) => c.id))
  return design.schematic.wires.flatMap((drawn) => {
    const followed = drawn.connection !== undefined && touched.has(drawn.connection) && !skip.has(drawn.id)
    const wire = followed ? wireOf(design, source, drawn.id) : undefined
    const move = wire && followWire(design, source, wire, moves, locked)
    return move ? [move] : []
  })
}

/**
 * The corner edits that keep the hand-drawn wires square at the pins of the moved parts, but for the wires in `skip`
 * (carried whole instead). A wire whose trace cannot be changed (read-only, corners written as an expression, a repeat,
 * a locked part at an end) is left as it is, so the move still goes through; a wire the engine draws needs nothing.
 */
export function wireFollowEdits(design: Design, source: SourceCircuit, moves: Moves, locked: ReadonlySet<string> = NO_LOCKS, skip: ReadonlySet<string> = new Set()): Edit[] {
  return wireFollowMoves(design, source, moves, locked, skip).flatMap((move) => move.edits)
}

/** The selected wires and labels a move carries, and the offset the move gives the selection. */
export interface Carry {
  wires: readonly string[]
  labels?: readonly string[]
  offset: Point
}

/**
 * What a move does to one selected wire: leaves it (Studio draws its shape and draws it again), names why it cannot
 * move, leaves it to the following when both its end parts move (it then moves whole), or carries it by the offset.
 */
type CarryOutcome =
  | { kind: "leave" }
  | { kind: "blocked"; reason: string; named: string }
  | { kind: "follow"; id: string; name: string }
  | { kind: "carry"; id: string; name: string; move: WireMove | undefined }

/**
 * The new shape that carries one wire whole by `offset`; its ends whose parts move go along (by the same offset), and
 * so does the label end of a wire to a net when its label is selected (`labelEnd`).
 */
function carryWire(design: Design, source: SourceCircuit, wire: WireShape, writer: TraceWriter, carry: { offset: Point; labelEnd: boolean }, moves: Moves, locked: ReadonlySet<string>): WireMove | undefined {
  const now = sourceWire(design, source, wire, writer, moves)
  if (!now) return undefined
  const [first, second] = writer.components
  const end = now.end ? second !== undefined && moves.has(second) : carry.labelEnd
  const moving = { start: first !== undefined && moves.has(first), end }
  return shapeMove(design, wire, carryPath(now.path, carry.offset, moving), locked, now.path)
}

function carryOutcome(follow: WireFollow, source: SourceCircuit, id: string, carry: { offset: Point; labelEnd: boolean }, moves: Moves): CarryOutcome {
  const { design, locked } = follow
  const wire = wireOf(design, source, id)
  const writer = wire?.writer
  if (!wire || writer?.kind !== "trace" || cornersNow(writer).length === 0) return { kind: "leave" }
  const blocked = wireBlocker(design, wire, locked)
  if (blocked !== null) return { kind: "blocked", reason: blocked, named: namedWireReason(design, wire, blocked) }
  const name = describeWire(design, wire)
  if (!writer.toNet && writer.components.every((part) => moves.has(part))) return { kind: "follow", id, name }
  return { kind: "carry", id, name, move: carryWire(design, source, wire, writer, carry, moves, locked) }
}

const STUDIO_SHAPE = "Studio draws this wire's shape between its pins; drag one of its segments to give it corners first"
const STUDIO_SHAPES = "Studio draws these wires' shapes between their pins; drag one of their segments to give them corners first"

/**
 * What the selected wires say about the move: why each one that cannot move stays (but for a reason a part already
 * gave, such as its lock), and, when nothing moved at all, that Studio draws the shapes of those it left.
 */
function carryNotes(outcomes: readonly CarryOutcome[], said: readonly string[], nothingMoved: boolean): string[] {
  const blocked = outcomes.flatMap((outcome) => (outcome.kind === "blocked" && !said.includes(outcome.reason) ? [outcome.named] : []))
  const left = outcomes.filter((outcome) => outcome.kind === "leave").length
  const studio = nothingMoved && left > 0 ? [left === 1 ? STUDIO_SHAPE : STUDIO_SHAPES] : []
  return [...blocked, ...studio]
}

/** The names of the selected wires the move changes: carried to a new shape, or moved whole by the following (`followed`). */
function changedNames(outcomes: readonly CarryOutcome[], followed: ReadonlySet<string>): string[] {
  return outcomes.flatMap((outcome) => ((outcome.kind === "carry" && outcome.move) || (outcome.kind === "follow" && followed.has(outcome.id)) ? [outcome.name] : []))
}

/** The history's line for a move of parts, wires and labels: "move R1 and the wire from R1.pin2 to R2.pin1 in the schematic by (0, 0.5)". */
const carriedSummary = (parts: readonly string[], wires: readonly string[], labels: readonly string[], offset: Point): string =>
  `move ${nameList([...parts, ...wireWords(wires), ...labelWords(labels)])}${VIEWS.schematic.where} by (${roundPosition(offset.x)}, ${roundPosition(offset.y)})`

/**
 * A move's plan with its wires' and labels' edits, the new shapes of those wires, and the labels moved on their own,
 * drawn until the build with the move lands.
 */
export interface MovedWires {
  plan: GroupEdit
  lines: WireLine[]
  labels: LabelMove[]
}

/** What the selected wires and labels do in a move: each selected wire's outcome, and those of the wires the selected labels ride on. */
interface Carried {
  outcomes: CarryOutcome[]
  riding: CarryOutcome[]
  sort: LabelSort
}

function carriedWires(follow: WireFollow, source: SourceCircuit, carry: Carry | undefined, moves: Moves): Carried {
  const wires = carry?.wires ?? []
  const sort = sortLabels(follow.design, carry?.labels ?? [], (part) => moves.has(part), wires)
  const outcomeOf = (id: string) => carryOutcome(follow, source, id, { offset: carry?.offset ?? ZERO, labelEnd: sort.riding.has(id) }, moves)
  const extra = [...sort.riding.keys()].filter((id) => !wires.includes(id))
  return { outcomes: wires.map(outcomeOf), riding: extra.map(outcomeOf), sort }
}

/** The selected labels the move takes along: on a moved pin, or riding on a wire that moved. */
function labelsTaken(carried: Carried): string[] {
  const moved = new Set([...carried.outcomes, ...carried.riding].flatMap((outcome) => (outcome.kind === "carry" && outcome.move ? [outcome.id] : [])))
  return [...carried.sort.onPins, ...[...carried.sort.riding].flatMap(([wire, label]) => (moved.has(wire) ? [label] : []))]
}

/**
 * The plan with the wires and labels its moves take along, in the same edit list: the selected wires in `carry`,
 * carried whole, the hand-drawn wires at the moved pins, kept square, and the selected labels (label-follow.ts); and
 * the new shapes those edits give the wires and labels. The history names the selected wires and labels the move
 * changes; one that cannot move is named among those left out, and a move that moves nothing says why. The plan
 * itself, with no shapes, without a sheet (the PCB).
 */
export function withMovedWires(plan: GroupEdit, source: SourceCircuit, follow: WireFollow | undefined, carry?: Carry): MovedWires {
  if (!follow) return { plan, lines: [], labels: [] }
  const moves = movesOf(follow.design, source, plan.edits)
  const carried = carriedWires(follow, source, carry, moves)
  const carriedMoves = [...carried.outcomes, ...carried.riding].flatMap((outcome) => (outcome.kind === "carry" && outcome.move ? [outcome.move] : []))
  const following = wireFollowMoves(follow.design, source, moves, follow.locked, new Set(carriedMoves.map((move) => move.line.id)))
  const wireMoves = [...carriedMoves, ...following]
  const own = ownLabelMoves(follow.design, source, carried.sort.alone, carry?.offset ?? ZERO, follow.locked, plan.skipped)
  const names = changedNames(carried.outcomes, new Set(following.map((move) => move.line.id)))
  const labels = [...labelNames(follow.design, labelsTaken(carried)), ...own.names]
  const nothingMoved = plan.edits.length === 0 && wireMoves.length === 0 && own.edits.length === 0
  const notes = [...carryNotes([...carried.outcomes, ...carried.riding], plan.skipped, nothingMoved), ...own.notes]
  const lines = wireMoves.map((move) => move.line)
  if (wireMoves.length === 0 && own.edits.length === 0 && names.length + labels.length + notes.length === 0) return { plan, lines, labels: own.shown }
  const summary = carry && names.length + labels.length > 0 ? carriedSummary(plan.parts, names, labels, carry.offset) : plan.summary
  const edits = [...plan.edits, ...wireMoves.flatMap((move) => move.edits), ...own.edits]
  return { plan: { ...plan, edits, summary, skipped: [...plan.skipped, ...notes] }, lines, labels: own.shown }
}

/** The plan with the wires its moves take along (withMovedWires), without the shapes. */
export function withFollowingWires(plan: GroupEdit, source: SourceCircuit, follow: WireFollow | undefined, carry?: Carry): GroupEdit {
  return withMovedWires(plan, source, follow, carry).plan
}
