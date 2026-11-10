import { z } from "zod"
import { applyLayoutEdits, resolveCircuit, type LayoutEdit } from "../core/index.js"
import { buildWith, type DesignSource } from "../core/design-source.js"
import { boardCopperLayers, type CopperLayer } from "../core/layout-file.js"
import { segmentRemoval } from "../core/track-split.js"
import { copperPieces, padPieces, type CopperPiece } from "../engine/checks/copper-pieces.js"
import type { Shape } from "../engine/checks/geometry.js"
import { copperTouches, trackLength } from "../engine/copper.js"
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
  layer: layer.describe('Copper layer: "top" or "bottom"; inner1 and inner2 only on a 4-layer board (they cannot be routed in the Studio)'),
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
  layers: z.array(layer).min(2).optional().describe('Layers it joins; default ["top", "bottom"]; inner layers only on a 4-layer board'),
}

const copperId = z.string().regex(/^[tv]\d+$/, 'a track id such as "t0001" or a via id such as "v0001"')
const trackSegment = z.object({
  id: z.string().regex(/^t\d+$/, 'a track id such as "t0001"'),
  segment: z.number().int().min(0).describe("The segment's index: 0 is from the first point to the second"),
})

export const removeCopperInput = {
  file: z.string().describe("Circuit file path relative to the project root"),
  ids: z
    .array(z.union([copperId, trackSegment]))
    .min(1)
    .max(100)
    .describe('Track and via ids, or { id, segment } to remove one segment of a track: the track keeps the run before it and the run after it becomes a new track'),
}

export const ROUTE_TRACK_DESCRIPTION =
  "Draw one track of a net by hand as ONE change: a list of corner points on one layer. It must start on a pad, track or via of the net, and no corner or segment between corners may touch another net's copper. The width comes from the net class unless given. The answer is one line plus the copper violations the change introduced: new ones and existing ones it made worse (check_circuit with filter \"copper\" lists all). The program checks clearance; route by hand what autoroute reports it could not route. A track cannot start on a locked part's pad."
export const ADD_VIA_DESCRIPTION =
  "Place a via by hand as ONE change. Its net is the net of the pad or track under it unless you give one; its size follows the net class and the fabrication minimum ring."
export const REMOVE_COPPER_DESCRIPTION =
  "Remove tracks and vias by id (from copper_summary or check_circuit) as ONE change; { id, segment } removes only that segment of a track, splitting it into the runs left on either side (a run of one point disappears). Locked copper is refused."
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

/** The bus drawn on the schematic that `name` means, by its full name ("D[0:3]") or its stem ("D"). */
function busNamed(design: Design, name: string) {
  return design.circuit.drawings.find((drawing) => drawing.kind === "bus" && (drawing.name === name || drawing.name.replace(/\[[^\]]*\]$/, "") === name))
}

export function netOrThrow(design: Design, name: string) {
  const net = findNet(design.circuit.nets, name)
  if (net) return net
  const bus = busNamed(design, name)
  if (bus?.kind === "bus") throw new Error(`${name} is a bus (${bus.name}); give its member nets instead: ${bus.members.join(", ")}. Nothing was written.`)
  const names = design.circuit.nets.map(nameOf)
  const more = names.length > NETS_SHOWN ? ` … and ${names.length - NETS_SHOWN} more` : ""
  throw new Error(`The circuit has no net "${name}". Nets: ${names.slice(0, NETS_SHOWN).join(", ")}${more}. Nothing was written.`)
}

const describeHit = (design: Design, hit: CopperHit) => `${netLabel(design.circuit.nets, hit.net)} (${hit.kind} ${hit.id})`

/**
 * Applies the edits as one change with the built design for the locks, then lists what the change introduced. The
 * history entry's summary is made from the edits unless one is given.
 */
export async function applyCopper(ports: Ports, file: string, before: Design, edits: LayoutEdit[], headline: (created: string[]) => string, summary?: string): Promise<string> {
  const result = await applyLayoutEdits(ports.root, file, edits, { author: "ai", design: before, ...(summary === undefined ? {} : { summary }) })
  const head = `Change ${result.entry.id}: ${headline(result.created)}`
  try {
    return [head, ...introducedLines(before, await buildOf(ports, file))].join("\n")
  } catch (error) {
    return `${head}\nThe change was written, but the copper could not be re-checked: ${(error as Error).message}`
  }
}

/** Refuses copper on a layer the board does not have, before anything is written. */
function checkLayers(design: Design, layers: readonly CopperLayer[]): void {
  const count = design.circuit.board?.layers ?? 2
  const has = boardCopperLayers(count)
  const missing = layers.find((one) => !has.includes(one))
  if (missing !== undefined) throw new Error(`The board has ${count} layers (${has.join(", ")}), so there is no ${missing}. Nothing was written.`)
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

/** The other nets' copper (and copper on no net) on the layer: pads, tracks and vias as the copper checks measure them. */
function foreignCopper(design: Design, netId: string, onLayer: CopperLayer): CopperPiece[] {
  const anyClass = () => ""
  return [...padPieces(design.pcb, anyClass), ...copperPieces(design.pcb, anyClass)].filter((piece) => piece.net !== netId && piece.layers.includes(onLayer))
}

/** Refuses a segment whose copper (the centre line grown by half the width) touches another net's copper. */
function checkSegments(design: Design, netId: string, onLayer: CopperLayer, points: readonly Point[], width: number, netName: string): void {
  const others = foreignCopper(design, netId, onLayer)
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1] as Point, points[i] as Point]
    const segment: Shape = { core: [a, b], radius: width / 2 }
    const hit = others.find((piece) => piece.shapes.some((shape) => copperTouches(segment, shape)))
    if (hit) {
      const what = `${netLabel(design.circuit.nets, hit.net)} (${hit.kind} ${hit.id})`
      throw new Error(`Segment ${i} ${at(a)}–${at(b)} crosses ${what}, but the track is on ${netName}. Nothing was written.`)
    }
  }
}

