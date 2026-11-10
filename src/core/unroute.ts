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

export interface UnrouteCopper {
  tracks: readonly UnrouteRecord[]
  vias: readonly UnrouteRecord[]
}

const takesBack = (record: UnrouteRecord, ids: ReadonlySet<string> | undefined) => record.by === "router" && !record.locked && (ids === undefined || ids.has(record.id))

/** The edits that remove the router's unlocked copper: all of it, or only the records named in `ids`. */
export function unrouteEdits(copper: UnrouteCopper, ids?: readonly string[]): LayoutEdit[] {
  const only = ids === undefined ? undefined : new Set(ids)
  return [
    ...copper.tracks.filter((track) => takesBack(track, only)).map((track): LayoutEdit => ({ kind: "removeTrack", id: track.id })),
    ...copper.vias.filter((via) => takesBack(via, only)).map((via): LayoutEdit => ({ kind: "removeVia", id: via.id })),
  ]
}

const counted = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** "Unroute: remove 12 tracks and 3 vias the router made". */
export function unrouteSummary(edits: readonly LayoutEdit[]): string {
  const tracks = edits.filter((edit) => edit.kind === "removeTrack").length
  const vias = edits.filter((edit) => edit.kind === "removeVia").length
  const parts = [...(tracks > 0 ? [counted(tracks, "track")] : []), ...(vias > 0 ? [counted(vias, "via")] : [])]
  return `Unroute: remove ${parts.join(" and ")} the router made`
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
