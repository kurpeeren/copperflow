// A sub-sheet instance as one thing on the board: when it moves (an agent's set_props on its name, the placer moving a
// copy, the Studio moving it), its inner copper moves and turns with it. Inner copper is a track or via of one of the
// instance's nets lying wholly inside the instance's courtyards' bounds. Copper of its nets that leaves those bounds
// (to another block or a connector) is not carried: it is removed, so the connection shows as unrouted again rather
// than as copper left dangling. Locked copper is left as it is and named. An instance that sits on another of its
// sheet (the sheet's positions put copies with no place of their own on top of each other) owns none of the copper
// there: moving it off takes a copy of the other's inner copper with it instead, on its own nets.
import type { Design } from "../engine/design.js"
import type { Point, SheetInstance } from "../engine/model.js"
import { naturalCompare } from "../engine/order.js"
import { nextLayoutId, type LayoutDoc, type LayoutPoint, type LayoutRecord } from "./layout-file.js"

export interface Frame {
  x: number
  y: number
  rotation: number
}

/** An instance (by path) going to a new frame on the board. */
export interface InstanceMove {
  instance: string
  to: Frame
}

export interface CarriedCopper {
  doc: LayoutDoc
  /** Tracks and vias moved (or copied) with their instance. */
  carried: number
  /** Tracks and vias removed because they left a moved instance. */
  removed: number
  notes: string[]
}

interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Copper this close outside the courtyards' bounds is still inside, in mm (a track's end on a pad at the edge). */
const SLACK = 0.05
const SAME = 1e-6

const frameOf = (instance: SheetInstance): Frame => instance.pcb ?? { x: 0, y: 0, rotation: 0 }
const sameFrame = (a: Frame, b: Frame) => Math.abs(a.x - b.x) < SAME && Math.abs(a.y - b.y) < SAME && Math.abs(a.rotation - b.rotation) < SAME
const round = (v: number) => Math.round(v * 1e6) / 1e6 || 0

function turned(p: Point, degrees: number): Point {
  const r = (degrees * Math.PI) / 180
  const quarter = degrees / 90
  if (Number.isInteger(quarter)) {
    const [cos, sin] = ([[1, 0], [0, 1], [-1, 0], [0, -1]] as const)[((quarter % 4) + 4) % 4] as readonly [number, number]
    return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
  }
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) }
}

/** A board point in frame `from` taken to the same place in frame `to`. */
function carry(p: LayoutPoint, from: Frame, to: Frame): LayoutPoint {
  const local = turned({ x: p.x - from.x, y: p.y - from.y }, -from.rotation)
  const q = turned(local, to.rotation)
  return { x: round(q.x + to.x), y: round(q.y + to.y) }
}

interface Block {
  instance: SheetInstance
  bounds: Bounds
  /** The instance's nets, as the layout records name them ("net.X") and bare. */
  nets: Set<string>
  /** Each net of the instance's pads to the net of the twin pad in another instance of the sheet. */
  twins: (other: SheetInstance) => Map<string, string>
}

const pointsOf = (record: LayoutRecord): LayoutPoint[] => (record.t === "track" ? record.points : [record.at])
const inside = (p: LayoutPoint, b: Bounds) => p.x >= b.minX - SLACK && p.x <= b.maxX + SLACK && p.y >= b.minY - SLACK && p.y <= b.maxY + SLACK

function blockOf(design: Design, instance: SheetInstance): Block {
  const mine = new Set(instance.parts)
  const parts = design.pcb.parts.filter((part) => mine.has(part.component))
  const xs = parts.flatMap((part) => part.courtyard.map((p) => p.x))
  const ys = parts.flatMap((part) => part.courtyard.map((p) => p.y))
  const bounds = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
  const nets = new Set(parts.flatMap((part) => part.pads.flatMap((pad) => (pad.net === undefined ? [] : [pad.net]))))
  const components = new Map(design.circuit.components.map((c) => [c.id, c]))
  const byPart = new Map(design.pcb.parts.map((part) => [part.component, part]))
  const twins = (other: SheetInstance) => {
    const map = new Map<string, string>()
    const theirs = new Map(other.parts.flatMap((id) => {
      const c = components.get(id)
      return c ? [[`${(c.instance ?? "").slice(other.path.length)}|${c.localId ?? c.id}`, id] as const] : []
    }))
    for (const id of instance.parts) {
      const c = components.get(id)
      const twin = c && theirs.get(`${(c.instance ?? "").slice(instance.path.length)}|${c.localId ?? c.id}`)
      const [a, b] = [byPart.get(id), twin === undefined ? undefined : byPart.get(twin)]
      a?.pads.forEach((pad, k) => {
        const net = b?.pads[k]?.net
        if (pad.net !== undefined && net !== undefined) map.set(pad.net, net)
      })
    }
    return map
  }
  return { instance, bounds, nets, twins }
}

