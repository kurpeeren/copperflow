// What the selected schematic wires' commands do: Delete removes their traces (wiresRemoval, with the parts going
// too), Remove corners empties a trace's corners, Highlight net lights a wire's net, and the Wire section of Properties
// describes one. Each answers with the edit (one history entry) or the reason it cannot run. A wire Studio draws on its
// own has no trace, so it says which net draws it. Pure; only types come from the engine.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import { netLabel } from "../net-rows.js"
import { canonicalNet } from "./highlight.js"
import type { SourceCircuit } from "./positions.js"
import { lockedPart, NO_LOCKS } from "./trace-source.js"
import { wireBlocker, wireOf, type WireShape } from "./wire-shape.js"
import { pinOfSelector } from "./wire-tool.js"

/** The edits of a wire command and its line in the history, or why it cannot run. */
export type WireEdit = { edits: Edit[]; summary: string } | { blocked: string }

/** Why Delete and Remove corners cannot run on a wire; null when they can. */
export interface WireReasons {
  remove: string | null
  removeCorners: string | null
}

/** What the Wire section of Properties shows: the rows, the net its Highlight lights, and why its buttons are off. */
export interface WireProperties extends WireReasons {
  net: string | undefined
  rows: { label: string; value: string }[]
}

/** What a command on a wire the sheet no longer draws says. */
export const WIRE_GONE = "This wire is no longer on the sheet"
const NO_CORNERS = "This wire has no corners"
const STUDIO_CORNER = "Studio draws this wire's corner; the code has none to remove"
const DELETE_REPEAT = "This wire repeats another between the same ends; delete it in the code"

/** The net a wire is on, by its id in `circuit.nets`; undefined when the sheet has no such wire. */
export function wireNet(design: Design, wireId: string): string | undefined {
  const wire = design.schematic.wires.find((candidate) => candidate.id === wireId)
  return wire && canonicalNet(design.circuit.nets, wire.net)
}

/** The net's name as the Net tab shows it. */
function netNameOf(design: Design, wireId: string): string {
  const id = wireNet(design, wireId)
  const net = design.circuit.nets.find((candidate) => candidate.id === id)
  return net ? netLabel(net) : (id ?? "").replace(/^net\./, "")
}

const engineReason = (design: Design, wireId: string): string => `This wire has no trace of its own: Studio draws it for net ${netNameOf(design, wireId)}`

/** A wire end as Properties and the history name it: a pin's id, or `net <name>`. */
const endName = (end: string): string => (end.startsWith("net.") ? `net ${end.slice("net.".length)}` : end)

/** The wire's two ends: a hand-drawn wire's connection as written, a wire Studio draws between two pins. */
function wireEnds(design: Design, shape: WireShape): [string, string] | undefined {
  const { writer } = shape
  if (writer.kind === "engine") return [pinOfSelector(design, writer.from)?.id ?? writer.from, pinOfSelector(design, writer.to)?.id ?? writer.to]
  const wire = design.schematic.wires.find((candidate) => candidate.id === shape.id)
  const connection = design.circuit.connections.find((candidate) => candidate.id === wire?.connection)
  return connection ? [endName(connection.from), endName(connection.to)] : undefined
}

/** How the history names a wire: by its two ends. */
export function describeWire(design: Design, shape: WireShape): string {
  const ends = wireEnds(design, shape)
  return ends ? `the wire from ${ends[0]} to ${ends[1]}` : "the wire"
}

/**
 * Why Delete cannot remove the wire's trace: it has none (Studio draws the wire), a part at an end is locked, it
 * repeats another (core removes the first match), or its code is read-only. Corners written as an expression do not
 * matter here: the whole trace goes.
 */
function removeBlocker(design: Design, shape: WireShape, locked: ReadonlySet<string>): string | null {
  const { writer } = shape
  if (writer.kind === "none") return writer.reason
  if (writer.kind === "engine") return engineReason(design, shape.id)
  const lockedName = lockedPart(design, writer.components, writer.trace, locked)
  if (lockedName !== undefined) return `${lockedName} is locked`
  if (writer.repeat) return DELETE_REPEAT
  return writer.trace.editable ? null : `This wire is read-only (${writer.trace.readonlyReason}); delete it in the code`
}

