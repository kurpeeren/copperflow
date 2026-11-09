// Names for the schematic's buses (Place → Bus and Properties): the next free BUS<n>, a typed name checked as the
// engine checks it, the id a new piece will get, and a bus's members in a few words. The members themselves come
// from the engine's busMembers. Pure: the Studio bundle imports it.
import type { CircuitModel } from "../../../src/core/types.js"
import { checkDrawingName } from "../../../src/core/drawing-names.js"

type Names = Pick<CircuitModel, "parts" | "drawings">

export const EMPTY_BUS_NAME = "Name the bus, such as D[0:7] or CLK"

/** Every name a part or drawing goes by, with the names sent whose build has not come back yet. */
function namesOf(model: Names, taken: readonly string[]): Set<string> {
  return new Set([...model.parts.map((part) => part.name), ...model.drawings.flatMap((d) => [d.id, d.name ?? ""]), ...taken])
}

/** The first BUS<n> that no part or drawing has, nor a bus sent but not built yet (`taken`). */
export function nextBusName(model: Names, taken: readonly string[] = []): string {
  const names = namesOf(model, taken)
  let n = 1
  while (names.has(`BUS${n}`)) n++
  return `BUS${n}`
}

/** Why `typed` cannot name a bus (as the engine says it), or undefined when it can; `self` is the id of a bus being renamed. */
export function busNameProblem(model: Names, typed: string, self?: string): string | undefined {
  const name = typed.trim()
  if (name === "") return EMPTY_BUS_NAME
  try {
    checkDrawingName(model, "bus", name, self)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** The id the engine gives a new drawing named `name`: the name, or name~2, name~3 … for one more piece of a bus. */
export function newDrawingId(model: Names, name: string): string {
  const ids = namesOf(model, [])
  if (!ids.has(name)) return name
  let count = 2
  while (ids.has(`${name}~${count}`)) count++
  return `${name}~${count}`
}

/** A bus's members in a few words: "D0 … D7, 8 members", "A1, A0, 2 members", "CLK, 1 member". */
export function membersText(members: readonly string[]): string {
  const count = `${members.length} member${members.length === 1 ? "" : "s"}`
  const shown = members.length > 2 ? `${members[0]} … ${members.at(-1)}` : members.join(", ")
  return `${shown}, ${count}`
}
