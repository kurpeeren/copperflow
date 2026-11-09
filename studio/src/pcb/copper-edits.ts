// The layout edits the PCB canvas sends for copper: moving tracks and vias (a via drag, the arrow keys), a track's
// reshape, and Delete. Each gives the edits for one history entry, what is left out and why, and the shapes to draw
// until the build that reads them lands. Pure; plain TypeScript with .js imports, so the tests can run it.
import type { LayoutEdit } from "../../../src/core/layout-records.js"
import type { PcbTrack, PcbVia } from "../../../src/engine/pcb.js"
import type { Point } from "./geometry.js"
import { tidyTrack } from "./copper-geometry.js"
import { nameList } from "./group-edits.js"
import { carryPath } from "./wire-geometry.js"

/** The copper as these edits need it. */
export interface CopperRecords {
  tracks: readonly Pick<PcbTrack, "id" | "layer" | "points" | "locked">[]
  vias: readonly Pick<PcbVia, "id" | "at" | "diameter" | "locked">[]
}

/** Whether a point is on a pad's copper on this layer (a track's end there stays when the track moves). */
export type OnPad = (point: Point, layer: PcbTrack["layer"]) => boolean

/** New shapes by id, drawn in place of the records' own until their build lands. */
export interface CopperShapesById {
  tracks: ReadonlyMap<string, readonly Point[]>
  vias: ReadonlyMap<string, Point>
}

export const NO_SHAPES: CopperShapesById = { tracks: new Map(), vias: new Map() }

export interface CopperMove {
  edits: LayoutEdit[]
  shapes: CopperShapesById
  /** Why each record left out was left out: "t0001 is locked". */
  skipped: string[]
}

type Track = CopperRecords["tracks"][number]
type Via = CopperRecords["vias"][number]

const shifted = (p: Point, d: Point): Point => ({ x: p.x + d.x, y: p.y + d.y })
const samePath = (a: readonly Point[], b: readonly Point[]): boolean => a.length === b.length && a.every((p, i) => p.x === b[i]?.x && p.y === b[i]?.y)
const onVia = (via: Via, p: Point): boolean => Math.hypot(p.x - via.at.x, p.y - via.at.y) <= via.diameter / 2

/** The vias that move: those selected, unlocked, with no locked track ending on them. */
function movingVias(records: CopperRecords, ids: ReadonlySet<string>, skipped: string[]): Via[] {
  return records.vias.filter((via) => {
    if (!ids.has(via.id)) return false
    if (via.locked) return void skipped.push(`${via.id} is locked`)
    const ends = (track: Track) => [track.points[0], track.points.at(-1)].some((p) => p !== undefined && onVia(via, p))
    const locked = records.tracks.find((track) => track.locked && ends(track))
    return locked ? void skipped.push(`${via.id} has the locked track ${locked.id} on it`) : true
  })
}

/** A selected track carried whole: an end goes along unless it is on a pad or on a via that stays. */
function carriedTrack(track: Track, delta: Point, vias: readonly Via[], moving: readonly Via[], onPad: OnPad): Point[] {
  const goes = (p: Point) => moving.some((via) => onVia(via, p)) || (!onPad(p, track.layer) && !vias.some((via) => onVia(via, p)))
  const [first, last] = [track.points[0] as Point, track.points.at(-1) as Point]
  return tidyTrack(carryPath(track.points, delta, { start: goes(first), end: goes(last) }))
}

/** An unselected track whose end is on a moving via: that end follows the via. Any other track keeps its own points untouched. */
function followingTrack(track: Track, delta: Point, moving: readonly Via[]): readonly Point[] {
  const last = track.points.length - 1
  const follows = (p: Point, i: number) => (i === 0 || i === last) && moving.some((via) => onVia(via, p))
  if (!track.points.some(follows)) return track.points
  return tidyTrack(track.points.map((p, i) => (follows(p, i) ? shifted(p, delta) : p)))
}

/**
 * Moves the selected tracks and vias by `delta` (mm) in one change: a via moves and the ends of the tracks on it follow;
 * a track moves whole, its ends on pads staying put (a new segment joins them). Locked copper stays, as does a via
 * holding a locked track's end.
 */
