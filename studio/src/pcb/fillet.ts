// Edit → Fillet tracks and Straighten tracks on the PCB: which tracks they act on (the selected ones, or every track of
// the board when nothing is selected, after a confirm naming the count), and the one change they send, with its
// summary ("Rounded 14 corners on 6 tracks; 2 left square: too short, too close to GND"). The geometry and the rules
// are the engine's (src/engine/fillet.ts, fillet-plan.ts), shared with the agent's fillet_tracks. Pure; plain
// TypeScript with .js imports, so the tests can run it.
import type { LayoutEdit } from "../../../src/core/layout-records.js"
import { planFillet, planStraighten, type PlanDesign } from "../../../src/engine/fillet-plan.js"
import type { CopperChange } from "./copper-gesture.js"

export { filletTrack, straightenTrack } from "../../../src/engine/fillet.js"

export type TrackShapeCommand = "filletTracks" | "straightenTracks"

const VERB: Record<TrackShapeCommand, string> = { filletTracks: "Fillet", straightenTracks: "Straighten" }

/** What a command acts on: the tracks named, or every track (`ids` left out) once the person agrees to `confirm`. */
export type ShapeScope = { ids?: string[]; confirm?: string } | { message: string }

/**
 * The tracks a command acts on: the selected tracks; with nothing selected, every track of the board, asked first.
 * A selection without a track (a via, a part) is not taken for nothing.
 */
export function shapeScope(command: TrackShapeCommand, tracks: readonly { id: string }[], selection: { copper: readonly string[]; total: number }): ShapeScope {
  const known = new Set(tracks.map((track) => track.id))
  if (selection.total > 0) {
    const ids = selection.copper.filter((id) => known.has(id))
    return ids.length > 0 ? { ids } : { message: `Select tracks to ${VERB[command].toLowerCase()}, or nothing for every track of the board.` }
  }
  if (tracks.length === 0) return { message: "The board has no tracks." }
  const count = tracks.length === 1 ? "the board's one track" : `all ${tracks.length} tracks of the board`
  return { confirm: `${VERB[command]} ${count}?` }
}

/** The change a command makes to the tracks, as one history entry of setTrack edits, or what to tell when nothing changes. */
export function shapeChange(command: TrackShapeCommand, design: PlanDesign, ids: readonly string[] | undefined, lockedParts: ReadonlySet<string>): CopperChange | { message: string } {
  const options = { ...(ids ? { ids } : {}), lockedParts }
  const plan = command === "filletTracks" ? planFillet(design, options) : planStraighten(design, options)
  if (plan.changes.length === 0) return { message: plan.summary }
  const edits = plan.changes.map((change): LayoutEdit => ({ kind: "setTrack", id: change.id, points: change.points }))
  const tracks = new Map(plan.changes.map((change) => [change.id, change.points]))
  return { edits, summary: plan.summary, shapes: { tracks, vias: new Map() } }
}
