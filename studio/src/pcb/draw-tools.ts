// The schematic's drawing tools (Place → Polyline, Arc, Circle, Rectangle, Text) as plain data: a tool's state, what
// each event does to it, the drawing it writes, the dashed preview of the shape in progress and the hint. The hook
// (use-draw-tools.ts) only turns pointer and key events into these events.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { CircuitModel, DrawingValue, Edit } from "../../../src/core/types.js"
import { nextDrawingName } from "../../../src/core/drawing-names.js"
import type { Point, SchematicDrawing } from "../../../src/engine/model.js"
import { snapPoint } from "./geometry.js"
import { squarePath } from "./wire-path.js"

export type DrawTool = "polyline" | "rectangle" | "circle" | "arc" | "text"

/**
 * An armed tool and the clicks of the shape in progress (on the grid while Snap is on): a polyline's corners, a
 * rectangle's first corner, a circle's centre, an arc's centre and start, a text's place. No points: waiting for the
 * first click. `flip` turns the bend of a polyline's squared leg; `dragging` is a rectangle's first corner still held.
 */
export interface DrawState {
  tool: DrawTool
  points: readonly Point[]
  flip: boolean
  dragging: boolean
}

export type DrawEvent =
  | { type: "press"; at: Point; shift: boolean; double: boolean }
  | { type: "release"; at: Point }
  /** Enter. */
  | { type: "finish" }
  /** Backspace. */
  | { type: "removeCorner" }
  /** Space. */
  | { type: "flip" }
  /** Esc or a right click. */
  | { type: "cancel" }
  /** Enter in the text field. */
  | { type: "text"; text: string }

/** What a finished shape writes, before it is named. */
export interface NewDrawing {
  tag: "schematicpath" | "schematicrect" | "schematiccircle" | "schematicarc" | "schematictext"
  props: Record<string, DrawingValue>
}

/** The next state (null: the tool is put away) and the drawing to write, if the event finished one. */
export interface DrawStep {
  state: DrawState | null
  drawing?: NewDrawing
}

export const TEXT_SIZE = 0.1
/** Two presses this close in time (ms) and place (CSS pixels) are a double click. */
export const DOUBLE_CLICK_MS = 400
export const DOUBLE_CLICK_PX = 4

const round = (value: number): number => Math.round(value * 10000) / 10000 || 0
const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y
const distance = (a: Point, b: Point): number => round(Math.hypot(b.x - a.x, b.y - a.y))

/** Degrees counter-clockwise from +x, from 0 up to 360. */
function angle(centre: Point, at: Point): number {
  const degrees = (Math.atan2(at.y - centre.y, at.x - centre.x) * 180) / Math.PI
  return round(((degrees % 360) + 360) % 360) % 360
}

export const idleState = (tool: DrawTool): DrawState => ({ tool, points: [], flip: false, dragging: false })

/** A click's point: on the grid while Snap is on, rounded to 4 decimals. */
export function toolPoint(world: Point, step: number, snap: boolean): Point {
  const at = snapPoint(world, step, snap)
  return { x: round(at.x), y: round(at.y) }
}

/** Whether a press (screen point, ms) is the second of a double click after `last`. */
export function isDoubleClick(last: { at: Point; time: number } | undefined, now: { at: Point; time: number }): boolean {
  if (!last) return false
  return now.time - last.time <= DOUBLE_CLICK_MS && Math.hypot(now.at.x - last.at.x, now.at.y - last.at.y) <= DOUBLE_CLICK_PX
}

/** The polyline's corners with the leg to `to` added: squared with Shift (with the leg's bend), else straight. */
function withLeg(state: DrawState, to: Point, shift: boolean): Point[] {
  const last = state.points.at(-1)
  if (!last) return [to]
  const leg = shift ? squarePath([last, to], [state.flip]).slice(1) : [to]
  return [...state.points, ...leg.map((p) => ({ x: round(p.x), y: round(p.y) }))].filter((p, i, all) => i === 0 || !same(p, all[i - 1] as Point))
}

function rectProps(a: Point, b: Point): Record<string, number> | undefined {
  const [width, height] = [round(Math.abs(b.x - a.x)), round(Math.abs(b.y - a.y))]
  if (width === 0 || height === 0) return undefined
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width, height }
}

