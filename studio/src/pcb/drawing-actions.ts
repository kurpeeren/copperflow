// What a move and Delete do to the selected drawings, as plain data: the core's setDrawingProps and removeDrawing edits,
// the drawings left out and why, the words the history names them by, and the shapes a move gives them on the sheet
// (drawn until the build lands). A drawing moves by its position props: x and y for a shape or a text, its points
// for a line or a bus; the new values come from the source, so arrow presses ahead of the build add up. Pure.
import type { CircuitModel, DrawingInfo, Edit } from "../../../src/core/types.js"
import type { SchematicDrawing } from "../../../src/engine/model.js"
import { roundPosition, type Point } from "./geometry.js"

/** The words for a drawing of each kind, for the history and the notes. */
export const KIND_WORDS: Record<SchematicDrawing["kind"], string> = { path: "line", rect: "rectangle", circle: "circle", arc: "arc", text: "text", bus: "bus", junction: "junction" }

const plus = (a: Point, b: Point): Point => ({ x: roundPosition(a.x + b.x), y: roundPosition(a.y + b.y) })

/** Whether the drawing moves by its points (a line or a bus) rather than by x and y. */
const byPoints = (drawing: Pick<SchematicDrawing, "kind">): boolean => drawing.kind === "path" || drawing.kind === "bus"

/** The props a move writes for this drawing. */
const positionKeys = (drawing: Pick<SchematicDrawing, "kind">): string[] => (byPoints(drawing) ? ["points"] : ["x", "y"])

/** The source's view of a drawing, by its id. */
export const drawingInfo = (model: CircuitModel, id: string): DrawingInfo | undefined => model.drawings.find((drawing) => drawing.id === id)

/**
 * Why the drawing cannot be changed, or null: the file has no such drawing, it is locked, it is read-only (made in a
 * callback, a condition or a helper, or its id is unsure), or one of `keys` (the props to write) is an expression.
 */
export function drawingBlocker(model: CircuitModel, locked: ReadonlySet<string>, id: string, keys: readonly string[] = []): string | null {
  const info = drawingInfo(model, id)
  if (!info) return `${id} has no editable source element`
  if (locked.has(id)) return `${id} is locked`
  if (!info.editable) return `${id} is read-only (${info.readonlyReason ?? "not a literal element"})`
  const expression = keys.find((key) => info.props[key] && !info.props[key]?.editable)
  return expression ? `${id}.${expression} is an expression; change it in the code` : null
}

/** Why the drawing cannot move (drawingBlocker on its position props), or null. */
export const drawingMoveBlocker = (model: CircuitModel, locked: ReadonlySet<string>, drawing: SchematicDrawing): string | null =>
  drawingBlocker(model, locked, drawing.id, positionKeys(drawing))

/** Where a drawing's position puts it on the sheet: a shape's or text's x and y, a line's first point. A drag snaps it. */
export function drawingOrigin(drawing: SchematicDrawing): Point {
  if (drawing.kind === "path" || drawing.kind === "bus") return drawing.points[0] ?? { x: 0, y: 0 }
  return { x: drawing.x, y: drawing.y }
}

/** A number prop as the source writes it, or where the sheet puts it (less the groups' offset) when the file leaves it out. */
function sourceNumber(info: DrawingInfo, key: "x" | "y", fallback: number): number {
  const literal = info.props[key]?.literal
  return typeof literal === "number" ? literal : roundPosition(fallback)
}

/** Where a move puts a drawing, in its own props: a line's points, or a shape's x and y. */
type Placed = { points: Point[] } | { x: number; y: number }

/** The props that move the drawing by `offset`, from the source's values. */
function movedProps(info: DrawingInfo, drawing: SchematicDrawing, offset: Point): Placed {
  if (byPoints(drawing)) return { points: (info.points ?? []).map((point) => plus(point, offset)) }
  const { groupOffset } = drawing
  const at = drawingOrigin(drawing)
  return { x: roundPosition(sourceNumber(info, "x", at.x - groupOffset.x) + offset.x), y: roundPosition(sourceNumber(info, "y", at.y - groupOffset.y) + offset.y) }
}