/** route_track: one track as one change. */
export async function routeTrack(ports: Ports, input: { file: string; net: string; layer: CopperLayer; points: Point[]; width?: number }): Promise<string> {
  const design = await buildOf(ports, input.file)
  const net = netOrThrow(design, input.net)
  checkLayers(design, [input.layer])
  checkPoints(design, net.id, input.layer, input.points, nameOf(net))
  const width = input.width ?? trackWidth(design.rules, net)
  checkSegments(design, net.id, input.layer, input.points, width, nameOf(net))
  const edit: LayoutEdit = { kind: "addTrack", net: nameOf(net), layer: input.layer, width, points: input.points }
  const segments = input.points.length - 1
  const line = () => `routed ${nameOf(net)} on ${input.layer}, ${segments} segment${segments === 1 ? "" : "s"}, ${trackLength(input.points).toFixed(1)} mm`
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
  const nets = [...new Set(hits.flatMap((hit) => (hit.net === undefined ? [] : [hit.net])))]
  if (nets.length > 1) throw new Error(`The via ${at(centre)} is on copper of ${nets.map((id) => netLabel(design.circuit.nets, id)).join(" and ")}; give the net or move it. Nothing was written.`)
  const id = nets[0]
  return design.circuit.nets.find((net) => net.id === id)
}

/** add_via: one via as one change. */
export async function addVia(ports: Ports, input: { file: string; net?: string; at: Point; layers?: CopperLayer[] }): Promise<string> {
  const design = await buildOf(ports, input.file)
  const layers = input.layers ?? ["top", "bottom"]
  checkLayers(design, layers)
  const net = viaNet(design, input.at, layers, input.net)
  const size = net ? viaSize(design.rules, net) : defaultVia(design.rules)
  const edit: LayoutEdit = { kind: "addVia", ...(net ? { net: nameOf(net) } : {}), at: input.at, drill: size.drill, diameter: size.diameter, ...(input.layers ? { layers } : {}) }
  const on = net ? nameOf(net) : "no net"
  return applyCopper(ports, input.file, design, [edit], ([id]) => `added via ${id} on ${on} at ${at(input.at)}, ${mmText(size.drill)}/${mmText(size.diameter)} mm`)
}

/** What remove_copper takes away: a track or via by id, or one segment of a track. */
export type CopperRemoval = string | { id: string; segment: number }

/** The edits that remove one item; a segment's split is worked out from the track as built (segmentRemoval). */
function removalEdits(design: Design, item: CopperRemoval): LayoutEdit[] {
  if (typeof item === "string") return [item.startsWith("t") ? { kind: "removeTrack", id: item } : { kind: "removeVia", id: item }]
  const track = design.pcb.tracks.find((one) => one.id === item.id)
  if (!track) throw new Error(`No track ${item.id} in the layout file. Nothing was written.`)
  const nets = { ...(track.named === undefined ? {} : { net: track.named }), ...(track.net === undefined ? {} : { carried: track.net }) }
  const split = segmentRemoval({ id: track.id, ...nets, layer: track.layer, width: track.width, points: track.points, locked: track.locked }, item.segment)
  if ("message" in split) throw new Error(`${split.message}. Nothing was written.`)
  return split.edits
}

const trackOf = (item: CopperRemoval): string | undefined => (typeof item === "string" ? (item.startsWith("t") ? item : undefined) : item.id)

/**
 * Refuses a track named more than once in one call when a segment of it is among them: each split is worked out from
 * the track as built, so a second one would undo the first.
 */
function refuseSplitTwice(items: readonly CopperRemoval[]): void {
  const segmented = new Set(items.flatMap((item) => (typeof item === "string" ? [] : [item.id])))
  const twice = [...segmented].find((id) => items.filter((item) => trackOf(item) === id).length > 1)
  if (twice !== undefined) throw new Error(`${twice} is named more than once: remove one segment per track per call, and not with the whole track. Nothing was written.`)
}

const removedWord = (item: CopperRemoval): string => (typeof item === "string" ? item : `segment ${item.segment} of ${item.id}`)

/** remove_copper: tracks and vias by id, and segments of tracks, as one change. */
export async function removeCopper(ports: Ports, input: { file: string; ids: CopperRemoval[] }): Promise<string> {
  refuseSplitTwice(input.ids)
  const design = await buildOf(ports, input.file)
  const edits = input.ids.flatMap((item) => removalEdits(design, item))
  return applyCopper(ports, input.file, design, edits, () => `removed ${input.ids.map(removedWord).join(", ")}`)
}
