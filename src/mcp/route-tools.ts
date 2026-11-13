// The agent's router tools. autoroute runs the same router as the Studio's Route → Autoroute, in this process and
// within a time budget, and writes its copper through the same core path: one history entry (author ai, records by the
// router), no track starting on a locked part's pad, hand copper an obstacle. The MCP server and the Studio are
// separate processes, so a Studio run on the same board cannot be seen from here; instead the files a build reads are
// hashed before routing and again inside the write queue, and a change in between (the Studio's own write, a hand edit)
// discards the result, as the Studio does with its own runs. unroute takes back only the router's unlocked copper.
import { z } from "zod"
import { applyLayoutEdits, resolveCircuit } from "../core/index.js"
import { unrouteEdits, unrouteSummary, type UnrouteTrack } from "../core/unroute.js"
import { lockedPartsAt, lockedStart } from "../core/layout-locks.js"
import type { Design } from "../engine/design.js"
import { findInstance, routeBoard, type RouteReport, type RouteScope, type UnroutedConnection } from "../engine/router/route-board.js"
import { connectionPlace, padsById } from "../engine/pad-text.js"
import { pourMadeText } from "../engine/pour/joins.js"
import type { WorldPad } from "../engine/pcb.js"
import { discardReason, routeSummary } from "../studio/route-events.js"
import { contentHashes, lockSafeEdits, routeInput } from "../studio/route-runner.js"
import { routeHosted } from "../studio/heavy-runs.js"
import { introducedLines } from "./copper-summary.js"
import { applyCopper, buildOf, netOrThrow, type Ports } from "./copper-tools.js"

/** The time autoroute may take by default, in seconds. */
export const DEFAULT_BUDGET_SECONDS = 20
const MAX_BUDGET_SECONDS = 300
/** The unrouted connections an answer names; the rest are counted. */
const UNROUTED_SHOWN = 10

const names = z.array(z.string().min(1)).min(1).max(200)

export const autorouteInput = {
  file: z.string().describe("Circuit file, e.g. index.circuit.tsx"),
  nets: names.optional().describe('Route only these nets, e.g. ["VBUS", "GND"]'),
  parts: names.optional().describe('Route only the connections of these parts, e.g. ["U1", "C3"]'),
  instance: z.string().min(1).optional().describe('Route only the connections inside this sub-sheet instance, e.g. "PS1"; the route is copied to the other instances of its sheet placed the same way'),
  budgetSeconds: z.number().positive().max(MAX_BUDGET_SECONDS).optional().describe(`The time the router may take; ${DEFAULT_BUDGET_SECONDS} s by default. When it runs out, what is routed is written and the rest is reported`),
}

export const unrouteInput = {
  file: z.string().describe("Circuit file, e.g. index.circuit.tsx"),
  nets: names.optional().describe("Remove the router's copper of these nets"),
  all: z.boolean().optional().describe("true: remove all of the router's copper"),
}

export const AUTOROUTE_DESCRIPTION =
  "Route the copper with copperflow's router as ONE change: the connections still unrouted on the whole board, or only those of some nets, of some parts or inside one sub-sheet instance (give at most one of these). Run it after the parts are placed. Existing copper is kept, and no track starts on a locked part's pad. It writes only connections it routed whole and names each one it could not, with the reason. Route those by hand with route_track, or move parts and run it again; then check_circuit."
export const UNROUTE_DESCRIPTION =
  "Remove the copper the router made, for some nets or all of it, as ONE change. Hand-drawn copper, locked copper and router tracks that start on a locked part's pad stay; the answer names those it left."

