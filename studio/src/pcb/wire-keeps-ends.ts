// A wire drawn by hand pins its ends: when it ends on a part the engine is still placing on the sheet (no schX/schY),
// the edit that adds the wire also writes where that part is now, and its turn, as Keep these positions does
// (auto-placed.ts). Later builds then cannot move the part away from the wire's corners. One edit, one history entry.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import { keepPositions } from "./auto-placed.js"
import type { SourceCircuit } from "./positions.js"

export interface PlannedEdit {
  edits: Edit[]
  summary: string
}

/** The part a wire end's selector names: `R1` of `R1.pin2`; a net (`net.GND`) names none that the sheet places. */
const partOf = (selector: string): string => selector.split(".")[0] ?? ""

const names = (parts: readonly string[]): string => (parts.length === 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`)

/** The wire's edits with the positions of the engine-placed parts at `ends` (selectors) added, and its summary saying so. */
export interface KeepOptions {
  /** Why a part may not change (locked, read-only, an expression), or null; a blocked part is left out, the wire still goes. */
  blocked?: (name: string) => string | null
  /** The circuit's source, so a part with schRotation but no position keeps its turn. */
  source?: SourceCircuit
}

const NEVER_BLOCKED = (): null => null

export function keepWireEnds(design: Design, plan: PlannedEdit, ends: readonly string[], options: KeepOptions = {}): PlannedEdit {
  const wanted = [...new Set(ends.map(partOf))]
  const keeps = keepPositions(design, "schematic", options.blocked ?? NEVER_BLOCKED, options.source).edits.filter((edit) => edit.kind === "setProps" && wanted.includes(edit.part))
  if (keeps.length === 0) return plan
  const ordered = wanted.flatMap((part) => keeps.filter((edit) => edit.kind === "setProps" && edit.part === part))
  const kept = ordered.map((edit) => (edit.kind === "setProps" ? edit.part : ""))
  return { edits: [...plan.edits, ...ordered], summary: `${plan.summary}, keeping ${names(kept)} in place` }
}
