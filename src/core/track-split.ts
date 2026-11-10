// Removing one segment of a track: the record is split into the runs on either side of the segment. The track keeps
// its id and the first run that is left; the run after the segment, when there are two, becomes a new track with the
// same net, layer and width. A run of one point disappears, and a track with nothing left is removed. A record that
// names no net of its own has the net the track carries written on both runs, so neither floats off with no net. The Studio's
// Delete on a selected segment and the MCP's remove_copper with { id, segment } send these edits as one change.
import type { LayoutEdit } from "./layout-records.js"
import type { CopperLayer, LayoutPoint } from "./layout-file.js"

/** A track as the split reads it; `net` is the net as the record names it, `carried` the net the track carries (its pads'). */
export interface SplitTrack {
  id: string
  net?: string
  carried?: string
  layer: CopperLayer
  width: number
  points: readonly LayoutPoint[]
  locked?: boolean
}

/** How many segments a track of these points has. */
export const segmentCount = (points: readonly unknown[]): number => Math.max(points.length - 1, 0)

/** Whether `index` names a segment of a track with these points. */
export const hasSegment = (points: readonly unknown[], index: number): boolean => Number.isInteger(index) && index >= 0 && index < segmentCount(points)

const copied = (points: readonly LayoutPoint[]): LayoutPoint[] => points.map((p) => ({ x: p.x, y: p.y }))

/** The edits that remove segment `index` (from point `index` to the next) of `track`, or why it cannot be removed. */
export function segmentRemoval(track: SplitTrack, index: number): { edits: LayoutEdit[] } | { message: string } {
  const count = segmentCount(track.points)
  if (!hasSegment(track.points, index)) return { message: `${track.id} has no segment ${index}; it has ${count} (0 to ${count - 1})` }
  if (track.locked) return { message: `${track.id} is locked` }
  const runs = [track.points.slice(0, index + 1), track.points.slice(index + 1)].filter((run) => run.length >= 2)
  const [first, second] = runs
  if (!first) return { edits: [{ kind: "removeTrack", id: track.id }] }
  const written = track.net ?? track.carried
  const net = written === undefined ? {} : { net: written }
  const kept: LayoutEdit = { kind: "setTrack", id: track.id, ...(track.net === undefined ? net : {}), points: copied(first) }
  if (!second) return { edits: [kept] }
  return { edits: [kept, { kind: "addTrack", ...net, layer: track.layer, width: track.width, points: copied(second) }] }
}
