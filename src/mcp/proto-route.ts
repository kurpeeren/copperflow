// autoroute on a perfboard or stripboard: the hole-grid router (engine/proto/route.ts) instead of the PCB router, its
// solder runs, links and cuts written as one change by the agent, marked as the router's. Existing records are kept.
import { applyProtoEdits } from "../core/proto-writes.js"
import type { Design } from "../engine/design.js"
import { routeProto, type ProtoRouteReport } from "../engine/proto/route.js"
import { discardReason, type ContentHashes } from "../studio/route-events.js"
import { contentHashes } from "../studio/route-runner.js"
import { buildOf, netOrThrow, type Ports } from "./copper-tools.js"

/** The connections an answer names; the rest are counted. */
const SHOWN = 10

const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`
const bare = (net: string) => net.replace(/^net[.:]/, "")

export interface ProtoScope {
  nets?: string[] | undefined
  parts?: string[] | undefined
  instance?: string | undefined
}

/** The net ids the scope asks for; all when it names none. */
export function protoNets(design: Design, scope: ProtoScope): string[] | undefined {
  if (scope.instance !== undefined) throw new Error("A perfboard or stripboard is routed by nets or parts, not by instance. Nothing was written.")
  if (scope.nets && scope.parts) throw new Error("Give one of nets or parts, or none to route the board. Nothing was written.")
  if (scope.nets) return scope.nets.map((name) => netOrThrow(design, name).id)
  if (!scope.parts) return undefined
  const known = new Set(design.circuit.components.map((component) => component.id))
  const missing = scope.parts.find((part) => !known.has(part))
  if (missing !== undefined) throw new Error(`The circuit has no part ${missing}. Nothing was written.`)
  const parts = new Set(scope.parts)
  return [...new Set(design.pcb.parts.filter((part) => parts.has(part.component)).flatMap((part) => part.pads.flatMap((pad) => (pad.net ? [pad.net] : []))))]
}

/** "Joined 5 of 6 connections: 4 solder runs, 2 links, 3 cuts; not joined: J1.pin1 to J2.pin1 (why)". */
export function protoRoutedLine(report: ProtoRouteReport): string {
  const joined = report.total - report.unrouted.length
  const made = [`${plural(report.drafts.filter((d) => d.t === "solder").length, "solder run")}`, plural(report.links, "link"), plural(report.cuts, "cut")].join(", ")
  const head = `Joined ${joined} of ${plural(report.total, "connection")}: ${made}`
  if (report.unrouted.length === 0) return head
  const shown = report.unrouted.slice(0, SHOWN).map((one) => `${one.from} to ${one.to} on ${bare(one.net)} (${one.reason})`)
  const more = report.unrouted.length > SHOWN ? `, … and ${report.unrouted.length - SHOWN} more` : ""
  return `${head}; not joined: ${shown.join(", ")}${more}`
}

/** The proto findings that are errors after the change, as one line; none when there are none. */
function afterLines(after: Design): string[] {
  const errors = after.violations.filter((v) => v.code.startsWith("proto-") && v.severity === "error")
  if (errors.length === 0) return []
  return [`${plural(errors.length, "board error")} now: ${errors.slice(0, 3).map((v) => v.message).join("; ")}${errors.length > 3 ? "; …" : ""}`]
}

/** Routes a proto board and writes the result as one change; the answer says what was made and what is left. */
export async function protoAutoroute(ports: Ports, file: string, design: Design, scope: ProtoScope, start: ContentHashes): Promise<string> {
  const grid = design.pcb.board?.proto
  if (!grid) throw new Error(`${file} is not a perfboard or stripboard`)
  const nets = protoNets(design, scope)
  const nameOf = (net: string) => design.circuit.nets.find((one) => one.id === net)?.names[0] ?? bare(net)
  const report = routeProto({ grid, parts: design.pcb.parts, records: design.pcb.proto ?? [], ...(nets ? { nets } : {}) }, nameOf)
  if (report.total === 0) return "Nothing to route: every connection in the scope is already joined. Nothing was written."
  const line = protoRoutedLine(report)
  if (report.drafts.length === 0) return `${line}. Nothing was written.`
  const guard = async () => {
    const why = discardReason(start, await contentHashes(ports.root, file))
    if (why !== undefined) throw new Error(`${why}. Nothing was written.`)
  }
  const summary = `Route the ${grid.kind}: ${report.total - report.unrouted.length} of ${report.total} connections`
  const result = await applyProtoEdits(ports.root, file, report.drafts, [], { author: "ai", router: true, summary, guard })
  const tail = `Pictures: render { view: "board", side: "top" | "bottom" }; cut and link lists: export { as: "build" }.`
  try {
    return [`Change ${result.entry.id}: ${line}`, ...afterLines(await buildOf(ports, file)), tail].join("\n")
  } catch (error) {
    return [`Change ${result.entry.id}: ${line}`, `The change was written, but the board could not be re-checked: ${(error as Error).message}`].join("\n")
  }
}

/**
 * remove_copper { nets } or { all } on a proto board: the router's unlocked solder runs and links of those nets, or all
 * of the router's records (cuts too), removed as one change.
 */
export async function protoUnroute(ports: Ports, file: string, design: Design, input: { nets?: string[] | undefined; all?: boolean | undefined }): Promise<string> {
  const ids = new Set(input.nets?.map((name) => netOrThrow(design, name)).flatMap((net) => [...net.names, net.id]) ?? [])
  const ours = (design.pcb.proto ?? []).filter((r) => r.by === "router" && !r.locked)
  const chosen = input.all === true ? ours : ours.filter((r) => r.t !== "cut" && r.net !== undefined && (ids.has(r.net) || ids.has(`net.${r.net}`)))
  if (chosen.length === 0) throw new Error(`${input.all ? "The board has" : `The nets ${input.nets?.join(", ")} have`} no unlocked solder, links or cuts made by the router. Nothing was written.`)
  const count = (t: string, word: string) => plural(chosen.filter((r) => r.t === t).length, word)
  const words = [count("solder", "solder run"), count("link", "link"), ...(input.all ? [count("cut", "cut")] : [])].join(", ")
  const result = await applyProtoEdits(ports.root, file, [], chosen.map((r) => r.id), { author: "ai", summary: `Take back the router's ${words}` })
  return `Change ${result.entry.id}: removed ${words}`
}
