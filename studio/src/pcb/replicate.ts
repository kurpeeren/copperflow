// Layout → Replicate layout: one instance's placement and copper copied to the other instances of the same sheet.
// The placement inside a sheet is the sheet's (written relative to the instance), so every instance already shares the
// positions the sheet writes; the parts the sheet leaves to auto-placement get the positions they have in the source
// instance, written into the sheet file. The copper is the circuit's layout file: the source instance's tracks and vias
// are copied into each other instance's frame, their nets mapped port to port and local net to local net, in place of
// the copper the target had there. Pure; the command sends the edits.
import type { LayoutEdit } from "../../../src/core/layout-records.js"
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { Point, SheetInstance } from "../../../src/engine/model.js"
import type { PcbTrack, PcbVia } from "../../../src/engine/pcb.js"
import { instancePart, topInstance } from "./instances.js"

/** How far beyond its parts' courtyards an instance's copper may reach and still be its own, in mm. */
const REACH_MM = 0.5
const round = (value: number): number => Math.round(value * 1000) / 1000 || 0

interface Frame {
  x: number
  y: number
  rotation: number
}

/** Where an instance's block sits: its pcbX/pcbY/pcbRotation (replicatePlan refuses an instance that writes none). */
const frameOf = (instance: SheetInstance): Frame => instance.pcb ?? { x: 0, y: 0, rotation: 0 }

type Box = { minX: number; maxX: number; minY: number; maxY: number }

/** The source's box as it lands in another instance's frame. */
function boxIn(box: Box, from: Frame, to: Frame): Box {
  const corners = [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }].map((p) => toBoard(toLocal(p, from), to))
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

const overlap = (a: Box, b: Box): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY

/**
 * Why the instances cannot take the copy: one has no written place on the board (an unplaced instance sits at the
 * origin, so the copper would land on another instance), or two of them, the source's layout copied in, overlap.
 */
function placeRefusal(design: Design, source: SheetInstance, targets: readonly SheetInstance[], placed: (name: string) => boolean): string | undefined {
  const unplaced = [source, ...targets].filter((instance) => !placed(instance.name)).map((instance) => instance.name)
  if (unplaced.length > 0) return `Place ${unplaced.join(", ")} on the board first (pcbX and pcbY on the instance), then replicate the layout.`
  const box = boxOf(design, source)
  if (!box) return undefined
  const boxes = [source, ...targets].map((instance) => ({ name: instance.name, box: boxIn(box, frameOf(source), frameOf(instance)) }))
  for (const [i, a] of boxes.entries()) {
    const b = boxes.slice(i + 1).find((other) => overlap(a.box, other.box))
    if (b) return `${a.name} and ${b.name} would overlap; place the instances apart first, then replicate the layout.`
  }
  return undefined
}

function turned(p: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180
  const [cos, sin] = Number.isInteger(degrees / 90) ? [[1, 0], [0, 1], [-1, 0], [0, -1]][(((degrees / 90) % 4) + 4) % 4] as [number, number] : [Math.cos(radians), Math.sin(radians)]
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
}

/** A point on the board in an instance's own frame, and back. */
const toLocal = (p: Point, frame: Frame): Point => turned({ x: p.x - frame.x, y: p.y - frame.y }, -frame.rotation)
const toBoard = (p: Point, frame: Frame): Point => {
  const q = turned(p, frame.rotation)
  return { x: round(q.x + frame.x), y: round(q.y + frame.y) }
}

/** Whether an instance writes pcbX and pcbY, as its source element has them (a pcbRotation alone places nothing). */
function written(design: Design, name: string): boolean {
  const props = topInstance(design, name)?.pcb
  return props !== undefined && (props.x !== 0 || props.y !== 0)
}

/** The source instance the selection names: a selected instance symbol, or the instance a selected part is in. */
export function sourceInstance(design: Design | undefined, names: readonly string[]): SheetInstance | undefined {
  for (const name of names) {
    const top = topInstance(design, name) ?? topInstance(design, instancePart(design, name)?.outer ?? "")
    if (top) return top
  }
  return undefined
}

/** The board box round an instance's parts' courtyards, grown by REACH_MM. */
function boxOf(design: Design, instance: SheetInstance) {
  const own = new Set(instance.parts)
  const points = design.pcb.parts.filter((part) => own.has(part.component)).flatMap((part) => part.courtyard)
  if (points.length === 0) return undefined
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { minX: Math.min(...xs) - REACH_MM, maxX: Math.max(...xs) + REACH_MM, minY: Math.min(...ys) - REACH_MM, maxY: Math.max(...ys) + REACH_MM }
}

/** Whether a target's own copper goes: on one of its local nets, or touching pads and only its parts' (not a parent net's track passing over). */
function ownedBy(instance: SheetInstance, net: string | undefined, pads: readonly string[] = []): boolean {
  if (net?.startsWith(`net.${instance.path}/`)) return true
  const own = new Set(instance.parts)
  return pads.length > 0 && pads.every((pad) => own.has(pad.split("#")[0] ?? ""))
}

/** Whether copper is the instance's: on one of its local nets, or every pad it joins is its parts', or all of it lies over its parts. */
function belongs(design: Design, instance: SheetInstance, net: string | undefined, points: readonly Point[], pads: readonly string[] = []): boolean {
  if (net?.startsWith(`net.${instance.path}/`)) return true
  const own = new Set(instance.parts)
  if (pads.length > 0 && pads.every((pad) => own.has(pad.split("#")[0] ?? ""))) return true
  const box = boxOf(design, instance)
  return box !== undefined && points.every((p) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY)
}

