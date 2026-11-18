// What Properties shows for one selected copper pour, hole or silkscreen text, and the edit each editable row sends: a
// pour's net, layer, priority, clearance, minimum width and thermal relief (its outline and fill area are shown), a
// hole's position and diameter, a text's words, position, height, turn and side. Each change is one edit of the circuit file, so one history entry. Pure; plain TypeScript
// with .js imports, so the tests run it without a DOM.
import { boardItemWord, isBoardGraphicId, isHoleId, isSilkTextId } from "../../../src/core/board-items.js"
import type { Edit } from "../../../src/core/types.js"
import type { BoardGraphic, CopperPour, Hole, SilkText } from "../../../src/engine/model.js"
import { lockChange } from "./group-edits.js"
import { pourNetName, poursOf, type PourDesign } from "./pour-hit.js"
import { holeDiameter } from "./pour-tool.js"

export type PourField = "net" | "layer" | "priority" | "clearance" | "minWidth" | "thermal"
export type HoleField = "x" | "y" | "diameter"
export type TextField = "text" | "x" | "y" | "height" | "rotation" | "layer"
export type GraphicField = "layer" | "net" | "x" | "y" | "width" | "rotation" | "fill"
export type BoardField = PourField | HoleField | TextField | GraphicField

export interface BoardRow {
  label: string
  /** The value as the field shows it; an empty clearance means the net class's. */
  value: string
  field?: BoardField
  /** For a choice: the values it offers. */
  choices?: readonly { value: string; label: string }[]
}

export interface BoardProperties {
  kind: "pour" | "hole" | "text" | "graphic"
  title: "Copper pour" | "Hole" | "Silkscreen text" | "Drawing"
  rows: BoardRow[]
}

const LAYER_CHOICES = [
  { value: "top", label: "Top Layer" },
  { value: "bottom", label: "Bottom Layer" },
] as const
/** The inner layers a 4-layer board offers a pour. */
const INNER_CHOICES = [
  { value: "inner1", label: "Inner Layer 1" },
  { value: "inner2", label: "Inner Layer 2" },
] as const
const THERMAL_CHOICES = [
  { value: "relief", label: "Relief (spokes)" },
  { value: "solid", label: "Solid" },
] as const

const number = (value: number): string => String(Number(value.toFixed(4)))

/** The fill's copper in mm², two decimals. */
export const areaText = (area: number | undefined): string => (area === undefined ? "Not filled" : `${area.toFixed(2)} mm²`)

function pourRows(design: PourDesign, pour: CopperPour): BoardRow[] {
  const nets = design.circuit.nets.flatMap((net) => (net.names[0] ? [{ value: net.names[0], label: net.names[0] }] : []))
  const fill = design.pcb.pours.find((one) => one.id === pour.id)
  return [
    { label: "Net", value: pourNetName(design, pour.net), field: "net", choices: nets },
    { label: "Layer", value: pour.layer, field: "layer", choices: design.pcb.board?.layers === 4 ? [...LAYER_CHOICES, ...INNER_CHOICES] : LAYER_CHOICES },
    { label: "Priority", value: String(pour.priority), field: "priority" },
    { label: "Clearance (mm)", value: pour.clearance === undefined ? "" : number(pour.clearance), field: "clearance" },
    { label: "Min width (mm)", value: number(pour.minWidth), field: "minWidth" },
    { label: "Thermal", value: pour.thermal, field: "thermal", choices: THERMAL_CHOICES },
    { label: "Outline", value: pour.outline ? `${pour.outline.length} corners` : "Whole board" },
    { label: "Fill area", value: areaText(fill?.area) },
  ]
}

function holeRows(hole: Hole): BoardRow[] {
  return [
    { label: "X (mm)", value: number(hole.x), field: "x" },
    { label: "Y (mm)", value: number(hole.y), field: "y" },
    { label: "Diameter (mm)", value: number(hole.diameter), field: "diameter" },
  ]
}

const SIDE_CHOICES = [
  { value: "top", label: "Top silkscreen" },
  { value: "bottom", label: "Bottom silkscreen" },
] as const

