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
}

export interface UnrouteCopper {
  tracks: readonly UnrouteTrack[]
  vias: readonly UnrouteRecord[]
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
}

const takesBack = (record: UnrouteRecord, ids: ReadonlySet<string> | undefined) => record.by === "router" && !record.locked && (ids === undefined || ids.has(record.id))

/**
 * The edits that remove the router's unlocked copper: all of it, or only the records named in `ids`. A track that
 * starts on a locked part's pad is left (the core would refuse its removal) and named in `skipped`.
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
  const edits = [
    ...tracks.map((track): LayoutEdit => ({ kind: "removeTrack", id: track.id })),
    ...copper.vias.filter((via) => takesBack(via, only)).map((via): LayoutEdit => ({ kind: "removeVia", id: via.id })),
  ]
  return { edits, skipped }
}

const counted = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** "Unroute: remove 12 tracks and 3 vias the router made; left t0004 (starts on the locked part J1)". */
export function unrouteSummary(edits: readonly LayoutEdit[], skipped: readonly string[] = []): string {
  const tracks = edits.filter((edit) => edit.kind === "removeTrack").length
  const vias = edits.filter((edit) => edit.kind === "removeVia").length
  const parts = [...(tracks > 0 ? [counted(tracks, "track")] : []), ...(vias > 0 ? [counted(vias, "via")] : [])]
  const left = skipped.length === 0 ? "" : `; left ${skipped.map((why) => why.replace(/^(\S+) /, "$1 (")).join("), ")})`
  const text = `Unroute: remove ${parts.join(" and ")} the router made${left}`
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
