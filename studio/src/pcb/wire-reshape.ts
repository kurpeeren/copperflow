// Saving a new shape for a schematic wire: the edit that writes it (wire-shape.ts), its line in the history, the points
// to draw until the build, and the id the wire has after it. A drag sends the dragged path; a double click on a corner
// handle sends the path without that corner. Pure; only types come from the engine.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { SelectionChange } from "../selection.js"
import type { Point } from "./geometry.js"
import type { SourceCircuit } from "./positions.js"
import { describeWire, WIRE_GONE } from "./wire-actions.js"
import { removeCorner, tidy, wireBlocker, wireOf, wireShapeEdits, type WireShape } from "./wire-shape.js"
import { pinOfSelector } from "./wire-tool.js"

/**
 * A new shape ready to send: its edits (none when the shape did not change) and history line, the points to draw until
 * the build that includes it, and the id the wire has then. Or why it cannot be written.
 */
export type WireReshape = { edits: Edit[]; summary: string; points: Point[]; wire: string } | { blocked: string }

const NO_LOCKS: ReadonlySet<string> = new Set()

/**
 * The wire's id once the edit is built. A trace's wire keeps its id; a wire Studio drew on its own becomes the new
 * trace's, which the engine names `wire:<from pin>|<to pin>` after the connection (src/engine/traces.ts).
 */
function idAfter(design: Design, shape: WireShape): string {
  const { writer } = shape
  if (writer.kind !== "engine") return shape.id
  const [from, to] = [pinOfSelector(design, writer.from)?.id, pinOfSelector(design, writer.to)?.id]
  return from && to ? `wire:${from}|${to}` : shape.id
}

function reshapeOf(design: Design, shape: WireShape, path: readonly Point[], verb: string, locked: ReadonlySet<string>): WireReshape {
  const edits = wireShapeEdits(design, shape, path, locked)
  if (!Array.isArray(edits)) return edits
  return { edits, summary: `${verb} ${describeWire(design, shape)}`, points: tidy(path), wire: idAfter(design, shape) }
}

/** A shape sent: the wire it reshapes, and the id that wire has once the edit is built. */
export interface SentShape {
  id: string
  wire: string
}

const TRACE_ON_ITS_WAY = "This wire's new trace is still being built; reshape it again when the build is done"

/**
 * Why a wire with a shape on its way cannot take another yet: a wire Studio drew on its own was sent as a new trace, and
 * a second shape before the build would add a second trace. A trace's wire can: its corners are written whole each time.
 */
export function sentBlocker(sent: readonly SentShape[], wireId: string): string | null {
  return sent.some((shape) => shape.id === wireId && shape.wire !== wireId) ? TRACE_ON_ITS_WAY : null
}

/**
 * What a build that started at `builtFrom` (ms) does to the shapes sent: those sent before it are in it and done, the
 * rest keep waiting (`waiting` is `sent` itself when none is done). And the selection change that hands a wire Studio
 * drew on its own, still selected, to its new trace's wire, when the sheet (`drawn`) now has it.
 */
export function shapesBuilt<S extends SentShape & { sentAt: number }>(sent: readonly S[], builtFrom: number, drawn: ReadonlySet<string>): { waiting: readonly S[]; follow: SelectionChange } {
  const done = sent.filter((shape) => shape.sentAt <= builtFrom)
  const waiting = done.length === 0 ? sent : sent.filter((shape) => shape.sentAt > builtFrom)
  const moved = done.filter((shape) => shape.wire !== shape.id && drawn.has(shape.wire))
  const follow: SelectionChange = (current) => {
    const shape = moved.find((candidate) => candidate.id === current.wire)
    return shape ? current.onlyWire(shape.wire) : current
  }
  return { waiting, follow }
}

/** Why the wire's shape cannot be changed (wire-shape.ts), or null; a wire the sheet no longer draws says so. */
export function reshapeBlocker(design: Design, source: SourceCircuit, wireId: string, locked: ReadonlySet<string> = NO_LOCKS): string | null {
  const shape = wireOf(design, source, wireId)
  return shape ? wireBlocker(design, shape, locked) : WIRE_GONE
}

/** A drag's new shape for the wire, `path` from its first end to its last, written in one edit. */
export function wireReshape(design: Design, source: SourceCircuit, wireId: string, path: readonly Point[], locked: ReadonlySet<string> = NO_LOCKS): WireReshape {
  const shape = wireOf(design, source, wireId)
  return shape ? reshapeOf(design, shape, path, "reshape", locked) : { blocked: WIRE_GONE }
}

/** A double click on corner `index` of the wire: the wire without that corner, squared again, in one edit. */
export function cornerDrop(design: Design, source: SourceCircuit, wireId: string, index: number, locked: ReadonlySet<string> = NO_LOCKS): WireReshape {
  const shape = wireOf(design, source, wireId)
  return shape ? reshapeOf(design, shape, removeCorner(shape.points, index), "remove a corner of", locked) : { blocked: WIRE_GONE }
}
