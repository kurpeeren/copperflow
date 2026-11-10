import type { PlacedFootprint } from "../engine/pcb.js"
import { padsUnder } from "../engine/copper.js"
import { readAnnotations, annotationsPathFor } from "./annotations.js"
import { EditError } from "./edit-error.js"
import { withInstanceParts, type InstanceParts } from "./instance-locks.js"
import type { TrackRecord } from "./layout-file.js"

export { withInstanceParts, type InstanceParts }

/**
 * The built design of a circuit, as far as copper edits need it: the placed parts with their pads (for the locks), and
 * the board's layer count (a circuit without a board has 2), so copper is not written on a layer the board lacks.
 */
export interface LayoutDesign {
  pcb: { parts: readonly PlacedFootprint[] }
  circuit?: { board?: { layers: 2 | 4 }; instances?: readonly InstanceParts[] }
}

/** The board's layer count when the design tells it, else undefined (nothing to check against). */
export const boardLayersOf = (design: LayoutDesign | undefined): 2 | 4 | undefined => (design?.circuit ? (design.circuit.board?.layers ?? 2) : undefined)

/**
 * The design, or a way to get it for a circuit file (project-relative) that is asked only when the circuit has locked
 * parts, so a caller need not build the design for every copper edit.
 */
export type DesignSource = LayoutDesign | ((circuitFile: string) => Promise<LayoutDesign | undefined>)

/**
 * The design an edit needs: none unless `needed` (parts are locked, or the edit puts copper on a layer), else the one
 * given or the one the function gives.
 */
export async function designFor(source: DesignSource | undefined, circuitFile: string, needed: boolean): Promise<LayoutDesign | undefined> {
  if (!needed || source === undefined) return undefined
  return typeof source === "function" ? source(circuitFile) : source
}

/**
 * Who a track's first point belongs to, when that part is locked. Without the design that cannot be told, so while
 * the circuit has locked parts a track's change is refused rather than guessed.
 */
export function lockedStart(lockedParts: ReadonlySet<string>, design: LayoutDesign | undefined): (track: TrackRecord) => string | undefined {
  const all = withInstanceParts(lockedParts, design?.circuit?.instances)
  return (track) => {
    if (lockedParts.size === 0) return undefined
    if (!design) throw new EditError("invalid", `${track.id}: the circuit has locked parts, so changing its copper needs the built design`)
    const start = track.points[0]
    if (!start) return undefined
    return padsUnder(design.pcb.parts, start, track.layer).find((pad) => all.has(pad.component))?.component
  }
}

/** The locked parts (not drawings) of the circuit at `circuitPath`, a real path on disk. */
export async function lockedPartsAt(circuitPath: string): Promise<Set<string>> {
  const { locks } = await readAnnotations(annotationsPathFor(circuitPath))
  return new Set(locks.filter((lock) => !lock.drawing).map((lock) => lock.part))
}
