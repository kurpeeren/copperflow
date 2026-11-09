// Renaming a net from one of its labels in the schematic, as a double click on a label does (spec §7: "on a net
// label it renames the net"). Every trace written to `net.<old name>` is written again to `net.<new name>`, with its
// corners and its other props, in one change; the label's pin and every other pin on the net follow.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Edit, Literal, TraceInfo } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { NetLabel } from "../../../src/engine/schematic.js"
import { nameProblem } from "./label-palette.js"
import type { SourceCircuit } from "./positions.js"
import { pinOfSelector } from "./wire-tool.js"

/** The edits that rename the net, and the name of another net it would join; or why it cannot be renamed here. */
export type LabelRename = { edits: Edit[]; summary: string; joins?: string } | { blocked: string }

const NET_SELECTOR = /^net\.([\w-]+)$/
const HINTS = "schematicRouteHints"

const namesNet = (selector: string | undefined, name: string): boolean => NET_SELECTOR.exec(selector?.trim() ?? "")?.[1] === name

/** Why this trace cannot be written again under the new name, or undefined when it can. */
function traceBlocker(design: Design, trace: TraceInfo, old: string, locked: ReadonlySet<string>): string | undefined {
  const inCode = `rename ${old} in the code`
  if (!trace.editable) return `The trace on line ${trace.line} is read-only (${trace.readonlyReason}); ${inCode}`
  if (trace.parent !== undefined && trace.parent !== "board") return `The trace on line ${trace.line} is inside <${trace.parent}>; ${inCode}`
  const expression = Object.entries(trace.props).some(([key, prop]) => prop.literal === undefined && !(key === HINTS && trace.schematicRouteHints))
  if (expression) return `The trace on line ${trace.line} has an expression; ${inCode}`
  const part = [trace.from, trace.to].flatMap((end) => (end === undefined ? [] : [pinOfSelector(design, end)?.component ?? ""])).find((name) => locked.has(name))
  return part === undefined ? undefined : `${part} is locked`
}

/** The same trace with its net end renamed, keeping its corners and its other literal props. */
function renamed(trace: TraceInfo, old: string, name: string): Edit {
  const end = (selector: string | undefined) => (namesNet(selector, old) ? `net.${name}` : (selector ?? ""))
  const props = Object.entries(trace.props).filter(([key]) => key !== HINTS)
  const literals: Record<string, Literal> = Object.fromEntries(props.map(([key, prop]) => [key, prop.literal as Literal]))
  return {
    kind: "addTrace",
    from: end(trace.from),
    to: end(trace.to),
    ...(props.length > 0 ? { props: literals } : {}),
    ...(trace.schematicRouteHints ? { schematicRouteHints: trace.schematicRouteHints } : {}),
  }
}

/** The names of the nets other than the label's. */
const otherNames = (design: Design, label: NetLabel): string[] => design.circuit.nets.filter((net) => net.id !== label.net).flatMap((net) => net.names)

/**
 * The edits that rename the label's net to `typed`: each trace to the old name removed and added again with the new
 * one. Nothing to do when the name is the same; `joins` names the other net that already has the new name.
 */
export function labelRenameEdits(design: Design, source: SourceCircuit, label: NetLabel, typed: string, locked: ReadonlySet<string>): LabelRename {
  const name = typed.trim()
  const old = label.text
  const problem = nameProblem(name)
  if (problem) return { blocked: problem }
  const summary = `Rename net ${old} to ${name}`
  if (name === old) return { edits: [], summary }
  if (design.circuit.nets.find((net) => net.id === label.net)?.names.includes(name)) return { blocked: `${old} and ${name} already name this net` }
  const traces = source.model.traces.filter((trace) => namesNet(trace.from, old) || namesNet(trace.to, old))
  if (traces.length === 0) return { blocked: `${old} is not written on a trace the Studio can change; rename it in the code` }
  const blocker = traces.map((trace) => traceBlocker(design, trace, old, locked)).find((why) => why !== undefined)
  if (blocker) return { blocked: blocker }
  const removes: Edit[] = traces.map((trace) => ({ kind: "removeTrace", from: trace.from ?? "", to: trace.to ?? "" }))
  const adds = traces.map((trace) => renamed(trace, old, name))
  const joins = otherNames(design, label).includes(name) ? { joins: name } : {}
  return { edits: [...removes, ...adds], summary, ...joins }
}
