// Saving a new shape for a schematic wire: the edit that writes it (wire-shape.ts), its line in the history, the points
// to draw until the build, and the id the wire has after it. A drag sends the dragged path; a double click on a corner
// handle sends the path without that corner. Both work from the shape shown, which is a new shape still waiting for
// its build when there is one. Pure; only types come from the engine.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { SelectionChange } from "../selection.js"
import type { Point } from "./geometry.js"
import type { SourceCircuit } from "./positions.js"
import { NO_LOCKS } from "./trace-source.js"
import { cornerBlocker, describeWire, WIRE_GONE } from "./wire-actions.js"
import { removeCorner, samePath, tidy, wireBlocker, wireOf, wireShapeEdits, type WireShape } from "./wire-shape.js"
import { pinOfSelector } from "./wire-tool.js"

/** What a wire becomes once its new shape is built: a new trace or not, and its id then, when it can be named. */
export interface ShapeAfter {
  /** The shape adds a trace of its own for a wire Studio drew (a second one before the build would add another). */
  newTrace: boolean
  /** The wire's id after the build. */
  wire?: string
}

/**
 * A new shape ready to send: its edits (none when it is the shape shown) and history line, the points to draw until
 * the build that includes it, and what the wire is then. Or why it cannot be written.
 */
export type WireReshape = ({ edits: Edit[]; summary: string; points: Point[] } & ShapeAfter) | { blocked: string }

/** A shape sent: the wire it reshapes, and what that wire is once the edit is built. */
export type SentShape = { id: string } & ShapeAfter

const TRACE_ON_ITS_WAY = "This wire's new trace is still being built; reshape it again when the build is done"

/**
 * The id of the wire a new trace from pin `from` to pin `to` gets, as the engine names connections
 * (src/engine/traces.ts): `wire:<from>|<to>`, with `#n` after the traces already written between them the same way.
 */
export function newTraceWireId(connections: readonly { from: string; to: string }[], from: string, to: string): string {
  const before = connections.filter((connection) => connection.from === from && connection.to === to).length
  return before === 0 ? `wire:${from}|${to}` : `wire:${from}|${to}#${before + 1}`
}

/** What the wire is once the edit is built: a trace's wire keeps its id; a wire Studio drew becomes a new trace's. */
function after(design: Design, shape: WireShape): ShapeAfter {
  const { writer } = shape
  if (writer.kind !== "engine") return { newTrace: false, wire: shape.id }
  const [from, to] = [pinOfSelector(design, writer.from)?.id, pinOfSelector(design, writer.to)?.id]
  return from && to ? { newTrace: true, wire: newTraceWireId(design.circuit.connections, from, to) } : { newTrace: true }
}

/**
 * Why a wire with a shape on its way cannot take another yet: a wire Studio drew on its own was sent as a new trace, and
 * a second shape before the build would add a second trace. A trace's wire can: its corners are written whole each time.
 */
export function sentBlocker(sent: readonly SentShape[], wireId: string): string | null {
  return sent.some((shape) => shape.id === wireId && shape.newTrace) ? TRACE_ON_ITS_WAY : null
}

/**
 * What a build that started at `builtFrom` (ms) does to the shapes sent: those sent before it are in it and done, the
 * rest keep waiting (`waiting` is `sent` itself when none is done). And the selection change that hands a wire Studio
 * drew on its own, still selected, to its new trace's wire in its place, when the sheet (`drawn`) now has it.
 */
export function shapesBuilt<S extends SentShape & { sentAt: number }>(sent: readonly S[], builtFrom: number, drawn: ReadonlySet<string>): { waiting: readonly S[]; follow: SelectionChange } {
  const done = sent.filter((shape) => shape.sentAt <= builtFrom)
  const waiting = done.length === 0 ? sent : sent.filter((shape) => shape.sentAt > builtFrom)
  const moved = done.filter((shape) => shape.newTrace && shape.wire !== undefined && drawn.has(shape.wire))
  const follow: SelectionChange = (current) => {
    const renamed = current.wires.map((id) => moved.find((shape) => shape.id === id)?.wire ?? id)
    return current.all(current.names, renamed, current.labels)
  }
  return { waiting, follow }
}

/** Why the wire's shape cannot be changed (wire-shape.ts), or null; a wire the sheet no longer draws says so. */
export function reshapeBlocker(design: Design, source: SourceCircuit, wireId: string, locked: ReadonlySet<string> = NO_LOCKS): string | null {
  const shape = wireOf(design, source, wireId)
  return shape ? wireBlocker(design, shape, locked) : WIRE_GONE
}

function reshapeOf(design: Design, shape: WireShape, path: readonly Point[], verb: string, locked: ReadonlySet<string>, shown?: readonly Point[]): WireReshape {
  const edits = wireShapeEdits(design, shape, path, locked, shown)
  if (!Array.isArray(edits)) return edits
  return { edits, summary: `${verb} ${describeWire(design, shape)}`, points: tidy(path), ...after(design, shape) }
}

/**
 * A drag's new shape for the wire, `path` from its first end to its last, written in one edit. `shown` is the shape
 * on the sheet when it is not the built one (a new shape waiting for its build); a path equal to it sends nothing.
 */
export function wireReshape(design: Design, source: SourceCircuit, wireId: string, path: readonly Point[], locked: ReadonlySet<string> = NO_LOCKS, shown?: readonly Point[]): WireReshape {
  const shape = wireOf(design, source, wireId)
  return shape ? reshapeOf(design, shape, path, "reshape", locked, shown) : { blocked: WIRE_GONE }
}

/**
 * A double click on corner `index` of the shape shown (`shown`, else the built one): the wire without that corner,
 * squared again, in one edit. A corner the code does not write (Studio draws the wire, or its elbow) is refused for
 * the reason Remove corners gives; a corner of a new shape waiting for its build is written by that shape's edit.
 */
export function cornerDrop(design: Design, source: SourceCircuit, wireId: string, index: number, locked: ReadonlySet<string> = NO_LOCKS, shown?: readonly Point[]): WireReshape {
  const shape = wireOf(design, source, wireId)
  if (!shape) return { blocked: WIRE_GONE }
  const waiting = shown !== undefined && !samePath(shown, shape.points)
  const refused = waiting ? null : cornerBlocker(design, shape, locked)
  if (refused !== null) return { blocked: refused }
  return reshapeOf(design, shape, removeCorner(shown ?? shape.points, index), "remove a corner of", locked, shown)
}
