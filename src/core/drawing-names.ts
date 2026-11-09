// Names for new and renamed drawings. Pure: the Studio may import it to name what it draws.
import { busMembers } from "../engine/drawing-kinds.js"
import type { DrawingKind } from "../engine/model.js"
import { EditError } from "./edit-error.js"
import type { CircuitModel } from "./types.js"

/** Letters, digits and _, as part names: no `:` or `~`, so a name never looks like an index or a repeat id. */
const DRAWING_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const NUMBERED = /^G(\d+)$/

/** The name the Studio gives a new drawing: G and the number after the highest G<n> a part or drawing has. */
export function nextDrawingName(model: Pick<CircuitModel, "parts" | "drawings">): string {
  const names = [...model.parts.map((part) => part.name), ...model.drawings.flatMap((drawing) => [drawing.id, drawing.name ?? ""])]
  const highest = Math.max(0, ...names.map((name) => Number(NUMBERED.exec(name)?.[1] ?? 0)))
  return `G${highest + 1}`
}

/**
 * Throws unless `name` can name a drawing of this kind: a bus takes a net name or a range such as D[0:7],
 * other drawings letters, digits and _. No part may have it, nor another drawing, except that a bus may share
 * an existing bus's name as one more piece of it. `self` is the id of a drawing being renamed.
 */
export function checkDrawingName(model: Pick<CircuitModel, "parts" | "drawings">, kind: DrawingKind, name: string, self?: string): void {
  if (kind === "bus" ? busMembers(name) === undefined : !DRAWING_NAME.test(name)) {
    const wanted = kind === "bus" ? 'a net name such as "CLK" or a range such as "D[0:7]"' : "letters, digits and _"
    throw new EditError("invalid", `"${name}" is not a valid ${kind === "bus" ? "bus" : "drawing"} name; use ${wanted}`)
  }
  if (model.parts.some((part) => part.name === name)) throw new EditError("invalid", `A part named ${name} already exists`)
  const piece = (tag: string, other: string | undefined) => kind === "bus" && tag === "bus" && other === name
  const clash = model.drawings.some((d) => d.id !== self && (d.name === name || d.id === name) && !piece(d.tag, d.name))
  if (clash) throw new EditError("invalid", `A drawing named ${name} already exists`)
}
