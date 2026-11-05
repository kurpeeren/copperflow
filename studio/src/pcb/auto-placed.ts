// "Keep these positions": writes the spots the engine chose for parts without a position into the code.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"

export type View = "pcb" | "schematic"

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

/** The parts the engine placed for itself in `view`, with where it put them. */
export function autoPlacedParts(design: Design, view: View): { component: string; x: number; y: number }[] {
  const placed = view === "pcb" ? design.pcb.parts : design.schematic.symbols
  return placed.filter((part) => part.autoPlaced).map(({ component, x, y }) => ({ component, x, y }))
}

/**
 * The edits that keep every auto-placed part of `view` where it is now: pcbX/pcbY on the board,
 * schX/schY on the sheet, rounded to 0.01. `blocked` returns why a part may not be changed, or null.
 */
export function keepPositions(design: Design, view: View, blocked: (name: string) => string | null = () => null): KeepPlan {
  const [keyX, keyY] = view === "pcb" ? (["pcbX", "pcbY"] as const) : (["schX", "schY"] as const)
  const edits: Edit[] = []
  const skipped: Skipped[] = []
  for (const part of autoPlacedParts(design, view)) {
    const reason = part.component.includes("~") ? REPEATED_NAME : blocked(part.component)
    if (reason !== null) {
      skipped.push({ part: part.component, reason })
      continue
    }
    edits.push({ kind: "setProps", part: part.component, props: { [keyX]: round(part.x), [keyY]: round(part.y) } })
  }
  return { edits, skipped }
}

/** What to tell the person after a keep: how many positions were written, and which parts were left out and why. */
export function keepNotice(plan: KeepPlan): string {
  const count = plan.edits.length
  const kept = count === 0 ? "No auto-placed part could be kept." : `Kept the positions of ${count} auto-placed ${count === 1 ? "part" : "parts"}.`
  if (plan.skipped.length === 0) return kept
  return `${kept} Skipped ${plan.skipped.map((s) => `${s.part} (${s.reason})`).join(", ")}.`
}

/** Sends the keep as one edit, then tells the person what was kept and what was skipped. */
export function keepAutoPlaced(
  design: Design,
  view: View,
  blocked: (name: string) => string | null,
  actions: { edit(edits: Edit[], summary: string): Promise<boolean>; notify(text: string): void },
): void {
  const plan = keepPositions(design, view, blocked)
  if (plan.edits.length === 0) return actions.notify(keepNotice(plan))
  void actions.edit(plan.edits, KEEP_SUMMARY).then((ok) => {
    if (ok) actions.notify(keepNotice(plan))
  })
}