/** A part of the source instance as the same part of the target: the target's part with the same local name. */
function samePart(design: Design, part: string, target: SheetInstance): string | undefined {
  const local = instancePart(design, part)?.localId
  return design.circuit.components.find((component) => component.instance === target.path && component.localId === local)?.id
}

/** A net of the source as the target has it: a local net by its name, a port's net by the port, any other net as it is. */
function mapNet(design: Design, net: string | undefined, source: SheetInstance, target: SheetInstance): string | undefined {
  if (net === undefined) return undefined
  if (net.startsWith(`net.${source.path}/`)) return `net.${target.path}/${net.slice(`net.${source.path}/`.length)}`
  if (net.startsWith("net:")) {
    const [part, pin] = net.slice(4).split(".")
    const mapped = part === undefined ? undefined : samePart(design, part, target)
    return mapped && pin ? `net:${mapped}.${pin}` : undefined
  }
  const name = net.replace(/^net\./, "")
  const port = source.ports.find((candidate) => !candidate.bus && candidate.net === name)
  const there = port && target.ports.find((candidate) => candidate.name === port.name)
  return there ? `net.${there.net}` : net
}

/** The relative positions of the source's auto-placed parts, written into the sheet file so every instance has them. */
function placementEdits(design: Design, source: SheetInstance): Edit[] {
  const frame = frameOf(source)
  return design.circuit.components.flatMap((component): Edit[] => {
    if (component.instance !== source.path || component.localId === undefined) return []
    if (typeof component.props["pcbX"] === "number" && typeof component.props["pcbY"] === "number") return []
    const placed = design.pcb.parts.find((part) => part.component === component.id)
    if (!placed) return []
    const at = toLocal(placed, frame)
    const rotation = ((((placed.rotation - frame.rotation) % 360) + 360) % 360)
    const props = { pcbX: round(at.x), pcbY: round(at.y), ...(rotation === 0 ? {} : { pcbRotation: round(rotation) }) }
    return [{ kind: "setProps", part: component.localId, props }]
  })
}

interface CopperIn {
  tracks: readonly PcbTrack[]
  vias: readonly PcbVia[]
}

/** The source's copper in each target's frame, after removing what the target had of its own. */
function copperEdits(design: Design, copper: CopperIn, source: SheetInstance, targets: readonly SheetInstance[]): LayoutEdit[] {
  const tracks = copper.tracks.filter((track) => belongs(design, source, track.net, track.points, track.pads))
  const vias = copper.vias.filter((via) => belongs(design, source, via.net, [via.at]))
  const from = frameOf(source)
  return targets.flatMap((target): LayoutEdit[] => {
    const to = frameOf(target)
    const move = (p: Point) => toBoard(toLocal(p, from), to)
    const named = (net: string | undefined) => {
      const mapped = mapNet(design, net, source, target)
      return mapped === undefined ? {} : { net: mapped }
    }
    const removed: LayoutEdit[] = [
      ...copper.tracks.filter((track) => ownedBy(target, track.net, track.pads)).map((track): LayoutEdit => ({ kind: "removeTrack", id: track.id })),
      ...copper.vias.filter((via) => ownedBy(target, via.net)).map((via): LayoutEdit => ({ kind: "removeVia", id: via.id })),
    ]
    const added: LayoutEdit[] = [
      ...tracks.map((track): LayoutEdit => ({ kind: "addTrack", ...named(track.net), layer: track.layer, width: track.width, points: track.points.map(move) })),
      ...vias.map((via): LayoutEdit => ({ kind: "addVia", ...named(via.net), at: move(via.at), drill: via.drill, diameter: via.diameter, layers: [...via.layers] })),
    ]
    return [...removed, ...added]
  })
}

/** What Replicate layout writes: placement into the sheet file, copper into the layout file; each part may be empty. */
export interface ReplicatePlan {
  source: string
  targets: string[]
  sheet: { file: string; edits: Edit[]; summary: string }
  layout: { edits: LayoutEdit[]; summary: string }
}

/** The plan for the instance the selection names, or a message why there is nothing to do. */
export function replicatePlan(design: Design | undefined, names: readonly string[], placed?: (name: string) => boolean): ReplicatePlan | { message: string } {
  if (!design) return { message: "Wait for the build to finish, then try again." }
  const source = sourceInstance(design, names)
  if (!source) return { message: "Select a part of the instance whose layout to copy, or its symbol on the schematic." }
  const targets = (design.circuit.instances ?? []).filter((instance) => instance.file === source.file && instance.path !== source.path && !instance.path.includes("/"))
  if (targets.length === 0) return { message: `${source.name} is the only instance of ${source.sheet}; there is nothing to copy its layout to.` }
  const refusal = placeRefusal(design, source, targets, placed ?? ((name) => written(design, name)))
  if (refusal) return { message: refusal }
  const names_ = targets.map((target) => target.name).join(", ")
  const sheet = { file: source.file, edits: placementEdits(design, source), summary: `Replicate the placement of ${source.name} in ${source.sheet}` }
  const layout = { edits: copperEdits(design, design.pcb, source, targets), summary: `Replicate the copper of ${source.name} to ${names_}` }
  if (sheet.edits.length === 0 && layout.edits.length === 0) return { message: `${source.name} has no placement or copper the other instances lack.` }
  return { source: source.name, targets: targets.map((target) => target.name), sheet, layout }
}