/**
 * Why the wire's corners cannot be removed: Studio draws the wire or its corner (the code writes none), none to
 * remove, or wire-shape's reasons for changing its corners. Remove corners and a double click on a corner share it.
 */
export function cornerBlocker(design: Design, shape: WireShape, locked: ReadonlySet<string>): string | null {
  if (shape.writer.kind !== "trace") return removeBlocker(design, shape, locked)
  if (shape.points.length <= 2) return NO_CORNERS
  const blocked = wireBlocker(design, shape, locked)
  if (blocked !== null) return blocked
  return (shape.writer.trace.schematicRouteHints?.length ?? 0) > 0 ? null : STUDIO_CORNER
}

/** The trace's `from` and `to` as the code writes them, which is how core finds it. */
function traceEnds(shape: WireShape): { from: string; to: string } {
  const trace = shape.writer.kind === "trace" ? shape.writer.trace : undefined
  return { from: trace?.from ?? "", to: trace?.to ?? "" }
}

function removalFor(design: Design, shape: WireShape, locked: ReadonlySet<string>): WireEdit {
  const blocked = removeBlocker(design, shape, locked)
  if (blocked !== null) return { blocked }
  return { edits: [{ kind: "removeTrace", ...traceEnds(shape) }], summary: `remove ${describeWire(design, shape)}` }
}

function cornerRemovalFor(design: Design, shape: WireShape, locked: ReadonlySet<string>): WireEdit {
  const blocked = cornerBlocker(design, shape, locked)
  if (blocked !== null) return { blocked }
  return { edits: [{ kind: "setTraceHints", ...traceEnds(shape), schematicRouteHints: [] }], summary: `remove the corners of ${describeWire(design, shape)}` }
}

const reasonOf = (result: WireEdit): string | null => ("blocked" in result ? result.blocked : null)

function reasonsFor(design: Design, shape: WireShape, locked: ReadonlySet<string>): WireReasons {
  return { remove: reasonOf(removalFor(design, shape, locked)), removeCorners: reasonOf(cornerRemovalFor(design, shape, locked)) }
}

/** Delete on a selected wire: remove its trace, in one edit. */
export function wireRemoval(design: Design, source: SourceCircuit, wireId: string, locked: ReadonlySet<string> = NO_LOCKS): WireEdit {
  const shape = wireOf(design, source, wireId)
  return shape ? removalFor(design, shape, locked) : { blocked: WIRE_GONE }
}

/**
 * A reason about one wire, said where several things are named: "This wire ..." becomes "The wire from A to B ...",
 * and any other reason is put after the wire's name.
 */
export function namedWireReason(design: Design, shape: WireShape | undefined, reason: string): string {
  const described = shape ? describeWire(design, shape) : "the wire"
  const name = described.charAt(0).toUpperCase() + described.slice(1)
  return reason.startsWith("This wire") ? `${name}${reason.slice("This wire".length)}` : `${name}: ${reason}`
}

/** What Delete does to the selected wires: the edits, the wires they remove (and their names), those left to their parts, and why the rest stay. */
export interface WiresRemoval {
  edits: Edit[]
  removed: string[]
  /** How the history names each wire removed. */
  names: string[]
  /** The wires whose trace ends on a part being removed: the part takes them. */
  withParts: string[]
  skipped: string[]
}

type Refusal = { kind: "skipped"; reason: string; named: string; studio: boolean }
type WireOutcome = { id: string } & ({ kind: "withParts" } | { kind: "removed"; edits: Edit[]; name: string } | Refusal)

/** The parts at a wire's pin ends: from its trace or Studio's pins, else from the connection of a wire whose trace was not found. */
function partsAtEnds(design: Design, shape: WireShape): string[] {
  if (shape.writer.kind !== "none") return shape.writer.components
  const connection = design.circuit.connections.find((candidate) => candidate.id === design.schematic.wires.find((wire) => wire.id === shape.id)?.connection)
  const pins = connection ? [connection.from, connection.to] : []
  return design.circuit.components.filter((component) => component.pins.some((pin) => pins.includes(pin.id))).map((component) => component.id)
}

