import { z } from "zod"
import { resolveCircuit, type LayoutEdit } from "../core/index.js"
import { lockedPartsAt } from "../core/layout-locks.js"
import type { Design } from "../engine/design.js"
import { planFillet, planStraighten, type CopperPlan, type PlanOptions } from "../engine/fillet-plan.js"
import { applyCopper, buildOf, type Ports } from "./copper-tools.js"

const trackIds = z
  .array(z.string().regex(/^t\d+$/, 'a track id such as "t0001"'))
  .min(1)
  .max(200)
  .optional()
  .describe("Default every track")

export const filletTracksInput = {
  file: z.string().describe("Circuit file"),
  ids: trackIds,
  radius: z.number().positive().optional().describe("mm; default the rules' fillet radius"),
}

export const straightenTracksInput = {
  file: z.string().describe("Circuit file"),
  ids: trackIds,
}

export const FILLET_TRACKS_DESCRIPTION =
  "Round the square corners of tracks as ONE change. A corner stays square where the arc would break clearance; the answer counts those with reasons. Locked tracks are left alone; straighten_tracks undoes it."
export const STRAIGHTEN_TRACKS_DESCRIPTION =
  "Put back the square corners fillet_tracks rounded, as ONE change, where clearance allows. Locked tracks are left alone."

/** Refuses ids that name no track of the layout, before anything is written. */
function checkIds(design: Design, ids: readonly string[] | undefined): void {
  if (ids === undefined) return
  const known = new Set(design.pcb.tracks.map((track) => track.id))
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length > 0) throw new Error(`No track ${unknown.join(", ")} in the layout file. Nothing was written.`)
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

/** Runs a plan on the circuit's built design: its changes as one history entry, or its summary alone when nothing changes. */
async function runPlan(ports: Ports, file: string, ids: readonly string[] | undefined, plan: (design: Design, options: PlanOptions) => CopperPlan, extra: Pick<PlanOptions, "radius"> = {}): Promise<string> {
  const design = await buildOf(ports, file)
  checkIds(design, ids)
  const lockedParts = await lockedPartsAt((await resolveCircuit(ports.root, file)).path)
  const { changes, summary } = plan(design, { ...(ids ? { ids } : {}), ...extra, lockedParts })
  if (changes.length === 0) return `Nothing was written: ${lowerFirst(summary)}`
  const edits = changes.map((change): LayoutEdit => ({ kind: "setTrack", id: change.id, points: change.points }))
  return applyCopper(ports, file, design, edits, () => lowerFirst(summary), summary)
}

/** fillet_tracks: the corners of the tracks rounded as one change. */
export function filletTracks(ports: Ports, input: { file: string; ids?: string[]; radius?: number }): Promise<string> {
  return runPlan(ports, input.file, input.ids, planFillet, input.radius === undefined ? {} : { radius: input.radius })
}

/** straighten_tracks: the rounded corners of the tracks put back as one change. */
export function straightenTracks(ports: Ports, input: { file: string; ids?: string[] }): Promise<string> {
  return runPlan(ports, input.file, input.ids, planStraighten)
}
