// Finding the source trace behind a schematic wire or label, and wording why it cannot be changed.
// Label drag and wire shapes both rely on these. Only types come from the engine.
import type { TraceInfo } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { SourceCircuit } from "./positions.js"
import { pinOfSelector } from "./wire-tool.js"

const NET_SELECTOR = /^net\.([\w-]+)$/

/** What one end of a trace must be: a given pin, or any of the names of a net. */
export type EndMatch = { pin: string } | { net: readonly string[] }

function endMatches(design: Design, selector: string | undefined, end: EndMatch): boolean {
  if ("pin" in end) return selector !== undefined && pinOfSelector(design, selector)?.id === end.pin
  return end.net.includes(NET_SELECTOR.exec(selector?.trim() ?? "")?.[1] ?? "")
}

/** The traces joining the two ends, in either direction, in source order. */
export function tracesBetween(design: Design, source: SourceCircuit, a: EndMatch, b: EndMatch): TraceInfo[] {
  return source.model.traces.filter(
    (t) => (endMatches(design, t.from, a) && endMatches(design, t.to, b)) || (endMatches(design, t.from, b) && endMatches(design, t.to, a)),
  )
}

/** The n-th of the matches when the connection id is a repeat (`<from>|<to>#n`), else the first. */
export function pickRepeat(matches: readonly TraceInfo[], connectionId: string | undefined): TraceInfo | undefined {
  const repeat = Number(/#(\d+)$/.exec(connectionId ?? "")?.[1] ?? 1)
  return matches[repeat - 1] ?? matches[0]
}

/** Why the trace cannot be changed, or undefined when it can. */
export function traceBlocker(trace: TraceInfo): string | undefined {
  if (!trace.editable) return `This wire is read-only (${trace.readonlyReason}); change it in the code`
  if (trace.props["schematicRouteHints"] && !trace.schematicRouteHints) return "The corners of this wire are an expression; change them in the code"
  return undefined
}

/** The first locked part among `components` and the ends of the trace, as `core/edit` would refuse it. */
export function lockedPart(design: Design, components: readonly string[], trace: TraceInfo | undefined, locked: ReadonlySet<string>): string | undefined {
  const ends = [trace?.from, trace?.to].flatMap((end) => (end === undefined ? [] : [pinOfSelector(design, end)?.component ?? ""]))
  return [...components, ...ends].find((name) => locked.has(name))
}
