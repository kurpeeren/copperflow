// The PCB's Place → Copper pour and Place → Hole tools as plain data: the corners of a pour drawn as the schematic's
// polyline is (a click per corner, a double click or Enter closes it, Backspace removes the last corner, Esc cancels),
// the hole's diameter field, and the edits they send: a pour on the active layer, of GND when the circuit has it, and
// a hole. A pour's corners can be dragged afterwards (pourCornerEdit), and Delete removes pours and holes
// (boardRemoval). Plain TypeScript with .js imports, so the tests run it without a DOM.
import { boardItemInstance, boardItemWord, instanceItemRefusal, isBoardGraphicId, isHoleId, isSilkTextId, outlineProblem } from "../../../src/core/board-items.js"
import { sheetFileIn } from "../../../src/core/selectors.js"
import type { BoardItemInfo, CircuitModel, Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { Point } from "../../../src/engine/model.js"
import type { ActiveLayer } from "./layers.js"

export type PourTool = "pour" | "hole"

/** An armed tool and the corners of the pour in progress (none: waiting for the first click). */
export interface PourToolState {
  tool: PourTool
  points: readonly Point[]
}

export type PourToolEvent =
  | { type: "press"; at: Point; double: boolean }
  /** Enter. */
  | { type: "finish" }
  /** Backspace. */
  | { type: "removeCorner" }
  /** Esc or a right click. */
  | { type: "cancel" }

/** The next state (null: the tool is put away), and the outline of a closed pour or the place of a hole. */
export interface PourToolStep {
  state: PourToolState | null
  /** Why the outline could not close. */
  refused?: string
  outline?: Point[]
  hole?: Point
}

export const DEFAULT_HOLE_DIAMETER = 3.2
/** The net a new pour takes when the circuit has it. */
export const DEFAULT_POUR_NET = "GND"
/** The largest hole the field takes, in mm. */
const MAX_HOLE = 100

export const idlePourTool = (tool: PourTool): PourToolState => ({ tool, points: [] })

const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y
const keep = (state: PourToolState): PourToolStep => ({ state })

/** The corners without repeats in a row (a double click's second press lands on the first's corner). */
function corners(points: readonly Point[]): Point[] {
  return points.filter((p, i) => i === 0 || !same(p, points[i - 1] as Point))
}

/**
 * A pour closes with three corners or more that make a simple polygon; fewer wait for more, and an outline with no
 * area or crossing edges is refused with the reason, its corners kept so Backspace can mend it.
 */
function close(state: PourToolState): PourToolStep {
  const ring = corners(state.points)
  if (ring.length >= 3 && ring.at(-1) && same(ring[0] as Point, ring.at(-1) as Point)) ring.pop()
  if (ring.length < 3) return keep(state)
  const problem = outlineProblem(ring)
  return problem ? { state, refused: `Not closed: ${problem}` } : { state: idlePourTool(state.tool), outline: ring }
}

function press(state: PourToolState, at: Point, double: boolean): PourToolStep {
  if (state.tool === "hole") return { state, hole: at }
  if (double && state.points.length > 0) return close(state)
  const first = state.points[0]
  // A click on the first corner closes the outline, as it does in EasyEDA.
  if (first && state.points.length >= 3 && same(first, at)) return close(state)
  return keep({ ...state, points: corners([...state.points, at]) })
}

/** What one event does to the armed tool. */
export function pourToolStep(state: PourToolState, event: PourToolEvent): PourToolStep {
  switch (event.type) {
    case "press":
      return press(state, event.at, event.double)
    case "finish":
      return state.tool === "pour" ? close(state) : keep(state)
    case "removeCorner":
      return keep({ ...state, points: state.points.slice(0, -1) })
    case "cancel":
      return { state: state.points.length > 0 ? idlePourTool(state.tool) : null }
  }
}

/** The outline in progress as it would close at the pointer; empty while nothing is drawn. */
export function pourPreview(state: PourToolState | null, pointer: Point | undefined): Point[] {
  if (!state || state.tool !== "pour" || state.points.length === 0) return []
  return pointer ? corners([...state.points, pointer]) : [...state.points]
}

/** The net a new pour is on: GND when the circuit has a net of that name, else the first named net. */
export function defaultPourNet(design: Pick<Design, "circuit">): string | undefined {
  const names = design.circuit.nets.flatMap((net) => net.names)
  return names.includes(DEFAULT_POUR_NET) ? DEFAULT_POUR_NET : names[0]
}

/** The edit that adds a pour (no outline: the whole board) of `net` on the active layer. */
export function pourEdit(net: string, layer: ActiveLayer, outline?: readonly Point[]): Extract<Edit, { kind: "addPour" }> {
  return { kind: "addPour", net, layer, ...(outline ? { outline: [...outline] } : {}) }
}

export const pourSummary = (net: string, layer: ActiveLayer, whole: boolean): string => `add a ${net} copper pour on the ${layer} layer${whole ? " over the whole board" : ""}`

export function holeEdit(at: Point, diameter: number): Extract<Edit, { kind: "addHole" }> {
  return { kind: "addHole", x: at.x, y: at.y, diameter }
}

export const holeSummary = (diameter: number): string => `add a ${diameter} mm hole`

/** The diameter field's text as a number of mm, or what is wrong with it. */
export function holeDiameter(raw: string): number | { message: string } {
  const value = Number(raw.trim().replace(/\s*mm$/i, ""))
  if (raw.trim() === "" || !Number.isFinite(value) || value <= 0 || value > MAX_HOLE) return { message: `The diameter must be a number of mm above 0 and at most ${MAX_HOLE}` }
  return Math.round(value * 1000) / 1000
}

/**
 * The edit that writes a pour's outline with one corner moved: one history entry; or, when the moved outline would
 * not be a simple polygon (the corner on another, on the line through its neighbours, or edges crossing), why not.
 */
export function pourCornerEdit(id: string, outline: readonly Point[], index: number, to: Point): { edit: Edit; summary: string } | { message: string } {
  const moved = outline.map((corner, i) => (i === index ? { x: to.x, y: to.y } : { x: corner.x, y: corner.y }))
  const problem = outlineProblem(moved)
  if (problem) return { message: `Not moved: the outline would not be a simple polygon (${problem})` }
  return { edit: { kind: "setPour", id, props: { outline: moved } }, summary: `move a corner of ${id}` }
}

/**
 * Why a pour or hole cannot be edited (inside a sub-sheet instance, locked, or read-only in the code), or null when it
 * can. One of an instance is edited in its sheet file, as a part inside an instance is.
 */
export function boardItemBlocker(model: Pick<CircuitModel, "boardItems"> & Partial<Pick<CircuitModel, "parts" | "imports">>, locked: ReadonlySet<string>, id: string): string | null {
  const instance = boardItemInstance(id)
  if (instance !== undefined) return instanceItemRefusal(id, instance, sheetFileIn({ parts: model.parts ?? [], imports: model.imports ?? [] }, instance))
  const item = model.boardItems?.find((one) => one.id === id)
  if (!item) return `${id} is not in the code yet`
  if (locked.has(id)) return `${id} is locked`
  return item.editable ? null : `${id} is read-only (${item.readonlyReason})`
}

export interface BoardRemoval {
  edits: Edit[]
  names: string[]
  skipped: string[]
  removed: string[]
}

const indexOf = (id: string): number => Number(id.slice(id.indexOf(":") + 1))
const nameOf = (item: Pick<BoardItemInfo, "tag" | "id">): string => `${boardItemWord(item.id)} ${indexOf(item.id)}`
const removalOf = (id: string): Edit => (isHoleId(id) ? { kind: "removeHole", id } : isSilkTextId(id) ? { kind: "removeSilkText", id } : isBoardGraphicId(id) ? { kind: "removeBoardGraphic", id } : { kind: "removePour", id })

/**
 * The removal of the selected pours and holes that may go, the last of each kind first: removing one renumbers the
 * later ones of its kind, so going backwards every id still names its element when its turn comes.
 */
export function boardRemoval(model: Pick<CircuitModel, "boardItems"> & Partial<Pick<CircuitModel, "parts" | "imports">>, locked: ReadonlySet<string>): (ids: readonly string[]) => BoardRemoval {
  return (ids) => {
    const blockers = ids.map((id) => ({ id, blocker: boardItemBlocker(model, locked, id) }))
    const removed = blockers.flatMap((one) => (one.blocker === null ? [one.id] : []))
    const backwards = [...removed].sort((a, b) => indexOf(b) - indexOf(a))
    const edits = backwards.map(removalOf)
    const items = removed.flatMap((id) => model.boardItems?.find((one) => one.id === id) ?? [])
    return { edits, names: items.map(nameOf), skipped: blockers.flatMap((one) => one.blocker ?? []), removed }
  }
}

const STOPS = "Esc or a right click stops."

/** The status line's hint for the armed tool. */
export function pourHint(state: PourToolState | null): string | undefined {
  if (!state) return undefined
  if (state.tool === "hole") return `Click where the hole goes; set its diameter in the field. ${STOPS}`
  if (state.points.length === 0) return `Click the first corner of the copper pour. ${STOPS}`
  return "Click for each corner; double click, Enter or a click on the first corner closes the pour. Backspace removes a corner, Esc cancels."
}
