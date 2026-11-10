// What Properties shows for one selected copper pour or hole, and the edit each editable row sends: a pour's net,
// layer, priority, clearance, minimum width and thermal relief (its outline and fill area are shown), a hole's
// position and diameter. Each change is one edit of the circuit file, so one history entry. Pure; plain TypeScript
// with .js imports, so the tests run it without a DOM.
import { isHoleId } from "../../../src/core/board-items.js"
import type { Edit } from "../../../src/core/types.js"
import type { CopperPour, Hole } from "../../../src/engine/model.js"
import { lockChange } from "./group-edits.js"
import { pourNetName, poursOf, type PourDesign } from "./pour-hit.js"
import { holeDiameter } from "./pour-tool.js"

export type PourField = "net" | "layer" | "priority" | "clearance" | "minWidth" | "thermal"
export type HoleField = "x" | "y" | "diameter"
export type BoardField = PourField | HoleField

export interface BoardRow {
  label: string
  /** The value as the field shows it; an empty clearance means the net class's. */
  value: string
  field?: BoardField
  /** For a choice: the values it offers. */
  choices?: readonly { value: string; label: string }[]
}

export interface BoardProperties {
  kind: "pour" | "hole"
  title: "Copper pour" | "Hole"
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

/** The rows of the pour or hole with this id, or undefined when the design has none. */
export function boardProperties(design: PourDesign, id: string): BoardProperties | undefined {
  const pour = poursOf(design).find((one) => one.id === id)
  if (pour) return { kind: "pour", title: "Copper pour", rows: pourRows(design, pour) }
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

/** The edit a changed row sends; undefined when the value is the one shown, a message when it cannot be written. */
export function boardFieldEdit(design: PourDesign, id: string, field: BoardField, raw: string): FieldChange {
  const shown = boardProperties(design, id)?.rows.find((row) => row.field === field)
  if (!shown || shown.value === raw.trim()) return undefined
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
  const word = isHoleId(id) ? "hole" : "copper pour"
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
