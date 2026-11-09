// "Keep these positions" and Layout → Tidy sheet: write the spots (and turns) the engine chose for parts without a
// position into the code, as one edit. Tidy sheet is the schematic's: the engine places those parts on every build, so
// tidying writes where it put them; parts with a position stay. The Component tree and Properties name such parts.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import { partAnchors, VIEWS, type SourceCircuit, type View } from "./positions.js"

export interface Skipped {
  part: string
  reason: string
}

export interface KeepPlan {
  /** One setProps per part, for a single POST /api/edit. */
  edits: Edit[]
  /** Auto-placed parts left out: a repeated name ("RX~2") cannot be addressed, and `blocked` may refuse others. */
  skipped: Skipped[]
}

export const KEEP_SUMMARY = "Keep auto-placed positions"
const REPEATED_NAME = "a repeated name cannot be addressed from the Studio"

const round = (value: number) => Math.round(value * 100) / 100

/** The rotation the engine gave each part of `view`. */
function rotations(design: Design, view: View): Map<string, number> {
  const placed = view === "pcb" ? design.pcb.parts : design.schematic.symbols
  return new Map(placed.map((part) => [part.component, part.rotation]))
}

/** Whether the part's source has the view's rotation prop, which the engine ignores while the part has no position. */
const hasRotation = (source: SourceCircuit | undefined, part: string, view: View): boolean =>
  source?.model.parts.find((candidate) => candidate.name === part)?.props[VIEWS[view].rotation] !== undefined

/**
 * The edits that keep every auto-placed part of `view` where it is now: pcbX/pcbY on the board,
 * schX/schY on the sheet, relative to the part's groups and rounded to 0.01, and the rotation prop
 * it is drawn with when the engine turned it or `source` already has that prop (which counts once the
 * part has a position), so a kept part never comes back turned. `blocked` returns why a part may not be changed, or null.
 */
export function keepPositions(design: Design, view: View, blocked: (name: string) => string | null = () => null, source?: SourceCircuit): KeepPlan {
  const [keyX, keyY] = VIEWS[view].position
  const turned = rotations(design, view)
  const edits: Edit[] = []
  const skipped: Skipped[] = []
  for (const [part, { origin, group, autoPlaced }] of partAnchors(design, view)) {
    if (!autoPlaced) continue
    const reason = part.includes("~") ? REPEATED_NAME : blocked(part)
    if (reason !== null) {
      skipped.push({ part, reason })
      continue
    }
    const rotation = turned.get(part) ?? 0
    const props = { [keyX]: round(origin.x - group.x), [keyY]: round(origin.y - group.y), ...(rotation !== 0 || hasRotation(source, part, view) ? { [VIEWS[view].rotation]: rotation } : {}) }
    edits.push({ kind: "setProps", part, props })
  }
  return { edits, skipped }
}

/** `text`, then the parts left out and why. */
function withSkipped(text: string, plan: KeepPlan): string {
  if (plan.skipped.length === 0) return text
  return `${text} Skipped ${plan.skipped.map((s) => `${s.part} (${s.reason})`).join(", ")}.`
}

/** What to tell the person after a keep: how many positions were written, and which parts were left out and why. */
export function keepNotice(plan: KeepPlan): string {
  const count = plan.edits.length
  const kept = count === 0 ? "No auto-placed part could be kept." : `Kept the positions of ${count} auto-placed ${count === 1 ? "part" : "parts"}.`
  return withSkipped(kept, plan)
}

type EditActions = { edit(edits: Edit[], summary: string): Promise<boolean>; notify(text: string): void }

/** Sends the plan as one edit under `summary`, then tells the person what was written and what was skipped. */
function send(plan: KeepPlan, summary: string, notice: (plan: KeepPlan) => string, actions: EditActions): void {
  if (plan.edits.length === 0) return actions.notify(notice(plan))
  void actions.edit(plan.edits, summary).then((ok) => {
    if (ok) actions.notify(notice(plan))
  })
}

/** Sends the keep as one edit, then tells the person what was kept and what was skipped. */
export function keepAutoPlaced(design: Design, view: View, blocked: (name: string) => string | null, actions: EditActions, source?: SourceCircuit): void {
  send(keepPositions(design, view, blocked, source), KEEP_SUMMARY, keepNotice, actions)
}

export const TIDY_SUMMARY = "Tidy sheet"
export const NOTHING_TO_TIDY = "Every part on the sheet has a position of its own"
export const NOT_BUILT = "The schematic is not built yet"

/** The parts the engine placed in `view` (they have no position of their own there). */
export function autoPlacedParts(design: Design | undefined, view: View): ReadonlySet<string> {
  if (!design) return new Set()
  const placed = view === "pcb" ? design.pcb.parts : design.schematic.symbols
  return new Set(placed.flatMap((part) => (part.autoPlaced ? [part.component] : [])))
}

/** Why Tidy sheet cannot run, or null when some part on the sheet was placed by Studio. */
export function tidyReason(design: Design | undefined): string | null {
  if (!design) return NOT_BUILT
  return autoPlacedParts(design, "schematic").size > 0 ? null : NOTHING_TO_TIDY
}

/** Tidy sheet's edits: the positions and rotations of the parts Studio placed on the sheet, and of no other. */
export const tidyPlan = (design: Design, blocked: (name: string) => string | null = () => null, source?: SourceCircuit): KeepPlan =>
  keepPositions(design, "schematic", blocked, source)

/** What to tell the person after Tidy sheet. */
export function tidyNotice(plan: KeepPlan): string {
  const count = plan.edits.length
  const wrote = count === 0 ? "Tidied the sheet: no part Studio placed could be written." : `Tidied the sheet: wrote the positions of ${count} ${count === 1 ? "part" : "parts"} Studio placed.`
  return withSkipped(wrote, plan)
}

/** Layout → Tidy sheet: one edit writing where Studio placed its parts on the sheet. */
export function tidySheet(design: Design, blocked: (name: string) => string | null, actions: EditActions, source?: SourceCircuit): void {
  const reason = tidyReason(design)
  if (reason !== null) return actions.notify(reason)
  send(tidyPlan(design, blocked, source), TIDY_SUMMARY, tidyNotice, actions)
}