function arcProps(centre: Point, start: Point, end: Point): Record<string, number> | undefined {
  const [startAngle, endAngle] = [angle(centre, start), angle(centre, end)]
  if (same(end, centre) || startAngle === endAngle) return undefined
  return { x: centre.x, y: centre.y, radius: distance(centre, start), startAngle, endAngle }
}

const done = (tool: DrawTool, drawing: NewDrawing): DrawStep => ({ state: idleState(tool), drawing })
const keep = (state: DrawState): DrawStep => ({ state })

function finishPolyline(state: DrawState): DrawStep {
  if (state.points.length < 2) return keep(idleState("polyline"))
  return done("polyline", { tag: "schematicpath", props: { points: [...state.points] } })
}

function pressPolyline(state: DrawState, event: Extract<DrawEvent, { type: "press" }>): DrawStep {
  if (event.double && state.points.length > 0) return finishPolyline(state)
  return keep({ ...state, points: withLeg(state, event.at, event.shift) })
}

function pressRectangle(state: DrawState, at: Point): DrawStep {
  const [corner] = state.points
  if (!corner) return keep({ ...state, points: [at], dragging: true })
  const props = rectProps(corner, at)
  return props ? done("rectangle", { tag: "schematicrect", props }) : keep(state)
}

function pressCircle(state: DrawState, at: Point): DrawStep {
  const [centre] = state.points
  if (!centre) return keep({ ...state, points: [at] })
  const radius = distance(centre, at)
  return radius > 0 ? done("circle", { tag: "schematiccircle", props: { x: centre.x, y: centre.y, radius } }) : keep(state)
}

function pressArc(state: DrawState, at: Point): DrawStep {
  const [centre, start] = state.points
  if (!centre) return keep({ ...state, points: [at] })
  if (!start) return same(at, centre) ? keep(state) : keep({ ...state, points: [centre, at] })
  const props = arcProps(centre, start, at)
  return props ? done("arc", { tag: "schematicarc", props }) : keep(state)
}

function press(state: DrawState, event: Extract<DrawEvent, { type: "press" }>): DrawStep {
  switch (state.tool) {
    case "polyline":
      return pressPolyline(state, event)
    case "rectangle":
      return pressRectangle(state, event.at)
    case "circle":
      return pressCircle(state, event.at)
    case "arc":
      return pressArc(state, event.at)
    case "text":
      return keep({ ...state, points: [event.at] })
  }
}

/** A rectangle's press-drag ends at the release; a release where it was pressed leaves it waiting for a second click. */
function release(state: DrawState, at: Point): DrawStep {
  const [corner] = state.points
  if (state.tool !== "rectangle" || !state.dragging || !corner) return keep(state)
  const props = rectProps(corner, at)
  return props ? done("rectangle", { tag: "schematicrect", props }) : keep({ ...state, dragging: false })
}

function typed(state: DrawState, text: string): DrawStep {
  const [at] = state.points
  const value = text.trim()
  if (state.tool !== "text" || !at || value === "") return keep(idleState(state.tool))
  return done("text", { tag: "schematictext", props: { x: at.x, y: at.y, text: value, fontSize: TEXT_SIZE, anchor: "left" } })
}

/** What one event does to the armed tool. */
export function drawStep(state: DrawState, event: DrawEvent): DrawStep {
  switch (event.type) {
    case "press":
      return press(state, event)
    case "release":
      return release(state, event.at)
    case "finish":
      return state.tool === "polyline" ? finishPolyline(state) : keep(state)
    case "removeCorner":
      return keep(state.points.length <= 1 ? idleState(state.tool) : { ...state, points: state.points.slice(0, -1) })
    case "flip":
      return keep({ ...state, flip: !state.flip })
    case "cancel":
      return { state: state.points.length > 0 ? idleState(state.tool) : null }
    case "text":
      return typed(state, event.text)
  }
}

const NO_SOURCE = { file: "", line: 0, column: 0, offset: 0 }
const DASHED = { strokeWidth: 0.01, lineStyle: "dashed" as const, groupOffset: { x: 0, y: 0 }, source: NO_SOURCE }