function wireOutcome(design: Design, source: SourceCircuit, id: string, parts: ReadonlySet<string>, locked: ReadonlySet<string>): WireOutcome {
  const shape = wireOf(design, source, id)
  if (shape && partsAtEnds(design, shape).some((name) => parts.has(name))) return { id, kind: "withParts" }
  const removal = shape ? removalFor(design, shape, locked) : { blocked: WIRE_GONE }
  if ("blocked" in removal) return { id, kind: "skipped", reason: removal.blocked, named: namedWireReason(design, shape, removal.blocked), studio: shape?.writer.kind === "engine" }
  return { id, kind: "removed", edits: removal.edits, name: shape ? describeWire(design, shape) : "the wire" }
}

const studioWires = (count: number): string => `${count} wires have no trace of their own: Studio draws them for their nets`

/** Why the wires that stay were not removed: each named, but the wires Studio draws counted when there are several, and a reason a part already gave left out. */
function refusals(outcomes: readonly WireOutcome[], said: ReadonlySet<string>): string[] {
  const refused = outcomes.flatMap((outcome) => (outcome.kind === "skipped" && !said.has(outcome.reason) ? [outcome] : []))
  const studio = refused.filter((outcome) => outcome.studio)
  const others = refused.filter((outcome) => !outcome.studio).map((outcome) => outcome.named)
  return [...others, ...(studio.length > 1 ? [studioWires(studio.length)] : studio.map((outcome) => outcome.named))]
}

/**
 * Delete on several wires while `parts` are removed with them: each wire's trace goes, in their order, except a wire
 * that ends on one of those parts (core removes a part's traces with it) and a wire that cannot go, which is named,
 * unless its reason is among those already `said` (a locked part's own).
 */
export function wiresRemoval(
  design: Design,
  source: SourceCircuit,
  ids: readonly string[],
  parts: ReadonlySet<string>,
  locked: ReadonlySet<string> = NO_LOCKS,
  said: ReadonlySet<string> = new Set(),
): WiresRemoval {
  const outcomes = ids.map((id) => wireOutcome(design, source, id, parts, locked))
  const removed = outcomes.flatMap((outcome) => (outcome.kind === "removed" ? [outcome] : []))
  return {
    edits: removed.flatMap((outcome) => outcome.edits),
    removed: removed.map((outcome) => outcome.id),
    names: removed.map((outcome) => outcome.name),
    withParts: outcomes.flatMap((outcome) => (outcome.kind === "withParts" ? [outcome.id] : [])),
    skipped: refusals(outcomes, said),
  }
}

/** Remove corners on a selected wire: empty its trace's corners, so Studio draws it with at most one elbow. */
export function cornerRemoval(design: Design, source: SourceCircuit, wireId: string, locked: ReadonlySet<string> = NO_LOCKS): WireEdit {
  const shape = wireOf(design, source, wireId)
  return shape ? cornerRemovalFor(design, shape, locked) : { blocked: WIRE_GONE }
}

/** Why Delete and Remove corners cannot run on the wire, for the context menu and Properties. */
export function wireReasons(design: Design, source: SourceCircuit, wireId: string, locked: ReadonlySet<string> = NO_LOCKS): WireReasons {
  const shape = wireOf(design, source, wireId)
  return shape ? reasonsFor(design, shape, locked) : { remove: WIRE_GONE, removeCorners: WIRE_GONE }
}

function kindOf(shape: WireShape): string {
  if (shape.writer.kind === "trace") return `Trace, line ${shape.writer.trace.line}`
  return shape.writer.kind === "engine" ? "Drawn by Studio on its own" : "Not found in the code"
}

/** The Wire section of Properties: net, ends, corners and kind, and why its buttons are off; undefined for a wire gone. */
export function wireProperties(design: Design, source: SourceCircuit, wireId: string, locked: ReadonlySet<string> = NO_LOCKS): WireProperties | undefined {
  const shape = wireOf(design, source, wireId)
  if (!shape) return undefined
  const [from, to] = wireEnds(design, shape) ?? ["unknown", "unknown"]
  const rows = [
    { label: "Net", value: netNameOf(design, wireId) },
    { label: "From", value: from },
    { label: "To", value: to },
    { label: "Corners", value: String(Math.max(0, shape.points.length - 2)) },
    { label: "Kind", value: kindOf(shape) },
  ]
  return { net: wireNet(design, wireId), rows, ...reasonsFor(design, shape, locked) }
}