function textRows(text: SilkText): BoardRow[] {
  return [
    { label: "Text", value: text.text, field: "text" },
    { label: "X (mm)", value: number(text.x), field: "x" },
    { label: "Y (mm)", value: number(text.y), field: "y" },
    { label: "Height (mm)", value: number(text.height), field: "height" },
    { label: "Rotation (°)", value: number(text.rotation), field: "rotation" },
    { label: "Side", value: text.layer, field: "layer", choices: SIDE_CHOICES },
  ]
}

const GRAPHIC_LAYER_CHOICES = [
  { value: "top-silkscreen", label: "Top silkscreen" },
  { value: "bottom-silkscreen", label: "Bottom silkscreen" },
  { value: "top-mask", label: "Top solder mask (opening)" },
  { value: "bottom-mask", label: "Bottom solder mask (opening)" },
  { value: "top", label: "Top copper (no net)" },
  { value: "bottom", label: "Bottom copper (no net)" },
] as const
/** The inner copper layers a 4-layer board offers a drawing. */
const GRAPHIC_INNER_CHOICES = [
  { value: "inner1", label: "Inner copper 1 (no net)" },
  { value: "inner2", label: "Inner copper 2 (no net)" },
] as const
const FILL_CHOICES = [
  { value: "false", label: "As drawn" },
  { value: "true", label: "Fill closed outlines" },
] as const

/** A drawing on copper's Net row: the circuit's nets by first name, or "No net" (the empty value). */
function graphicNetRow(design: PourDesign, graphic: BoardGraphic): BoardRow[] {
  if (!["top", "bottom", "inner1", "inner2"].includes(graphic.layer)) return []
  const nets = design.circuit.nets.flatMap((net) => (net.names[0] ? [{ value: net.names[0], label: net.names[0] }] : []))
  const value = graphic.net === undefined ? "" : pourNetName(design, graphic.net)
  return [{ label: "Net", value, field: "net", choices: [{ value: "", label: "No net" }, ...nets] }]
}

function graphicRows(design: PourDesign, graphic: BoardGraphic, layers: number | undefined): BoardRow[] {
  return [
    { label: "File", value: graphic.file },
    { label: "Layer", value: graphic.layer, field: "layer", choices: layers === 4 ? [...GRAPHIC_LAYER_CHOICES, ...GRAPHIC_INNER_CHOICES] : GRAPHIC_LAYER_CHOICES },
    ...graphicNetRow(design, graphic),
    { label: "X (mm)", value: number(graphic.x), field: "x" },
    { label: "Y (mm)", value: number(graphic.y), field: "y" },
    { label: "Width (mm)", value: number(graphic.width), field: "width" },
    { label: "Height (mm)", value: number(graphic.height) },
    { label: "Rotation (°)", value: number(graphic.rotation), field: "rotation" },
    { label: "Fill", value: String(graphic.fill), field: "fill", choices: FILL_CHOICES },
  ]
}

/** A drawing row's value: the layer, fill as true or false, or a number (a width above 0). */
function graphicValue(field: GraphicField, raw: string): string | number | boolean | null | { message: string } {
  if (field === "net") return raw.trim() === "" ? null : raw
  if (field === "layer") return raw
  if (field === "fill") return raw === "true"
  return numberOf(raw, field, field === "width" ? "positive" : "any")
}

/** The rows of the pour, hole or silkscreen text with this id, or undefined when the design has none. */
export function boardProperties(design: PourDesign, id: string): BoardProperties | undefined {
  const pour = poursOf(design).find((one) => one.id === id)
  if (pour) return { kind: "pour", title: "Copper pour", rows: pourRows(design, pour) }
  const text = (design.pcb.silkTexts ?? []).find((one) => one.id === id)
  if (text) return { kind: "text", title: "Silkscreen text", rows: textRows(text) }
  const graphic = (design.pcb.graphics ?? []).find((one) => one.id === id)
  if (graphic) return { kind: "graphic", title: "Drawing", rows: graphicRows(design, graphic, design.pcb.board?.layers) }
  const hole = design.pcb.holes.find((one) => one.id === id)
  return hole && { kind: "hole", title: "Hole", rows: holeRows(hole) }
}

type FieldChange = { edit: Edit; summary: string } | { message: string } | undefined

