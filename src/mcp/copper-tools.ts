import { z } from "zod"
import { applyLayoutEdits, resolveCircuit, type LayoutEdit } from "../core/index.js"
import { buildWith, type DesignSource } from "../core/design-source.js"
import { boardCopperLayers, type CopperLayer } from "../core/layout-file.js"
import { segmentRemoval } from "../core/track-split.js"
import { copperPieces, padPieces, type CopperPiece } from "../engine/checks/copper-pieces.js"
import type { Shape } from "../engine/checks/geometry.js"
import { copperTouches, trackLength } from "../engine/copper.js"
import type { Design } from "../engine/design.js"
import type { Net, Point } from "../engine/model.js"
import { padPlace } from "../engine/pad-text.js"
import { cornersOf, endsByRef, searchedEdits, sharedLayer } from "./route-by-ref.js"
import { defaultVia, trackWidth, viaSize } from "../engine/rules/track-defaults.js"
import { introducedLines } from "./copper-summary.js"
import { copperAt, findNet, netLabel, type CopperHit } from "./copper-under.js"

const point = z.object({ x: z.number(), y: z.number() })
const layer = z.enum(["top", "bottom", "inner1", "inner2"])
const NETS_SHOWN = 20

const padRef = z.string().min(1)

export const routeTrackInput = {
  file: z.string().describe("Circuit file"),
  net: z.string().optional().describe("Needed with points"),
  layer: layer.optional().describe("Needed with points; inner1, inner2 only on 4 layers"),
  points: z
    .array(point)
    .min(2)
    .max(200)
    .optional()
    .describe("Corners in mm; the first on the net's copper"),
  from: padRef.optional().describe('e.g. "C3.pin2" or "U2.GND"'),
  to: padRef.optional(),
  via: z.array(point).max(200).optional().describe("Corners between from and to; none: the router finds the path"),
  width: z.number().positive().optional().describe("mm; default the net class's"),
}

export const addViaInput = {
  file: z.string().describe("Circuit file"),
  net: z.string().optional(),
  at: point,
  layers: z.array(layer).min(2).optional().describe('Default ["top", "bottom"]'),
}

const copperId = z.string().regex(/^[tv]\d+$/, 'a track id such as "t0001" or a via id such as "v0001"')
const trackSegment = z.object({
  id: z.string().regex(/^t\d+$/, 'a track id such as "t0001"'),
  segment: z.number().int().min(0).describe("0 is the first point to the second"),
})

export const removeCopperInput = {
  file: z.string().describe("Circuit file"),
  ids: z
    .array(z.union([copperId, trackSegment]))
    .min(1)
    .max(100)
    .describe("Ids, or { id, segment }"),
}

export const ROUTE_TRACK_DESCRIPTION =
  "Copper track (not a schematic trace): draw one of a net by hand as ONE change: corners on one layer, or from and to pads (via: corners between; none: the router finds the path or says what is in the way). It starts on the net's copper, not a locked part's pad, and touches no other net. The answer lists copper violations. For what autoroute could not route."
export const ADD_VIA_DESCRIPTION =
  "Place a via by hand as ONE change; its net is that of the copper under it unless given."
export const REMOVE_COPPER_DESCRIPTION =
  "Remove tracks and vias by id (from copper_summary or check_circuit) as ONE change; { id, segment } removes one segment. Locked copper is refused."
export const COPPER_SUMMARY_DESCRIPTION =
  "Summarize the copper in at most 60 lines: totals, per net (tracks, vias, unrouted), pours and holes by id, violations by rule. Call it before and after drawing copper."

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

export interface RouteTrackRequest {
  file: string
  net?: string | undefined
  layer?: CopperLayer | undefined
  points?: Point[] | undefined
  from?: string | undefined
  to?: string | undefined
  via?: Point[] | undefined
  width?: number | undefined
}

/** route_track: one track as one change; by points, or by pad references (route-by-ref). */
export async function routeTrack(ports: Ports, input: RouteTrackRequest): Promise<string> {
  const byRef = input.from !== undefined || input.to !== undefined
  if (byRef && input.points !== undefined) throw new Error("Give points, or from and to (with via points if you like), not both. Nothing was written.")
  if (byRef && (input.from === undefined || input.to === undefined)) throw new Error("Give both from and to, e.g. from: \"C3.pin2\", to: \"U2.pin2\". Nothing was written.")
  const design = await buildOf(ports, input.file)
  if (byRef) return routeByRef(ports, design, input, input.from as string, input.to as string)
  if (input.points === undefined || input.net === undefined || input.layer === undefined) throw new Error("Give net, layer and points, or from and to. Nothing was written.")
  return drawTrack(ports, design, input.file, netOrThrow(design, input.net), input.layer, input.points, input.width)
}

/** One track through the corners, checked, as one change. */
function drawTrack(ports: Ports, design: Design, file: string, net: Net, onLayer: CopperLayer, points: Point[], asked: number | undefined): Promise<string> {
  checkLayers(design, [onLayer])
  checkPoints(design, net.id, onLayer, points, nameOf(net))
  const width = asked ?? trackWidth(design.rules, net)
  checkSegments(design, net.id, onLayer, points, width, nameOf(net))
  const edit: LayoutEdit = { kind: "addTrack", net: nameOf(net), layer: onLayer, width, points }
  const segments = points.length - 1
  const line = () => `routed ${nameOf(net)} on ${onLayer}, ${segments} segment${segments === 1 ? "" : "s"}, ${trackLength(points).toFixed(1)} mm`
  return applyCopper(ports, file, design, [edit], line)
}

/** The track between two named pads: through the via points on one layer, or the router's path when none are given. */
function routeByRef(ports: Ports, design: Design, input: RouteTrackRequest, from: string, to: string): Promise<string> {
  const ends = endsByRef(design, from, to, input.net, (name) => netOrThrow(design, name).id)
  const net = design.circuit.nets.find((one) => one.id === ends.net) as Net
  const between = `${padPlace(ends.from)} to ${padPlace(ends.to)}`
  if (input.via !== undefined && input.via.length > 0) {
    return drawTrack(ports, design, input.file, net, sharedLayer(ends.from, ends.to, input.layer), cornersOf(ends, input.via), input.width)
  }
  if (input.layer !== undefined || input.width !== undefined) throw new Error("layer and width go with via points; without them the router chooses the layers and the net class gives the width. Nothing was written.")
  const edits = searchedEdits(design, ends, nameOf(net))
  const [tracks, vias] = [edits.filter((edit) => edit.kind === "addTrack").length, edits.filter((edit) => edit.kind === "addVia").length]
  const line = () => `routed ${nameOf(net)} ${between}: ${tracks} track${tracks === 1 ? "" : "s"}, ${vias} via${vias === 1 ? "" : "s"}`
  return applyCopper(ports, input.file, design, edits, line)
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
