// The part picked in the Library and waiting for a click on the open canvas (pcb/part-place.ts). A canvas that can take
// the click says so while it is mounted; with none (the 3D tab, nothing built) a part cannot be armed and the Library
// places it at once. The Studio sets the placer, which sends the request. Shared like tool-state.ts.
import { useSyncExternalStore } from "react"
import type { PlacedAt } from "../pcb/part-place.js"
import type { View } from "../pcb/positions.js"

/** Sends one place request; it settles when the request has. */
export type PartPlacer = (part: string, at?: PlacedAt) => Promise<void> | void

let armed: string | null = null
let takers: readonly View[] = []
let placer: PartPlacer | null = null
/** A click's place request is in flight: further clicks are ignored until it settles, so no two pick the same name. */
let inFlight = false
const listeners = new Set<() => void>()

function set(next: string | null): void {
  if (next === armed) return
  armed = next
  for (const listener of listeners) listener()
}

export const armedPart = (): string | null => armed

export const partTakers = (): readonly View[] => takers

/** Arms `part` when a canvas can take the click; false when none can. */
export function armPart(part: string): boolean {
  if (takers.length === 0) return false
  set(part)
  return true
}

export function disarmPart(): void {
  set(null)
}

/** A canvas takes clicks for parts while mounted; the returned function is its leaving, which disarms the last one. */
export function takeParts(view: View): () => void {
  takers = [...takers, view]
  return () => {
    const index = takers.indexOf(view)
    takers = takers.filter((_, i) => i !== index)
    if (takers.length === 0) disarmPart()
  }
}

export function setPartPlacer(next: PartPlacer | null): void {
  placer = next
}

export const placing = (): boolean => inFlight

/** Places the armed part where a click put it and keeps it armed; false when nothing is armed or a place is in flight. */
export function placeArmed(at: PlacedAt): boolean {
  if (armed === null || placer === null || inFlight) return false
  inFlight = true
  const settle = () => {
    inFlight = false
  }
  Promise.resolve(placer(armed, at)).then(settle, settle)
  return true
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useArmedPart(): string | null {
  return useSyncExternalStore(subscribe, armedPart)
}
