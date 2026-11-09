// Which selected drawings a build keeps. A named drawing's id is its name, so it names the same drawing for as long as
// it is in the sheet. An unnamed drawing's id is its place among the drawings of its kind (`drawing:path:2`), and a
// repeated name's is its place among the repeats (`G1~2`): when a drawing of that kind comes or goes (deleted, undone,
// or edited in the code), the later ones take each other's ids. Such an id is kept only when the build left the count of
// its kind alone, or the drawing under it is exactly the one it was before, as the wires Studio draws are kept only
// on the same ends (wire-selection.ts). Pure.
import type { SchematicDrawing } from "../../../src/engine/model.js"
import type { Selection } from "../selection.js"

/** Whether the id may pass to another drawing when one of its kind comes or goes: an index id, or a repeat of a name. */
const shifting = (id: string): boolean => id.startsWith("drawing:") || id.includes("~")

/** The drawing's shape and style, without where its text sits in the file (which any edit above it shifts). */
const shapeOf = (drawing: SchematicDrawing): string => JSON.stringify({ ...drawing, source: undefined })

const countOf = (drawings: readonly SchematicDrawing[], kind: SchematicDrawing["kind"]): number => drawings.filter((drawing) => drawing.kind === kind).length

/** Whether `now`, under an id that `then` had before the build, is still that drawing. */
function sameDrawing(then: SchematicDrawing, now: SchematicDrawing, before: readonly SchematicDrawing[], after: readonly SchematicDrawing[]): boolean {
  if (!shifting(now.id)) return true
  if (then.kind !== now.kind) return false
  return countOf(before, now.kind) === countOf(after, now.kind) || shapeOf(then) === shapeOf(now)
}

/**
 * The ids of the drawings in `after` that still name the drawing they named in `before`; an id `before` did not have
 * has nothing to compare and stays, and with no earlier sheet every one does.
 */
export function stableDrawings(before: readonly SchematicDrawing[] | undefined, after: readonly SchematicDrawing[]): string[] {
  const earlier = new Map((before ?? []).map((drawing) => [drawing.id, drawing]))
  return after.flatMap((now) => {
    const then = earlier.get(now.id)
    return !before || !then || sameDrawing(then, now, before, after) ? [now.id] : []
  })
}

/** A drawing renamed in Properties: its id before, and the id its build gives it (bus-tool.ts renamedId). */
export interface DrawingRename {
  from: string
  to: string
}

/**
 * The selection once a build has the renamed drawings: a selected one is selected under its new id (so the drawing
 * that takes its old id, another piece of the same bus, is not). Renames whose build has not come keep `waiting`.
 * Run before drawingAfterBuild.
 */
export function renamedAfterBuild(selection: Selection, renames: readonly DrawingRename[], after: readonly SchematicDrawing[]): { selection: Selection; waiting: DrawingRename[] } {
  const built = (rename: DrawingRename) => after.some((drawing) => drawing.id === rename.to)
  const done = renames.filter(built)
  const next = done.reduce((current, { from, to }) => (current.hasDrawing(from) ? current.withoutDrawings([from]).addDrawings([to]) : current), selection)
  return { selection: next, waiting: renames.filter((rename) => !built(rename)) }
}

/** The selection after a build: the selected drawings that are gone, or whose id now names another drawing, leave it. */
export function drawingAfterBuild(selection: Selection, before: readonly SchematicDrawing[] | undefined, after: readonly SchematicDrawing[]): Selection {
  return selection.drawingCount === 0 ? selection : selection.keepDrawings(stableDrawings(before, after))
}
