// The reference images' state shared by the Layer panel and the PCB canvas: which one is being aligned and the points
// picked so far, and the values shown before the server's build carries them (an opacity slider being dragged, points
// just picked). Shared like shell/armed-part.ts. Plain TypeScript with .js imports, so the tests can run it.
import { useSyncExternalStore } from "react"
import type { ReferenceRecord } from "../../../src/core/layout-references.js"
import type { FitPoint, ReferencePoint } from "../../../src/engine/reference-fit.js"

/** A reference being aligned: the pairs picked in this run, and the image pixel waiting for its board point. */
export interface Aligning {
  id: string
  points: ReferencePoint[]
  picked?: FitPoint
}

/** What the Studio shows of a reference before the build has it. */
export type ReferenceOverride = Partial<Pick<ReferenceRecord, "opacity" | "shown" | "mirror" | "points">>

export interface ReferenceState {
  aligning: Aligning | null
  overrides: Readonly<Record<string, ReferenceOverride>>
}

let state: ReferenceState = { aligning: null, overrides: {} }
const listeners = new Set<() => void>()

function set(next: ReferenceState): void {
  state = next
  for (const listener of listeners) listener()
}

export const referenceState = (): ReferenceState => state

/** Starts aligning a reference: the points it had stay drawn until the first new pair. */
export function startAligning(id: string): void {
  set({ ...state, aligning: { id, points: [] } })
}

export function stopAligning(): void {
  if (state.aligning) set({ ...state, aligning: null })
}

/** The image pixel under the first click of a pair. */
export function pickImagePoint(at: FitPoint): void {
  if (state.aligning) set({ ...state, aligning: { ...state.aligning, picked: at } })
}

/** The board point that completes the pair; answers the run's points with it. */
export function pickBoardPoint(at: FitPoint): ReferencePoint[] {
  const aligning = state.aligning
  if (!aligning?.picked) return aligning?.points ?? []
  const points = [...aligning.points, { image: aligning.picked, board: at }]
  set({ ...state, aligning: { id: aligning.id, points } })
  return points
}

/** Shows a value at once, before the write that makes it lands. */
export function overrideReference(id: string, values: ReferenceOverride): void {
  set({ ...state, overrides: { ...state.overrides, [id]: { ...state.overrides[id], ...values } } })
}

/** Forgets the shown values once a build has the written ones. */
export function clearOverrides(): void {
  if (Object.keys(state.overrides).length > 0) set({ ...state, overrides: {} })
}

/** The references as shown: each record with what the Studio shows ahead of the build. */
export function shownReferences(references: readonly ReferenceRecord[] | undefined, overrides: ReferenceState["overrides"]): ReferenceRecord[] {
  return (references ?? []).map((r) => ({ ...r, ...overrides[r.id] }))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useReferenceState(): ReferenceState {
  return useSyncExternalStore(subscribe, referenceState, referenceState)
}
