import type { PlacedFootprint } from "../engine/pcb.js"
import { padsUnder } from "../engine/copper.js"
import { readAnnotations, annotationsPathFor } from "./annotations.js"
import { EditError } from "./edit-error.js"
import type { TrackRecord } from "./layout-file.js"

/** The built design of a circuit, as far as the copper locks need it: the placed parts with their pads. */
export interface LayoutDesign {
  pcb: { parts: readonly PlacedFootprint[] }
}

/**
 * The design, or a way to get it for a circuit file (project-relative) that is asked only when the circuit has locked
 * parts, so a caller need not build the design for every copper edit.
 */
export type DesignSource = LayoutDesign | ((circuitFile: string) => Promise<LayoutDesign | undefined>)

/** The design a lock check needs: none while no part is locked, else the one given or the one the function gives. */
export async function designFor(source: DesignSource | undefined, circuitFile: string, lockedParts: ReadonlySet<string>): Promise<LayoutDesign | undefined> {
  if (lockedParts.size === 0 || source === undefined) return undefined
  return typeof source === "function" ? source(circuitFile) : source
}

/**
 * Who a track's first point belongs to, when that part is locked. Without the design that cannot be told, so while
 * the circuit has locked parts a track's change is refused rather than guessed.
 */
export function lockedStart(lockedParts: ReadonlySet<string>, design: LayoutDesign | undefined): (track: TrackRecord) => string | undefined {
  return (track) => {
    if (lockedParts.size === 0) return undefined
    if (!design) throw new EditError("invalid", `${track.id}: the circuit has locked parts, so changing its copper needs the built design`)
    const start = track.points[0]
    if (!start) return undefined
    return padsUnder(design.pcb.parts, start, track.layer).find((pad) => lockedParts.has(pad.component))?.component
  }
}

/** The locked parts (not drawings) of the circuit at `circuitPath`, a real path on disk. */
export async function lockedPartsAt(circuitPath: string): Promise<Set<string>> {
  const { locks } = await readAnnotations(annotationsPathFor(circuitPath))
  return new Set(locks.filter((lock) => !lock.drawing).map((lock) => lock.part))
}
