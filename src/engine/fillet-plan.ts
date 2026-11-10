import { filletGuard, guardPieces, straightenGuard, type GuardContext } from "./checks/fillet-guard.js"
import { padsUnder, type PcbTrack } from "./copper.js"
import { filletTrack, straightenTrack } from "./fillet.js"
import type { Net, Point } from "./model.js"
import type { PcbLayout } from "./pcb.js"
import { netClasses } from "./rules/classes.js"
import { DEFAULT_CLASS } from "./rules/profiles.js"
import type { Rules } from "./rules/schema.js"
import { filletRadius } from "./rules/track-defaults.js"

/**
 * Fillet tracks and Straighten tracks on a built design, as the Studio and the agent run them: which tracks change,
 * their new points, and the one-line summary ("Rounded 14 corners on 6 tracks; 2 left square: too short, too close to
 * GND"; "Straightened 3 corners on 2 tracks; 1 kept round: too close to GND"). Locked tracks, and tracks starting on a
 * locked part's pad, are left as they are and named.
 */

/** What the plans read of a built design. */
export interface PlanDesign {
  circuit: { nets: readonly Net[] }
  pcb: PcbLayout
  rules: Rules
}

export interface PlanOptions {
  /** The tracks to change; every track of the board when left out. Ids that are not tracks (vias) are ignored. */
  ids?: readonly string[]
  /** Fillet only: the radius in mm; the rules' fillet radius when left out. A track's width is its floor. */
  radius?: number
  /** The locked parts: a track starting on one of their pads stays as it is. */
  lockedParts?: ReadonlySet<string>
}

export interface TrackChange {
  id: string
  points: Point[]
}

export interface CopperPlan {
  changes: TrackChange[]
  summary: string
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** The tracks the command looks at, and why the ones it leaves alone are left. */
function chosenTracks(design: PlanDesign, options: PlanOptions): { tracks: PcbTrack[]; skipped: string[] } {
  const wanted = options.ids === undefined ? undefined : new Set(options.ids)
  const picked = design.pcb.tracks.filter((track) => track.missingLayer === undefined && (wanted === undefined || wanted.has(track.id)))
  const skipped: string[] = []
  const tracks = picked.filter((track) => {
    if (track.locked) return void skipped.push(`${track.id} is locked`)
    const start = track.points[0]
    const part = start && options.lockedParts?.size ? padsUnder(design.pcb.parts, start, track.layer).find((pad) => options.lockedParts?.has(pad.component))?.component : undefined
    return part === undefined ? true : void skipped.push(`${track.id} starts on the locked part ${part}`)
  })
  return { tracks, skipped }
}

const withSkipped = (text: string, skipped: readonly string[]) => [text, ...skipped].join("; ")

function guardContext(design: PlanDesign): GuardContext {
  const byNet = netClasses(design.rules, design.circuit.nets).byNet
  const names = new Map(design.circuit.nets.map((net) => [net.id, net.names[0] ?? net.id]))
  return {
    layout: design.pcb,
    rules: design.rules,
    classOf: (net) => (net === undefined ? DEFAULT_CLASS.name : (byNet.get(net) ?? DEFAULT_CLASS.name)),
    netName: (id) => names.get(id) ?? id,
  }
}

/** Fillet tracks: every square corner of the tracks rounded with the radius, where the rules and the legs allow. */
export function planFillet(design: PlanDesign, options: PlanOptions = {}): CopperPlan {
  const { tracks, skipped } = chosenTracks(design, options)
  if (tracks.length === 0) return { changes: [], summary: withSkipped("No tracks to round", skipped) }
  const radius = options.radius ?? filletRadius(design.rules)
  const context = guardContext(design)
  const pieces = guardPieces(context)
  const changes: TrackChange[] = []
  const reasons: string[] = []
  let [corners, square] = [0, 0]
  for (const track of tracks) {
    const result = filletTrack(track.points, radius, track.width, filletGuard(context, pieces, track))
    if (result.rounded > 0) changes.push({ id: track.id, points: result.points })
    corners += result.rounded
    square += result.square.length
    for (const corner of result.square) if (!reasons.includes(corner.reason)) reasons.push(corner.reason)
  }
  if (corners === 0 && square === 0) return { changes, summary: withSkipped("No square corners to round", skipped) }
  const head = corners === 0 ? "No corner was rounded" : `Rounded ${plural(corners, "corner")} on ${plural(changes.length, "track")}`
  const left = square === 0 ? [] : [`${square} left square: ${reasons.join(", ")}`]
  return { changes, summary: withSkipped(head, [...left, ...skipped]) }
}

/** Straighten tracks: every rounded corner of the tracks put back where its legs meet. */
export function planStraighten(design: PlanDesign, options: Omit<PlanOptions, "radius"> = {}): CopperPlan {
  const { tracks, skipped } = chosenTracks(design, options)
  const context = guardContext(design)
  const pieces = guardPieces(context)
  const changes: TrackChange[] = []
  const reasons: string[] = []
  let [corners, round] = [0, 0]
  for (const track of tracks) {
    const result = straightenTrack(track.points, straightenGuard(context, pieces, track))
    if (result.straightened > 0) changes.push({ id: track.id, points: result.points })
    corners += result.straightened
    round += result.round.length
    for (const corner of result.round) if (!reasons.includes(corner.reason)) reasons.push(corner.reason)
  }
  if (corners === 0 && round === 0) return { changes, summary: withSkipped("No rounded corners to straighten", skipped) }
  const head = corners === 0 ? "No corner was straightened" : `Straightened ${plural(corners, "corner")} on ${plural(changes.length, "track")}`
  const kept = round === 0 ? [] : [`${round} kept round: ${reasons.join(", ")}`]
  return { changes, summary: withSkipped(head, [...kept, ...skipped]) }
}