/** A number field's text, or why it is not one: `whole` asks for a whole number, `positive` for one above 0. */
function numberOf(raw: string, label: string, rule: "whole" | "positive" | "any"): number | { message: string } {
  const value = Number(raw.trim())
  if (raw.trim() === "" || !Number.isFinite(value)) return { message: `${label} must be a number` }
  if (rule === "whole" && !Number.isInteger(value)) return { message: `${label} must be a whole number` }
  if (rule === "positive" && value <= 0) return { message: `${label} must be above 0` }
  return value
}

function pourValue(field: PourField, raw: string): string | number | null | { message: string } {
  if (field === "net" || field === "layer" || field === "thermal") return raw
  if (field === "clearance" && raw.trim() === "") return null
  return numberOf(raw, field, field === "priority" ? "whole" : "positive")
}

function holeValue(field: HoleField, raw: string): number | { message: string } {
  return field === "diameter" ? holeDiameter(raw) : numberOf(raw, field, "any")
}

/** A text row's value: the words as typed (the core refuses what the lettering cannot draw), the side, or a number. */
function textValue(field: TextField, raw: string): string | number | { message: string } {
  if (field === "text" || field === "layer") return raw
  return numberOf(raw, field, field === "height" ? "positive" : "any")
}

/** The edit a changed row sends; undefined when the value is the one shown, a message when it cannot be written. */
export function boardFieldEdit(design: PourDesign, id: string, field: BoardField, raw: string): FieldChange {
  const shown = boardProperties(design, id)?.rows.find((row) => row.field === field)
  if (!shown || shown.value === raw.trim()) return undefined
  if (isSilkTextId(id)) {
    const value = textValue(field as TextField, raw)
    if (typeof value === "object") return value
    return { edit: { kind: "setSilkText", id, props: { [field]: value } }, summary: `set ${id} ${field}=${value}` }
  }
  if (isBoardGraphicId(id)) {
    const value = graphicValue(field as GraphicField, raw)
    if (value !== null && typeof value === "object") return value
    // A width replaces a scale written in the file, so the drawing keeps its aspect at the width asked.
    const props = field === "width" ? { width: value, scale: null } : { [field]: value }
    return { edit: { kind: "setBoardGraphic", id, props }, summary: `set ${id} ${field}=${value ?? "no net"}` }
  }
  const isHole = isHoleId(id)
  const value = isHole ? holeValue(field as HoleField, raw) : pourValue(field as PourField, raw)
  if (value !== null && typeof value === "object") return value
  const summary = `set ${id} ${field}=${value === null ? "the net class's" : value}`
  if (isHole) return { edit: { kind: "setHole", id, props: { [field]: value as number } }, summary }
  return { edit: { kind: "setPour", id, props: { [field]: value } }, summary }
}

/** The Lock button of a pour's or hole's Properties: the menu command it runs, its text, whether it shows pressed, its tooltip. */
export interface BoardLockButton {
  command: "lock" | "unlock"
  label: string
  pressed: boolean
  title: string
}

/**
 * Lock for an unlocked pour or hole, Unlock for a locked one, and Lock again for a locked one changed outside the
 * editor, as a part's button does. A part's lock never covers a pour: each is locked by its own id.
 */
export function boardLockButton(id: string, locks: { locked: ReadonlySet<string>; violated: ReadonlySet<string> }): BoardLockButton {
  const word = boardItemWord(id)
  if (!locks.locked.has(id)) return { command: "lock", label: "Lock", pressed: false, title: `Lock this ${word}, so the agent cannot change or remove it` }
  if (locks.violated.has(id)) return { command: "lock", label: "Lock again", pressed: true, title: "Changed outside the editor: lock it again to accept the change" }
  return { command: "unlock", label: "Locked", pressed: true, title: `Unlock this ${word}` }
}

/** What Layout → Lock or Unlock sends for the selection: the selected parts' names and pours' and holes' ids it changes, or why none. */
export function selectionLockChange(
  selection: { names: readonly string[]; board: readonly string[] },
  locked: ReadonlySet<string>,
  on: boolean,
  violated: ReadonlySet<string> = new Set(),
): { parts: string[] } | { message: string } {
  return lockChange([...selection.names, ...selection.board], locked, on, violated)
}
