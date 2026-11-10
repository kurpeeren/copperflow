// What Properties shows for one drawing and what its fields write: the kind and name, then the props of its kind
// (position, size or points, line width, line style, colour, fill, text and font size), each as the file has it (a
// drawing in a group shows its own props, not where the group puts it). A bus's name can be typed (a rename) and its
// members are listed. A typed value is checked as the engine would, then written with one setDrawingProps, so each
// field's commit is one history entry. Pure; InspectorDrawing.tsx draws it.
import type { CircuitModel, DrawingInfo, DrawingValue, Edit } from "../../../src/core/types.js"
import { LINE_STYLES, TEXT_ANCHORS } from "../../../src/engine/drawing-kinds.js"
import type { Point, SchematicDrawing } from "../../../src/engine/model.js"
import { busNameProblem, membersText } from "./bus-tool.js"
import { KIND_WORDS } from "./drawing-actions.js"
import { roundPosition } from "./geometry.js"
import { sheetPalette } from "./schematic-theme.js"

/** How a row's value is shown and typed. */
export type DrawingField = "static" | "number" | "text" | "points" | "choice" | "check" | "color"

/** One row of a drawing's Properties. */
export interface DrawingRow {
  /** The prop it writes ("x", "points", …), or "kind" and "name" for the rows that only show. */
  key: string
  label: string
  value: string
  field: DrawingField
  /** The choices of a choice row. */
  options?: readonly string[]
  /** What an empty colour stands for. */
  placeholder?: string
  /** Whether it can be typed in: the drawing may be changed and the prop is a literal. */
  editable: boolean
  /** What the field does, shown as its tooltip. */
  hint?: string
}

type NumberRule = "any" | "positive" | "nonNegative"

interface Spec {
  label: string
  field: Exclude<DrawingField, "static">
  rule?: NumberRule
  options?: readonly string[]
}

const SPECS: Record<string, Spec> = {
  x: { label: "X", field: "number" },
  y: { label: "Y", field: "number" },
  points: { label: "Points", field: "points" },
  width: { label: "Width", field: "number", rule: "positive" },
  height: { label: "Height", field: "number", rule: "positive" },
  radius: { label: "Radius", field: "number", rule: "positive" },
  startAngle: { label: "Start angle", field: "number" },
  endAngle: { label: "End angle", field: "number" },
  text: { label: "Text", field: "text" },
  fontSize: { label: "Font size", field: "number", rule: "positive" },
  anchor: { label: "Anchor", field: "choice", options: TEXT_ANCHORS },
  strokeWidth: { label: "Stroke width", field: "number", rule: "nonNegative" },
  lineStyle: { label: "Line style", field: "choice", options: LINE_STYLES },
  color: { label: "Colour", field: "color" },
  filled: { label: "Filled", field: "check" },
}

const LINE = ["strokeWidth", "lineStyle", "color"]

/** The props each kind shows, in order. */
const KEYS: Record<SchematicDrawing["kind"], readonly string[]> = {
  path: ["points", ...LINE],
  rect: ["x", "y", "width", "height", ...LINE, "filled"],
  circle: ["x", "y", "radius", ...LINE, "filled"],
  arc: ["x", "y", "radius", "startAngle", "endAngle", ...LINE],
  text: ["x", "y", "text", "fontSize", "anchor", "color"],
  bus: ["points"],
}

const KIND_TITLES: Record<SchematicDrawing["kind"], string> = { path: "Line", rect: "Rectangle", circle: "Circle", arc: "Arc", text: "Text", bus: "Bus" }

/** Points as Properties writes them: "0, 0; 1, 0". */
const pointsText = (points: readonly Point[]): string => points.map((point) => `${point.x}, ${point.y}`).join("; ")

/** A prop's value as the file has it: the drawn value less what the groups add, for a position. */
function valueOf(drawing: SchematicDrawing, key: string): string {
  const { groupOffset } = drawing
  if ((drawing.kind === "path" || drawing.kind === "bus") && key === "points") {
    return pointsText(drawing.points.map((point) => ({ x: roundPosition(point.x - groupOffset.x), y: roundPosition(point.y - groupOffset.y) })))
  }
  const value = (drawing as unknown as Record<string, unknown>)[key]
  if (key === "x" || key === "y") return String(roundPosition((value as number) - groupOffset[key]))
  return value === undefined ? "" : String(value)
}

/** The row of one prop: its value, or the code when the file writes it as an expression (then it is no field). */
function propRow(drawing: SchematicDrawing, info: DrawingInfo | undefined, key: string, canEdit: boolean): DrawingRow {
  const spec = SPECS[key] as Spec
  const prop = info?.props[key]
  const expression = prop !== undefined && !prop.editable
  const placeholder = key === "color" ? { placeholder: sheetPalette().drawing } : {}
  const options = spec.options ? { options: spec.options } : {}
  const value = expression ? prop.source : valueOf(drawing, key)
  return { key, label: spec.label, value, field: spec.field, ...options, ...placeholder, editable: canEdit && info !== undefined && !expression }
}

