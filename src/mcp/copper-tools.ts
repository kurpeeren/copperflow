import { z } from "zod"
import { applyLayoutEdits, resolveCircuit, type LayoutEdit } from "../core/index.js"
import { buildWith, type DesignSource } from "../core/design-source.js"
import type { CopperLayer } from "../core/layout-file.js"
import type { Design } from "../engine/design.js"
import type { Point } from "../engine/model.js"
import { defaultVia, trackWidth, viaSize } from "../engine/rules/track-defaults.js"
import { introducedLines } from "./copper-summary.js"
import { copperAt, findNet, netLabel, type CopperHit } from "./copper-under.js"

const point = z.object({ x: z.number(), y: z.number() })
const layer = z.enum(["top", "bottom", "inner1", "inner2"])
const NETS_SHOWN = 20

export const routeTrackInput = {
  file: z.string().describe("Circuit file path relative to the project root"),
  net: z.string().describe("Net name, e.g. VBUS"),
  layer: layer.describe('Copper layer: "top" or "bottom"'),
  points: z
    .array(point)
    .min(2)
    .max(200)
    .describe("Corners in mm, in order. The first point must be on a pad, track or via of the net; no point may land on another net's copper"),
  width: z.number().positive().optional().describe("Width in mm; default is the net class's width, else the fabrication default"),
}

export const addViaInput = {
  file: z.string().describe("Circuit file path relative to the project root"),
  net: z.string().optional().describe("Net name; by default the net of the copper under the point"),
  at: point.describe("Centre in mm"),
  layers: z.array(layer).min(2).optional().describe('Layers it joins; default ["top", "bottom"]'),
}

export const removeCopperInput = {
  file: z.string().describe("Circuit file path relative to the project root"),
  ids: z.array(z.string().regex(/^[tv]\d+$/, 'a track id such as "t0001" or a via id such as "v0001"')).min(1).max(100),
}

export const ROUTE_TRACK_DESCRIPTION =
  "Draw one track of a net by hand as ONE change: a list of corner points on one layer. It must start on a pad, track or via of the net and may not touch another net's copper. The width comes from the net class unless given. The answer is one line plus any copper violations the change introduced. The program checks clearance; the router comes later. A track cannot start on a locked part's pad."
export const ADD_VIA_DESCRIPTION =
  "Place a via by hand as ONE change. Its net is the net of the pad or track under it unless you give one; its size follows the net class and the fabrication minimum ring."
export const REMOVE_COPPER_DESCRIPTION = "Remove tracks and vias by id (from copper_summary or check_circuit) as ONE change. Locked copper is refused."
export const COPPER_SUMMARY_DESCRIPTION =
  'Summarize the copper: totals, then one line per net (tracks, vias, length in mm, connections still unrouted), then the copper violations counted by rule. At most 60 lines. Call it before and after drawing copper; check_circuit with filter "copper" lists the violations.'

export interface Ports {
  root: string
  engine?: DesignSource
}

const mmText = (n: number) => String(Math.round(n * 1e6) / 1e6)
const at = (p: Point) => `(${mmText(p.x)}, ${mmText(p.y)})`
const nameOf = (net: { id: string; names: string[] }) => net.names[0] ?? net.id

/** The built design of the circuit `file` names. */
export async function buildOf(ports: Ports, file: string): Promise<Design> {
  return buildWith(ports.root, (await resolveCircuit(ports.root, file)).file, ports.engine)
}

function netOrThrow(design: Design, name: string) {
  const net = findNet(design.circuit.nets, name)
  if (net) return net
  const names = design.circuit.nets.map(nameOf)
  const more = names.length > NETS_SHOWN ? ` … and ${names.length - NETS_SHOWN} more` : ""
  throw new Error(`The circuit has no net "${name}". Nets: ${names.slice(0, NETS_SHOWN).join(", ")}${more}`)
}

const describeHit = (design: Design, hit: CopperHit) => `${netLabel(design.circuit.nets, hit.net)} (${hit.kind} ${hit.id})`

