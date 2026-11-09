// Copper edits sent and not yet in the shown build: each keeps the shapes it gave (and, for a move of parts and copper
// together, the parts' offset) until a build that started after its write is shown. The server's write mark orders a
// write against builds (LiveProject.nextMark): a build whose start mark is larger read it. An edit still waiting for
// its answer stays; a failed one goes, taking only its own shapes. Pure; plain TypeScript for the tests.
import type { Point } from "./geometry.js"
import { mergeShapes, NO_SHAPES, type CopperShapesById } from "./copper-edits.js"

/** An entry sent to the server: its own id, and the server's mark of the write once it answered. */
export interface Marked {
  id: number
  mark?: number
}

export interface PendingCopper extends Marked {
  shapes: CopperShapesById
  parts?: { names: readonly string[]; offset: Point }
}

/** Whether the shown build (start mark `built`) has not read the edit yet. */
const waiting = (entry: Marked, built: number | undefined): boolean => entry.mark === undefined || built === undefined || built <= entry.mark

export const addPending = (list: readonly PendingCopper[], id: number, entry: Omit<PendingCopper, "id" | "mark">): PendingCopper[] => [...list, { ...entry, id }]

export const markPending = <T extends Marked>(list: readonly T[], id: number, mark: number): T[] => list.map((entry) => (entry.id === id ? { ...entry, mark } : entry))

export const dropPending = <T extends Marked>(list: readonly T[], id: number): T[] => list.filter((entry) => entry.id !== id)

/** The entries the shown build has not read yet. */
export const settlePending = <T extends Marked>(list: readonly T[], built: number | undefined): T[] => list.filter((entry) => waiting(entry, built))

/** Whether an edit is still waiting for the server's answer (an arrow key's repeat waits for it). */
export const inFlight = (list: readonly Marked[]): boolean => list.some((entry) => entry.mark === undefined)

/** The shapes to draw in place of the copper's own, the later edit's winning. */
export function pendingShapes(list: readonly PendingCopper[], built: number | undefined): CopperShapesById {
  return settlePending(list, built).reduce((shapes, entry) => mergeShapes(shapes, entry.shapes), NO_SHAPES)
}

/** The parts of the latest group move still waiting, drawn moved. */
export function pendingMoving(list: readonly PendingCopper[], built: number | undefined): { names: readonly string[]; offset: Point } | undefined {
  return [...settlePending(list, built)].reverse().find((entry) => entry.parts !== undefined)?.parts
}