/** The shape in progress as it would end at the pointer, drawn dashed; undefined while nothing is in progress. */
export function previewDrawing(state: DrawState, pointer: Point, shift: boolean): SchematicDrawing | undefined {
  const [first, second] = state.points
  if (!first) return undefined
  const id = "drawing:preview"
  if (state.tool === "polyline") return { id, kind: "path", points: withLeg(state, pointer, shift), ...DASHED }
  if (state.tool === "rectangle") {
    const props = rectProps(first, pointer)
    return props && { id, kind: "rect", x: props.x ?? 0, y: props.y ?? 0, width: props.width ?? 0, height: props.height ?? 0, filled: false, ...DASHED }
  }
  if (state.tool === "circle") return { id, kind: "circle", x: first.x, y: first.y, radius: distance(first, pointer), filled: false, ...DASHED }
  if (state.tool !== "arc") return undefined
  if (!second) return { id, kind: "path", points: [first, pointer], ...DASHED }
  const props = arcProps(first, second, pointer)
  return props && { id, kind: "arc", x: first.x, y: first.y, radius: props.radius ?? 0, startAngle: props.startAngle ?? 0, endAngle: props.endAngle ?? 0, ...DASHED }
}

/** A sent drawing as it is drawn dashed until its build. */
export function sentDrawing(drawing: NewDrawing, id: string): SchematicDrawing {
  const { props } = drawing
  const n = (key: string): number => Number(props[key] ?? 0)
  const at = { id, x: n("x"), y: n("y") }
  switch (drawing.tag) {
    case "schematicpath":
      return { id, kind: "path", points: (props["points"] ?? []) as Point[], ...DASHED }
    case "schematicrect":
      return { ...at, kind: "rect", width: n("width"), height: n("height"), filled: false, ...DASHED }
    case "schematiccircle":
      return { ...at, kind: "circle", radius: n("radius"), filled: false, ...DASHED }
    case "schematicarc":
      return { ...at, kind: "arc", radius: n("radius"), startAngle: n("startAngle"), endAngle: n("endAngle"), ...DASHED }
    case "schematictext":
      return { ...at, kind: "text", text: String(props["text"] ?? ""), fontSize: TEXT_SIZE, anchor: "left", groupOffset: DASHED.groupOffset, source: NO_SOURCE }
  }
}

const NUMBERED = /^G(\d+)$/

/**
 * The edit that adds the drawing, named G<n> after the highest G number a part or drawing has, and after the names
 * in `taken`: drawings sent whose build has not come back yet.
 */
export function drawingEdit(drawing: NewDrawing, model: Pick<CircuitModel, "parts" | "drawings">, taken: readonly string[] = []): Extract<Edit, { kind: "addDrawing" }> {
  const next = Number(NUMBERED.exec(nextDrawingName(model))?.[1] ?? 1)
  const highest = Math.max(next - 1, ...taken.map((name) => Number(NUMBERED.exec(name)?.[1] ?? 0)))
  return { kind: "addDrawing", tag: drawing.tag, name: `G${highest + 1}`, props: drawing.props }
}

const WORDS: Record<DrawTool, string> = { polyline: "line", rectangle: "rectangle", circle: "circle", arc: "arc", text: "text" }

/** The history line of a new drawing, e.g. "add the rectangle G3". */
export const drawSummary = (tool: DrawTool, name: string): string => `add the ${WORDS[tool]} ${name}`

const STOPS = "Esc or a right click stops."
const CANCELS = "Esc cancels."

const FIRST_CLICK: Record<DrawTool, string> = {
  polyline: `Click to start a polyline, Enter to finish. ${STOPS}`,
  rectangle: `Drag, or click two opposite corners, to draw a rectangle. ${STOPS}`,
  circle: `Click the centre of a circle. ${STOPS}`,
  arc: `Click the centre of an arc. ${STOPS}`,
  text: `Click where the text goes. ${STOPS}`,
}

const POLYLINE_ON = `Click for each corner, double click or Enter to finish. Shift keeps a leg square and Space flips its bend; Backspace removes a corner, ${CANCELS}`

/** The status line's hint for the armed tool: what the next click does. */
export function drawHint(state: DrawState | null): string | undefined {
  if (!state) return undefined
  const count = state.points.length
  if (count === 0) return FIRST_CLICK[state.tool]
  if (state.tool === "polyline") return POLYLINE_ON
  if (state.tool === "rectangle") return `Click the opposite corner. ${CANCELS}`
  if (state.tool === "circle") return `Click to set the radius. ${CANCELS}`
  if (state.tool === "text") return `Type the text; Enter writes it, ${CANCELS}`
  return count === 1 ? `Click where the arc starts. Backspace steps back, ${CANCELS}` : `Click where the arc ends. Backspace steps back, ${CANCELS}`
}