/** Applies the edits as one change with the built design for the locks, then lists what the change introduced. */
async function applyCopper(ports: Ports, file: string, before: Design, edits: LayoutEdit[], headline: (created: string[]) => string): Promise<string> {
  const result = await applyLayoutEdits(ports.root, file, edits, { author: "ai", design: before })
  const after = await buildOf(ports, file)
  return [`Change ${result.entry.id}: ${headline(result.created)}`, ...introducedLines(before, after)].join("\n")
}

function checkPoints(design: Design, netId: string, onLayer: CopperLayer, points: readonly Point[], netName: string): void {
  const [first] = points
  if (first && !copperAt(design, first, [onLayer]).some((hit) => hit.net === netId)) {
    throw new Error(`The first point ${at(first)} is not on a pad, track or via of ${netName} on ${onLayer}. Start on copper of the net. Nothing was written.`)
  }
  for (const [index, p] of points.entries()) {
    const other = copperAt(design, p, [onLayer]).find((hit) => hit.net !== netId)
    if (other) throw new Error(`Point ${index + 1} ${at(p)} is on ${describeHit(design, other)}, but the track is on ${netName}. Nothing was written.`)
  }
}

function lengthOf(points: readonly Point[]): number {
  return points.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - (points[i - 1]?.x ?? p.x), p.y - (points[i - 1]?.y ?? p.y))), 0)
}

/** route_track: one track as one change. */
export async function routeTrack(ports: Ports, input: { file: string; net: string; layer: CopperLayer; points: Point[]; width?: number }): Promise<string> {
  const design = await buildOf(ports, input.file)
  const net = netOrThrow(design, input.net)
  checkPoints(design, net.id, input.layer, input.points, nameOf(net))
  const width = input.width ?? trackWidth(design.rules, net)
  const edit: LayoutEdit = { kind: "addTrack", net: nameOf(net), layer: input.layer, width, points: input.points }
  const segments = input.points.length - 1
  const line = () => `routed ${nameOf(net)} on ${input.layer}, ${segments} segment${segments === 1 ? "" : "s"}, ${lengthOf(input.points).toFixed(1)} mm`
  return applyCopper(ports, input.file, design, [edit], line)
}

/** The net of the copper under a via centre; refused when it is not the net asked for. */
function viaNet(design: Design, centre: Point, layers: readonly CopperLayer[], wanted: string | undefined) {
  const hits = copperAt(design, centre, layers)
  if (wanted !== undefined) {
    const named = netOrThrow(design, wanted)
    const clash = hits.find((hit) => hit.net !== named.id)
    if (clash) throw new Error(`The via ${at(centre)} is on ${describeHit(design, clash)}, but it was asked for ${nameOf(named)}. Nothing was written.`)
    return named
  }
  const id = hits.find((hit) => hit.net !== undefined)?.net
  return design.circuit.nets.find((net) => net.id === id)
}

/** add_via: one via as one change. */
export async function addVia(ports: Ports, input: { file: string; net?: string; at: Point; layers?: CopperLayer[] }): Promise<string> {
  const design = await buildOf(ports, input.file)
  const layers = input.layers ?? ["top", "bottom"]
  const net = viaNet(design, input.at, layers, input.net)
  const size = net ? viaSize(design.rules, net) : defaultVia(design.rules)
  const edit: LayoutEdit = { kind: "addVia", ...(net ? { net: nameOf(net) } : {}), at: input.at, drill: size.drill, diameter: size.diameter, ...(input.layers ? { layers } : {}) }
  const on = net ? nameOf(net) : "no net"
  return applyCopper(ports, input.file, design, [edit], ([id]) => `added via ${id} on ${on} at ${at(input.at)}, ${mmText(size.drill)}/${mmText(size.diameter)} mm`)
}

/** remove_copper: tracks and vias by id as one change. */
export async function removeCopper(ports: Ports, input: { file: string; ids: string[] }): Promise<string> {
  const design = await buildOf(ports, input.file)
  const edits: LayoutEdit[] = input.ids.map((id) => (id.startsWith("t") ? { kind: "removeTrack", id } : { kind: "removeVia", id }))
  return applyCopper(ports, input.file, design, edits, () => `removed ${input.ids.join(", ")}`)
}
