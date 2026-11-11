// What Place → Autoplace selection and Autoplace instance ask the server for, from the selection, or why there is
// nothing to ask. Pure, so the tests run it without a DOM.
import type { Design } from "../../../src/engine/design.js"
import type { PlaceScope } from "../../../src/studio/place-events.js"
import { instancePart, topInstance } from "./instances.js"

export interface Refusal {
  message: string
}

/** Autoplace selection: the selected parts (an instance's symbol stands for its parts). */
export function placeSelectionScope(design: Design | undefined, names: readonly string[]): PlaceScope | Refusal {
  if (names.length === 0) return { message: "Select the parts to place first." }
  const parts = names.flatMap((name) => topInstance(design, name)?.parts ?? [name])
  return { kind: "parts", parts: [...new Set(parts)] }
}

/** Autoplace instance: the sub-sheet instance the selection is in. */
export function placeInstanceScope(design: Design | undefined, names: readonly string[]): PlaceScope | Refusal {
  for (const name of names) {
    const outer = topInstance(design, name)?.path ?? instancePart(design, name)?.outer
    if (outer !== undefined) return { kind: "instance", instance: outer }
  }
  return { message: "Select a part of a sub-sheet instance, or its symbol on the schematic, to place that instance." }
}
