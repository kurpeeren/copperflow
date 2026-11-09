// A wire Studio routes from a pin to a point on another wire of its net (where the pin had no other way out, say):
// it is written as a trace from the pin to the net, the meeting point being its last corner, as a wire the W tool ends
// on a wire is. The pin's own trace to the net takes the corners when it has none yet; with no such trace a new one is
// added; with several, or one that cannot change, the shape is refused rather than repeating them.
// Pure; only types come from the engine.
import type { Edit, TraceInfo } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { Pin } from "../../../src/engine/model.js"
import type { Point } from "./geometry.js"
import type { SourceCircuit } from "./positions.js"
import { netNames, repeatBlocker, traceBlocker, tracesBetween } from "./trace-source.js"

/** Where a wire Studio routed to a wire of its net starts, and the trace that writes its corners when there is one. */
export interface OnWire {
  /** The pin is the wire's last point; its first is the meeting point. */
  pinLast: boolean
  /** The pin's trace to the net, with no corners yet. */
  trace?: TraceInfo
  /** Why the shape cannot be written: the pin's traces to the net cannot take it, and another would repeat them. */
  blocked?: string
}

const SEVERAL = "The pin of this wire has several traces to its net; change its corners in the code"

const NEAR = 1e-6

/** Whether `p` lies on a segment of `points`. */
function onLine(points: readonly Point[], p: Point): boolean {
  return points.slice(1).some((b, i) => {
    const a = points[i] as Point
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    const within = Math.min(a.x, b.x) - NEAR <= p.x && p.x <= Math.max(a.x, b.x) + NEAR && Math.min(a.y, b.y) - NEAR <= p.y && p.y <= Math.max(a.y, b.y) + NEAR
    return Math.abs(cross) <= NEAR && within
  })
}

/** Whether `p` is on another wire of the net `netId` than `wireId`. */
export function onNetWire(design: Design, wireId: string, netId: string, p: Point): boolean {
  return design.schematic.wires.some((wire) => wire.id !== wireId && wire.net === netId && onLine(wire.points, p))
}

/**
 * Where the pin's corners go: its one trace to the net, when it has no corners and can take them; nowhere yet (a new
 * trace is added) when it has none; else refused, since a further trace would only repeat those already there.
 */
export function pinTrace(design: Design, source: SourceCircuit, pin: Pin, netId: string): Omit<OnWire, "pinLast"> {
  const traces = tracesBetween(design, source, { pin: pin.id }, { net: netNames(design, netId) })
  const [trace] = traces
  if (!trace) return {}
  if (traces.length > 1 || trace.props["schematicRouteHints"]) return { blocked: SEVERAL }
  const blocked = traceBlocker(trace) ?? repeatBlocker(source, trace)
  return blocked === undefined ? { trace } : { blocked }
}

/**
 * The edit that writes `path` (the wire's points, ends unchanged): the corners from the pin to the meeting point, set on
 * the pin's trace (meeting point first when the trace names the net first), or on a new trace from `from` to `to`.
 */
export function onWireEdits(onWire: OnWire, from: string, to: string, path: readonly Point[]): Edit[] {
  const corners = (onWire.pinLast ? [...path].reverse() : [...path]).slice(1)
  const { trace } = onWire
  if (!trace) return [{ kind: "addTrace", from, to, schematicRouteHints: corners }]
  const netFirst = (trace.from ?? "").startsWith("net.")
  return [{ kind: "setTraceHints", from: trace.from ?? "", to: trace.to ?? "", schematicRouteHints: netFirst ? [...corners].reverse() : corners }]
}