export function moveCopper(records: CopperRecords, ids: readonly string[], delta: Point, onPad: OnPad): CopperMove {
  const skipped: string[] = []
  if (delta.x === 0 && delta.y === 0) return { edits: [], shapes: NO_SHAPES, skipped }
  const chosen = new Set(ids)
  const vias = movingVias(records, chosen, skipped)
  const tracks = new Map<string, readonly Point[]>()
  for (const track of records.tracks) {
    if (chosen.has(track.id) && track.locked) skipped.push(`${track.id} is locked`)
    const path = chosen.has(track.id) && !track.locked ? carriedTrack(track, delta, records.vias, vias, onPad) : followingTrack(track, delta, vias)
    if (!samePath(path, track.points) && path.length >= 2) tracks.set(track.id, path)
  }
  const viaShapes = new Map(vias.map((via) => [via.id, shifted(via.at, delta)]))
  const edits: LayoutEdit[] = [
    ...[...viaShapes].map(([id, at]): LayoutEdit => ({ kind: "setVia", id, at })),
    ...[...tracks].map(([id, points]): LayoutEdit => ({ kind: "setTrack", id, points: [...points] })),
  ]
  return { edits, shapes: { tracks, vias: viaShapes }, skipped }
}

/** The edit that gives a track a new path, nothing when the path is the same, or why it cannot change. */
export function reshapeEdit(track: Pick<Track, "id" | "points" | "locked">, path: readonly Point[]): LayoutEdit | { message: string } | undefined {
  if (samePath(path, track.points)) return undefined
  if (track.locked) return { message: `${track.id} is locked` }
  return { kind: "setTrack", id: track.id, points: [...path] }
}

/** Delete: the selected tracks and vias the layout has and that are not locked, in one change. */
export function copperRemoval(records: CopperRecords, ids: readonly string[]): { edits: LayoutEdit[]; removed: string[]; skipped: string[] } {
  const chosen = new Set(ids)
  const items = [...records.tracks.map((t) => ({ ...t, kind: "removeTrack" as const })), ...records.vias.map((v) => ({ ...v, kind: "removeVia" as const }))]
  const picked = items.filter((item) => chosen.has(item.id))
  const going = picked.filter((item) => !item.locked)
  return {
    edits: going.map((item) => ({ kind: item.kind, id: item.id })),
    removed: going.map((item) => item.id),
    skipped: picked.filter((item) => item.locked).map((item) => `${item.id} is locked`),
  }
}

/** Two sets of shapes as one; `later`'s shape of a record wins. */
export function mergeShapes(earlier: CopperShapesById, later: CopperShapesById): CopperShapesById {
  return { tracks: new Map([...earlier.tracks, ...later.tracks]), vias: new Map([...earlier.vias, ...later.vias]) }
}

/** The copper with the shapes in `shapes` in place of its own; the other fields stay. */
export function withShapes<T extends { id: string; points: readonly Point[] }, V extends { id: string; at: Point }>(
  copper: { tracks: readonly T[]; vias: readonly V[] },
  shapes: CopperShapesById,
): { tracks: T[]; vias: V[] } {
  return {
    tracks: copper.tracks.map((track) => {
      const points = shapes.tracks.get(track.id)
      return points ? { ...track, points: [...points] } : track
    }),
    vias: copper.vias.map((via) => {
      const at = shapes.vias.get(via.id)
      return at ? { ...via, at } : via
    }),
  }
}

/** Lock or Unlock on the selected tracks and vias: one change for those not so already, or why there is nothing to do. */
export function copperLock(records: CopperRecords, ids: readonly string[], locked: boolean): { edits: LayoutEdit[]; summary: string } | { message: string } {
  const chosen = new Set(ids)
  const tracks = records.tracks.filter((track) => chosen.has(track.id) && track.locked !== locked)
  const vias = records.vias.filter((via) => chosen.has(via.id) && via.locked !== locked)
  const edits: LayoutEdit[] = [...tracks.map((t): LayoutEdit => ({ kind: "setTrack", id: t.id, locked })), ...vias.map((v): LayoutEdit => ({ kind: "setVia", id: v.id, locked }))]
  if (edits.length === 0) return { message: `The selected copper is already ${locked ? "locked" : "unlocked"}.` }
  return { edits, summary: `${locked ? "Lock" : "Unlock"} ${nameList([...tracks, ...vias].map((item) => item.id))}` }
}
