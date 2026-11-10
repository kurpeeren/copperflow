// Route → Unroute and the router's own writes: which copper the router may take back (only what it made, never
// a locked record, never hand-drawn copper), and its new tracks laid so none starts on a locked part's pad (the lock
// rule counts such a track as the locked part's own copper, which no one adds to or changes).
import type { CopperLayer, LayoutMaker, LayoutPoint } from "./layout-file.js"
import type { LayoutEdit } from "./layout-records.js"

/** A track or via as Unroute reads it, from the layout file or the built design. */
export interface UnrouteRecord {
  id: string
  by: LayoutMaker
  locked: boolean
}

/** A track as Unroute reads it: where it starts tells whether a locked part holds it. */
export interface UnrouteTrack extends UnrouteRecord {
  layer: CopperLayer
  points: readonly LayoutPoint[]
  /** With the via's place and size, tells whether the track touches a via. */
  width?: number
}

/** A via as Unroute reads it: where it is and how big tells whether a track touches it. */
export interface UnrouteVia extends UnrouteRecord {
  at?: LayoutPoint
  diameter?: number
}

export interface UnrouteCopper {
  tracks: readonly UnrouteTrack[]
  vias: readonly UnrouteVia[]
}

export interface UnrouteOptions {
  /** Only the records named here. */
  ids?: readonly string[]
  /** The locked part a track starts on, if any: such a track counts as locked (layout-locks.ts lockedStart). */
  lockedPart?: (track: UnrouteTrack) => string | undefined
}

export interface Unroute {
  edits: LayoutEdit[]
  /** Why router copper was left: "t0004 starts on the locked part J1". */
  skipped: string[]
  /** The router's vias left because a track not made by the router touches them (taking them would leave it dangling). */
  kept: string[]
}

const takesBack = (record: UnrouteRecord, ids: ReadonlySet<string> | undefined) => record.by === "router" && !record.locked && (ids === undefined || ids.has(record.id))

/** Closer than this, in mm, is touching. */
const TOUCH_MM = 1e-6

/** The distance from a point to a segment. */
function toSegment(p: LayoutPoint, a: LayoutPoint, b: LayoutPoint): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Whether the track's copper reaches the via's pad (both with their sizes; a via without them touches nothing). */
function touchesVia(track: UnrouteTrack, via: UnrouteVia): boolean {
  if (via.at === undefined || via.diameter === undefined) return false
  const reach = via.diameter / 2 + (track.width ?? 0) / 2 + TOUCH_MM
  const at = via.at
  if (track.points.length === 1) return Math.hypot(track.points[0]!.x - at.x, track.points[0]!.y - at.y) <= reach
  return track.points.some((point, i) => i > 0 && toSegment(at, track.points[i - 1]!, point) <= reach)
}

/**
 * The edits that remove the router's unlocked copper: all of it, or only the records named in `ids`. A track that
 * starts on a locked part's pad is left (the core would refuse its removal) and named in `skipped`; a router via that a
 * track not made by the router touches (a router track reshaped by hand is the editor's) is left and named in `kept`.
 */
export function unrouteEdits(copper: UnrouteCopper, options: UnrouteOptions = {}): Unroute {
  const only = options.ids === undefined ? undefined : new Set(options.ids)
  const skipped: string[] = []
  const tracks = copper.tracks.filter((track) => {
    if (!takesBack(track, only)) return false
    const part = options.lockedPart?.(track)
    if (part !== undefined) skipped.push(`${track.id} starts on the locked part ${part}`)
    return part === undefined
  })
  const others = copper.tracks.filter((track) => track.by !== "router")
  const kept: string[] = []
  const vias = copper.vias.filter((via) => {
    if (!takesBack(via, only)) return false
    const touched = others.some((track) => touchesVia(track, via))
    if (touched) kept.push(via.id)
    return !touched
  })
  const edits = [...tracks.map((track): LayoutEdit => ({ kind: "removeTrack", id: track.id })), ...vias.map((via): LayoutEdit => ({ kind: "removeVia", id: via.id }))]
  return { edits, skipped, kept }
}

const counted = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/**
 * "Unroute: remove 12 tracks and 3 vias the router made; left t0004 (starts on the locked part J1); kept 1 via a track
 * not made by the router touches".
 */
export function unrouteSummary(edits: readonly LayoutEdit[], skipped: readonly string[] = [], kept = 0): string {
  const tracks = edits.filter((edit) => edit.kind === "removeTrack").length
  const vias = edits.filter((edit) => edit.kind === "removeVia").length
  const parts = [...(tracks > 0 ? [counted(tracks, "track")] : []), ...(vias > 0 ? [counted(vias, "via")] : [])]
  const left = skipped.length === 0 ? "" : `; left ${skipped.map((why) => why.replace(/^(\S+) /, "$1 (")).join("), ")})`
  const held = kept === 0 ? "" : `; kept ${counted(kept, "via")} a track not made by the router touches`
  const text = `Unroute: remove ${parts.join(" and ")} the router made${left}${held}`
  return text.length <= 200 ? text : `${text.slice(0, 199)}…`
}

/** Whether a point on a layer lies on a pad of a locked part. */
export type LockedAt = (point: LayoutPoint, layer: CopperLayer) => boolean

/**
 * The router's edits with each new track that would start on a locked part's pad turned round, so it starts at its
 * other end; a track with both ends on locked pads is split in two at its middle, each half starting there. The copper
 * is the same either way.
 */
export function startOffLocked(edits: readonly LayoutEdit[], lockedAt: LockedAt): LayoutEdit[] {
  return edits.flatMap((edit): LayoutEdit[] => {
    if (edit.kind !== "addTrack") return [edit]
    const first = edit.points[0]
    const last = edit.points.at(-1)
    if (first === undefined || last === undefined || !lockedAt(first, edit.layer)) return [edit]
    if (!lockedAt(last, edit.layer)) return [{ ...edit, points: [...edit.points].reverse() }]
    const points = edit.points.length > 2 ? edit.points : [first, { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }, last]
    const middle = Math.floor(points.length / 2)
    return [
      { ...edit, points: points.slice(0, middle + 1).reverse() },
      { ...edit, points: points.slice(middle) },
    ]
  })
}