/** The net a record carries: the one it names, else the one its copper resolves to in the built design. */
function netOf(record: LayoutRecord, resolved: ReadonlyMap<string, string | undefined>): string | undefined {
  const named = record.net
  if (named !== undefined) return named.startsWith("net.") ? named : `net.${named}`
  const net = resolved.get(record.id)
  return net === undefined ? undefined : net.startsWith("net.") ? net : `net.${net}`
}

const bare = (net: string) => net.replace(/^net\./, "")

/**
 * The layout after moving instances (see the module comment). `design` is the board before the moves; `moves` give each
 * moved instance's new frame. Pure: the same input gives the same records.
 */
export function carriedCopper(design: Design, doc: LayoutDoc, moves: readonly InstanceMove[]): CarriedCopper {
  const instances = design.circuit.instances ?? []
  const byPath = new Map(instances.map((one) => [one.path, one]))
  const moving = new Map(moves.flatMap((move) => {
    const instance = byPath.get(move.instance)
    return instance && !sameFrame(frameOf(instance), move.to) ? [[instance.path, { instance, to: move.to }] as const] : []
  }))
  const result: CarriedCopper = { doc, carried: 0, removed: 0, notes: [] }
  if (moving.size === 0 || doc.records.length === 0) return result
  const resolved = new Map<string, string | undefined>([...design.pcb.tracks.map((t) => [t.id, t.net] as const), ...design.pcb.vias.map((v) => [v.id, v.net] as const)])
  const blocks = new Map([...moving.keys()].map((path) => [path, blockOf(design, byPath.get(path) as SheetInstance)]))
  // An instance stacked on another of its sheet that stays: the copper there is the other's.
  const stackedOn = (instance: SheetInstance) =>
    instances.find((other) => other.file === instance.file && other.path !== instance.path && !other.path.includes("/") && !moving.has(other.path) && sameFrame(frameOf(other), frameOf(instance)))
  const records: LayoutRecord[] = []
  const added: LayoutRecord[] = []
  let next: LayoutDoc = doc
  const fresh = (kind: LayoutRecord["t"]) => {
    const id = nextLayoutId(next, kind)
    next = { ...next, next: { ...next.next, [kind]: next.next[kind] + 1 } }
    return id
  }
  for (const record of doc.records) {
    const net = netOf(record, resolved)
    const points = pointsOf(record)
    let kept: LayoutRecord | undefined = record
    for (const [path, { instance, to }] of moving) {
      const block = blocks.get(path) as Block
      if (net === undefined || !block.nets.has(net) || stackedOn(instance)) continue
      const within = points.filter((p) => inside(p, block.bounds)).length
      if (within === 0) continue
      if (record.locked) {
        result.notes.push(`${record.id} is locked; it was left where it is`)
        break
      }
      if (within < points.length) {
        kept = undefined
        result.removed++
        break
      }
      const from = frameOf(instance)
      kept = record.t === "track" ? { ...record, points: record.points.map((p) => carry(p, from, to)) } : { ...record, at: carry(record.at, from, to) }
      result.carried++
      break
    }
    if (kept) records.push(kept)
  }
  // Copies leaving the instance they sat on take a copy of its inner copper, on their own nets.
  for (const [, { instance, to }] of [...moving].sort(([a], [b]) => naturalCompare(a, b))) {
    const leader = stackedOn(instance)
    if (!leader) continue
    const source = blockOf(design, leader)
    const nets = source.twins(instance)
    for (const record of doc.records) {
      const net = netOf(record, resolved)
      const theirs = net === undefined ? undefined : nets.get(net)
      if (theirs === undefined || !pointsOf(record).every((p) => inside(p, source.bounds))) continue
      const from = frameOf(leader)
      const id = fresh(record.t)
      const named = record.net === undefined ? {} : { net: record.net.startsWith("net.") ? theirs : bare(theirs) }
      added.push(record.t === "track" ? { ...record, id, ...named, points: record.points.map((p) => carry(p, from, to)), locked: false } : { ...record, id, ...named, at: carry(record.at, from, to), locked: false })
      result.carried++
    }
  }
  return { ...result, doc: { ...next, records: [...records, ...added] } }
}