export const BUS_RENAME_HINT = "Renames this piece of the bus only; its wires keep their nets"

/** The name row: a bus's name is a field while its name is a literal; it is followed by the bus's members. */
function nameRows(drawing: SchematicDrawing, info: DrawingInfo | undefined, canEdit: boolean): DrawingRow[] {
  if (drawing.kind !== "bus") return [{ key: "name", label: "Name", value: drawing.name ?? "(none)", field: "static", editable: false }]
  const name: DrawingRow = { key: "name", label: "Name", value: drawing.name, field: "text", editable: canEdit && info?.name !== undefined, hint: BUS_RENAME_HINT }
  return [name, { key: "members", label: "Members", value: membersText(drawing.members), field: "static", editable: false }]
}

/** Every row for one drawing; `canEdit` is false while it is locked or read-only. */
export function drawingRows(drawing: SchematicDrawing, info: DrawingInfo | undefined, canEdit: boolean): DrawingRow[] {
  const line = info?.line ?? drawing.source.line
  return [
    { key: "kind", label: "Kind", value: `${KIND_TITLES[drawing.kind]}, line ${line}`, field: "static", editable: false },
    ...nameRows(drawing, info, canEdit),
    ...KEYS[drawing.kind].map((key) => propRow(drawing, info, key, canEdit)),
  ]
}

const COLOR = /^#[0-9A-Fa-f]{6}$/
const NUMBER_RULES: Record<NumberRule, { ok: (value: number) => boolean; says: string }> = {
  any: { ok: () => true, says: "must be a number" },
  positive: { ok: (value) => value > 0, says: "must be a number greater than 0" },
  nonNegative: { ok: (value) => value >= 0, says: "must be a number of 0 or more" },
}

/** Typed points, "x, y; x, y; …", or undefined when they are not two or more pairs of numbers. */
function parsePoints(text: string): Point[] | undefined {
  const pairs = text.split(";").map((pair) => pair.split(",").map((part) => part.trim()))
  const points = pairs.map((pair) => (pair.length === 2 && pair.every((part) => part !== "" && Number.isFinite(Number(part))) ? { x: roundPosition(Number(pair[0])), y: roundPosition(Number(pair[1])) } : undefined))
  return points.length >= 2 && points.every((point) => point !== undefined) ? (points as Point[]) : undefined
}

/** A typed value as the prop takes it, or the reason it is refused. */
function parseField(spec: Spec, text: string): DrawingValue | { message: string } {
  const trimmed = text.trim()
  if (spec.field === "number") {
    const rule = NUMBER_RULES[spec.rule ?? "any"]
    const value = Number(trimmed)
    return trimmed !== "" && Number.isFinite(value) && rule.ok(value) ? value : { message: `${spec.label} ${rule.says}` }
  }
  if (spec.field === "points") return parsePoints(trimmed) ?? { message: `${spec.label} needs two or more x, y pairs, such as 0, 0; 1, 0` }
  if (spec.field === "choice") return spec.options?.includes(trimmed) ? trimmed : { message: `${spec.label} must be one of ${spec.options?.join(", ")}` }
  if (spec.field === "check") return trimmed === "true" || trimmed === "false" ? trimmed === "true" : { message: `${spec.label} must be true or false` }
  if (spec.field === "color") return COLOR.test(trimmed) ? trimmed : { message: `${spec.label} must be a colour such as "#000080"` }
  return text === "" ? { message: `${spec.label} cannot be empty` } : text
}

type FieldEdit = { edit: Edit; summary: string } | { message: string }

/** A bus's new name, checked as the engine checks it against the parts and drawings of `model`. */
function busRename(drawing: Extract<SchematicDrawing, { kind: "bus" }>, text: string, model: Pick<CircuitModel, "parts" | "drawings">): FieldEdit {
  const name = text.trim()
  const problem = busNameProblem(model, name, drawing.id)
  if (problem) return { message: problem }
  return { edit: { kind: "setDrawingProps", id: drawing.id, props: { name } }, summary: `rename the bus ${drawing.name} to ${name}` }
}

/** The edit a field's commit writes, with its line in the history, or why the typed value is refused. `model` checks a bus's new name. */
export function drawingFieldEdit(drawing: SchematicDrawing, key: string, text: string, model?: Pick<CircuitModel, "parts" | "drawings">): FieldEdit {
  if (key === "name" && drawing.kind === "bus" && model) return busRename(drawing, text, model)
  const spec = SPECS[key]
  if (!spec) return { message: `${key} cannot be set here` }
  const value = parseField(spec, text)
  if (typeof value === "object" && !Array.isArray(value)) return value
  const word = drawing.name ?? `the ${KIND_WORDS[drawing.kind]}`
  const summary = Array.isArray(value) ? `set ${word} ${key}` : `set ${word} ${key}=${JSON.stringify(value)}`
  return { edit: { kind: "setDrawingProps", id: drawing.id, props: { [key]: value } }, summary }
}
