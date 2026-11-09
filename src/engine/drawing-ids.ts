// The one rule for a drawing's id, shared by the engine (Circuit.drawings) and the core (its edits), so both
// address the same drawing. Pure: the Studio bundle may import it.
import { busMembers } from "./drawing-kinds.js"
import type { DrawingKind } from "./model.js"

/** A drawing tag as the id rule sees it: its kind and the name it gives (see drawingName). */
export interface DrawingTagName {
  kind: DrawingKind
  name: string | undefined
}

export interface DrawingId {
  id: string
  /** What the tag asks for before repeats are numbered: its name, or its kind and place. */
  base: string
  /** "piece" for a bus repeating the name an earlier bus took, "duplicate" for any other repeat. */
  repeat?: "piece" | "duplicate"
}

/** The name a drawing goes by, when the value is one its kind accepts: any non-empty string, or for a bus a name that names its nets. */
export function drawingName(kind: DrawingKind, value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined
  return kind !== "bus" || busMembers(value) !== undefined ? value : undefined
}

/** The id of an unnamed drawing: its kind and its 1-based place among the tags of that kind. */
export function indexId(kind: DrawingKind, index: number): string {
  return `drawing:${kind}:${index}`
}

/** The first of base~2, base~3 … that nothing has taken. */
function freeId(taken: ReadonlySet<string>, base: string): string {
  let count = 2
  while (taken.has(`${base}~${count}`)) count++
  return `${base}~${count}`
}

/**
 * The id of every drawing tag, given in source order, counting the tags a bad value leaves out so ids do not
 * shift while a value is being fixed. A drawing's id is its name, or `drawing:<kind>:<n>` when it has none; one
 * that a part or an earlier drawing took gets `~2`, `~3` and so on, so parts keep their names whatever the order.
 */
export function drawingIds(tags: readonly DrawingTagName[], partIds: Iterable<string>): DrawingId[] {
  const taken = new Set(partIds)
  const buses = new Set<string>()
  const counts = new Map<DrawingKind, number>()
  return tags.map(({ kind, name }): DrawingId => {
    const index = (counts.get(kind) ?? 0) + 1
    counts.set(kind, index)
    const base = name ?? indexId(kind, index)
    if (!taken.has(base)) {
      taken.add(base)
      if (kind === "bus") buses.add(base)
      return { id: base, base }
    }
    const id = freeId(taken, base)
    taken.add(id)
    return { id, base, repeat: kind === "bus" && buses.has(base) ? "piece" : "duplicate" }
  })
}
