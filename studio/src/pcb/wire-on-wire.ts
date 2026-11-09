// A wire Studio routes from a pin to a point on another wire of its net (where the pin had no other way out, say):
// it is written as a trace from the pin to the net, the meeting point being its last corner, as a wire the W tool ends
// on a wire is. The pin's own trace to the net takes the corners when it has none yet; else a new trace is added.
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
}

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

/** The pin's one trace to the net that has no corners and can take them; undefined when there is none such. */
export function bareTrace(design: Design, source: SourceCircuit, pin: Pin, netId: string): TraceInfo | undefined {
  const traces = tracesBetween(design, source, { pin: pin.id }, { net: netNames(design, netId) })
  const [trace] = traces
  if (traces.length !== 1 || !trace || trace.props["schematicRouteHints"]) return undefined
  return traceBlocker(trace) === undefined && repeatBlocker(source, trace) === undefined ? trace : undefined
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