/** The drawing as the build will draw it with these props: the groups' offset added back. */
function shownWith(drawing: SchematicDrawing, placed: Placed): SchematicDrawing {
  const { groupOffset } = drawing
  if (drawing.kind === "path" || drawing.kind === "bus") return "points" in placed ? { ...drawing, points: placed.points.map((point) => plus(point, groupOffset)) } : drawing
  return "x" in placed ? { ...drawing, x: roundPosition(placed.x + groupOffset.x), y: roundPosition(placed.y + groupOffset.y) } : drawing
}

/** How the history names drawings: one by its name ("G1", or "the line" when it has none), several by their count. */
export function drawingWords(drawings: readonly Pick<SchematicDrawing, "id" | "name" | "kind">[]): string[] {
  if (drawings.length > 1) return [`${drawings.length} drawings`]
  return drawings.map((drawing) => drawing.name ?? `the ${KIND_WORDS[drawing.kind]}`)
}

/** What a move does to the selected drawings. */
export interface DrawingMoves {
  edits: Edit[]
  /** The history's words for the drawings it moves. */
  names: string[]
  /** Why each drawing left out stays. */
  skipped: string[]
  /** The moved drawings as the build will draw them. */
  shown: SchematicDrawing[]
}

/** One selected drawing in a move: where it goes, or why it stays. */
type DrawingMove = { id: string; drawing: SchematicDrawing; placed: Placed } | { id: string; blocker: string }

function drawingMove(model: CircuitModel, sheet: readonly SchematicDrawing[], id: string, offset: Point, locked: ReadonlySet<string>): DrawingMove {
  const drawing = sheet.find((one) => one.id === id)
  const info = drawingInfo(model, id)
  if (!drawing) return { id, blocker: `${id} is not on the sheet` }
  const blocker = drawingMoveBlocker(model, locked, drawing)
  if (blocker || !info) return { id, blocker: blocker ?? `${id} has no editable source element` }
  return { id, drawing, placed: movedProps(info, drawing, offset) }
}

/** Every selected drawing that may move, moved by `offset`; the others named with their reason. */
export function drawingMoves(model: CircuitModel, sheet: readonly SchematicDrawing[], ids: readonly string[], offset: Point, locked: ReadonlySet<string>): DrawingMoves {
  const moved = ids.map((id) => drawingMove(model, sheet, id, offset, locked))
  const going = moved.flatMap((one) => ("placed" in one ? [one] : []))
  return {
    edits: going.map(({ id, placed }): Edit => ({ kind: "setDrawingProps", id, props: { ...placed } })),
    names: drawingWords(going.map((one) => one.drawing)),
    skipped: moved.flatMap((one) => ("blocker" in one ? [one.blocker] : [])),
    shown: going.map(({ drawing, placed }) => shownWith(drawing, placed)),
  }
}

/** What Delete does to the selected drawings: the edits, the words for the history, those left out, and those that go. */
export interface DrawingsRemoval {
  edits: Edit[]
  names: string[]
  skipped: string[]
  removed: string[]
}

/**
 * The removal of the selected drawings that may go, the last in the file first: removing a drawing renumbers the
 * unnamed ones of its kind after it, so going backwards every index id still names its drawing when its turn comes.
 */
export function drawingsRemoval(model: CircuitModel, sheet: readonly SchematicDrawing[], locked: ReadonlySet<string>): (ids: readonly string[]) => DrawingsRemoval {
  return (ids) => {
    const blockers = ids.map((id) => ({ id, blocker: drawingBlocker(model, locked, id) }))
    const skipped = blockers.flatMap((one) => one.blocker ?? [])
    const removed = blockers.flatMap((one) => (one.blocker === null ? [one.id] : []))
    const start = (id: string) => drawingInfo(model, id)?.start ?? 0
    const backwards = [...removed].sort((a, b) => start(b) - start(a))
    const drawn = removed.flatMap((id) => sheet.find((drawing) => drawing.id === id) ?? [])
    return { edits: backwards.map((id) => ({ kind: "removeDrawing", id })), names: drawingWords(drawn), skipped, removed }
  }
}