const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`

/** The scope the arguments ask for, checked against the circuit; at most one of nets, parts and instance. */
function scopeOf(design: Design, input: { nets?: string[] | undefined; parts?: string[] | undefined; instance?: string | undefined }): RouteScope {
  const given = [input.nets, input.parts, input.instance].filter((one) => one !== undefined).length
  if (given > 1) throw new Error("Give one of nets, parts or instance, or none to route the board. Nothing was written.")
  if (input.nets) return { kind: "nets", nets: input.nets.map((name) => netOrThrow(design, name).id) }
  if (input.parts) {
    const known = new Set(design.circuit.components.map((component) => component.id))
    const missing = input.parts.find((part) => !known.has(part))
    if (missing !== undefined) throw new Error(`The circuit has no part ${missing}. Nothing was written.`)
    return { kind: "parts", parts: input.parts }
  }
  if (input.instance !== undefined) {
    if (!findInstance(design.circuit.instances, input.instance)) throw new Error(`The circuit has no sub-sheet instance ${input.instance}. Nothing was written.`)
    return { kind: "instance", instance: input.instance }
  }
  return { kind: "all" }
}

/**
 * "U1.pin3 to R1.pin2 (no room between U1 and C3)": the router's reason without its "could not route" head. Given the
 * pads, the ends say where they are: "U1.pin3 (1.00, 2.00 top) to R1.pin2 (4.00, 2.00 top) (no room …)".
 */
export function unroutedText(one: UnroutedConnection, pads?: ReadonlyMap<string, WorldPad>): string {
  const found = /^could not route (.+?): (.+)$/.exec(one.reason)
  if (pads !== undefined) return `${connectionPlace(pads, one)} (${found ? found[2] : one.reason})`
  return found ? `${found[1]} (${found[2]})` : `${one.from} to ${one.to} (${one.reason})`
}

/** "Routed 30 of 32 connections in 2 passes; unrouted: U1.pin3 to R1.pin2 (no room between U1 and C3), …" */
export function routedLine(report: Pick<RouteReport, "routed" | "unrouted" | "passes">, pads?: ReadonlyMap<string, WorldPad>): string {
  const total = report.routed.length + report.unrouted.length
  const head = `Routed ${report.routed.length} of ${plural(total, "connection")} in ${plural(report.passes, "pass", "passes")}`
  if (report.unrouted.length === 0) return head
  const shown = report.unrouted.slice(0, UNROUTED_SHOWN).map((one) => unroutedText(one, pads))
  const more = report.unrouted.length > UNROUTED_SHOWN ? `, … and ${report.unrouted.length - UNROUTED_SHOWN} more` : ""
  return `${head}; unrouted: ${shown.join(", ")}${more}`
}

/** Whether a net id is one of the scope's: named by the scope, or on a pad of a part it covers. */
function netInScope(design: Pick<Design, "pcb" | "circuit">, scope: RouteScope, net: string): boolean {
  const bare = (id: string) => id.replace(/^net[.:]/, "")
  if (scope.kind === "all") return true
  if (scope.kind === "nets") return scope.nets.some((one) => bare(one) === bare(net))
  const parts = new Set(scope.kind === "parts" ? scope.parts : (findInstance(design.circuit.instances, scope.instance)?.parts ?? []))
  return design.pcb.parts.some((part) => parts.has(part.component) && part.pads.some((pad) => pad.net === net))
}

/**
 * The routed line, with how many connections the board's pours make on the nets in scope, when they make any: the
 * router is not given those connections, which is why its total is smaller than the count before the pour was added.
 * The number is the one check_circuit gives (`PcbLayout.pourMade`).
 */
export function withPourNote(line: string, design: Pick<Design, "pcb" | "circuit">, scope: RouteScope = { kind: "all" }): string {
  const made = pourMadeText((design.pcb.pourMade ?? []).filter((one) => netInScope(design, scope, one.net)))
  return made === undefined ? line : `${line}; ${made}`
}

/** The lines after the first: the budget and the cleanup, when they cut the run short. */
function notes(report: RouteReport, budgetSeconds: number): string[] {
  return [
    ...(report.budgetSpent ? [`Stopped at the ${budgetSeconds} s time budget; run autoroute again (with a larger budgetSeconds) to route the rest.`] : []),
    ...(report.cleanupCapped ? ["The cleanup stopped at its pass cap: the routes are clear, maybe not at their shortest."] : []),
    ...(report.cleanupSkipped ? ["The cleanup was skipped because the budget was spent: the routes are clear, maybe not at their shortest."] : []),
  ]
}

/** autoroute: routes in this process within the budget and writes the routed connections as one change. */
/** The budget asked for, held to 300 s; refused unless it is more than 0. */
export function budgetOf(asked: number | undefined): number {
  if (asked === undefined) return DEFAULT_BUDGET_SECONDS
  if (!(asked > 0)) throw new Error(`budgetSeconds must be more than 0 (it was ${asked}). Nothing was written.`)
  return Math.min(asked, MAX_BUDGET_SECONDS)
}

export interface AutorouteOptions {
  /** The clock the budget is measured on, in ms (the router's own by default); tests pass their own. */
  clock?: () => number
  /** The hosted worker path; tests swap it. */
  routeHosted?: typeof routeHosted
}

export async function autoroute(ports: Ports, input: { file: string; nets?: string[] | undefined; parts?: string[] | undefined; instance?: string | undefined; budgetSeconds?: number | undefined }, options: AutorouteOptions = {}): Promise<string> {
  const budgetSeconds = budgetOf(input.budgetSeconds)
  const circuit = await resolveCircuit(ports.root, input.file)
  if (!circuit.file.endsWith(".circuit.tsx")) throw new Error(`${circuit.file} is a sub-sheet; route the board of the circuit that uses it. Nothing was written.`)
  const start = await contentHashes(ports.root, circuit.file)
  const design = await buildOf(ports, circuit.file)
  const scope = scopeOf(design, input)
  // Hosted: in a worker with a hard cut, holding the workspace's one routing-or-placement slot (heavy-runs.ts).
  const report = ports.hosted
    ? await (options.routeHosted ?? routeHosted)({ input: routeInput(design), scope, budgetMs: budgetSeconds * 1000 })
    : routeBoard(routeInput(design), { scope, budgetMs: budgetSeconds * 1000, ...(options.clock ? { clock: options.clock } : {}) })
  const total = report.routed.length + report.unrouted.length
  if (total === 0) return "Nothing to route: every connection in the scope is already routed. Nothing was written."
  const line = withPourNote(routedLine(report, padsById(design.pcb)), design, scope)
  if (report.edits.length === 0) return [`${line}. Nothing was written.`, ...notes(report, budgetSeconds)].join("\n")
  // The locks are read in the write queue, after the guard: a part locked while the board was routed is honoured.
  const edits = () => lockSafeEdits(circuit.path, design, report.edits)
  const guard = async () => {
    const why = discardReason(start, await contentHashes(ports.root, circuit.file))
    if (why !== undefined) throw new Error(`${why}. Nothing was written.`)
  }
  const result = await applyLayoutEdits(ports.root, circuit.file, edits, { author: "ai", router: true, summary: routeSummary(scope, report.routed.length, total), design, guard })
  const head = [`Change ${result.entry.id}: ${line}`, ...notes(report, budgetSeconds)]
  try {
    return [...head, ...introducedLines(design, await buildOf(ports, circuit.file))].join("\n")
  } catch (error) {
    return [...head, `The change was written, but the copper could not be re-checked: ${(error as Error).message}`].join("\n")
  }
}

/** The ids of the copper on the nets named. */
function copperOfNets(design: Design, nets: readonly string[]): string[] {
  const ids = new Set(nets.map((name) => netOrThrow(design, name).id))
  return [...design.pcb.tracks, ...design.pcb.vias].filter((one) => one.net !== undefined && ids.has(one.net)).map((one) => one.id)
}

/** unroute: the router's unlocked copper of some nets, or all of it, removed as one change. */
export async function unroute(ports: Ports, input: { file: string; nets?: string[] | undefined; all?: boolean | undefined }): Promise<string> {
  if ((input.nets === undefined) === (input.all !== true)) throw new Error("Give nets or all: true (not both). Nothing was written.")
  const circuit = await resolveCircuit(ports.root, input.file)
  const design = await buildOf(ports, circuit.file)
  const ids = input.nets ? copperOfNets(design, input.nets) : undefined
  const locked = await lockedPartsAt(circuit.path)
  const startsOn = locked.size === 0 ? undefined : lockedStart(locked, design)
  const lockedPart = startsOn && ((track: UnrouteTrack) => startsOn({ t: "track", id: track.id, layer: track.layer, width: 1, points: [...track.points], locked: track.locked, by: track.by }))
  const { edits, skipped, kept } = unrouteEdits({ tracks: design.pcb.tracks, vias: design.pcb.vias }, { ...(ids ? { ids } : {}), ...(lockedPart ? { lockedPart } : {}) })
  if (edits.length === 0) {
    const none = input.nets ? `The nets ${input.nets.join(", ")} have no unlocked router copper to remove` : "The board has no unlocked router copper to remove"
    throw new Error(`${none}${skipped.length === 0 ? "" : `: ${skipped.join("; ")}`}. Nothing was written.`)
  }
  const summary = unrouteSummary(edits, skipped, kept.length)
  // The entry's summary is cut at 200 characters; the answer names every record left.
  const held = kept.length === 0 ? "" : `; kept ${plural(kept.length, "via")} a track not made by the router touches (${kept.join(", ")})`
  const headline = summary.endsWith("…") ? `${unrouteSummary(edits)}${skipped.length === 0 ? "" : `; left ${skipped.join("; ")}`}${held}` : summary
  return applyCopper(ports, circuit.file, design, edits, () => headline, summary)
}
