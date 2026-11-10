import type { PropInfo } from "../../src/core/types.js"
import { lockChange } from "./pcb/group-edits.js"
import type { CommandId } from "./shell/menus.js"

/** What the sections need to know about a part. */
export interface InspectorPart {
  tag: string
  props: Record<string, PropInfo>
}

/**
 * A row names what the component draws in it: "name", "kind", "placed", "lock", "connections", "library", "notes",
 * "prop:<key>" for a prop the part has, "suggest:<key>" for a usual prop it does not have yet,
 * "part:<name>" for one part of a selection of several, and "kind:<parts|wires>:<count>" for how many of each kind.
 */
export interface InspectorSection {
  title: string
  rows: string[]
}

/**
 * Where the focus goes when a double click opens Properties on a part: the first property field that can be typed
 * in, in a section that is open. A locked or read-only part has none, and the focus stays where it was.
 */
export const FIRST_FIELD = ".insp-body:not([hidden]) .insp-value input:not([disabled]):not([type=\"checkbox\"])"

/** The props people usually set on each built-in part, with an example value. */
export const SUGGESTED_PROPS: Record<string, [string, string][]> = {
  resistor: [["resistance", "10k"], ["footprint", "0402"]],
  capacitor: [["capacitance", "100nF"], ["footprint", "0402"]],
  inductor: [["inductance", "10uH"], ["footprint", "0805"]],
  led: [["color", "green"], ["footprint", "0603"]],
  diode: [["footprint", "sod123"]],
  fuse: [["currentRating", "500mA"], ["footprint", "1206"]],
  crystal: [["frequency", "16MHz"], ["footprint", "hc49"]],
  pinheader: [["pinCount", "4"], ["pitch", "2.54mm"]],
  // A sheet's port: where its pin sits on the sheet symbol.
  port: [["side", "left"], ["order", "1"]],
}

/** Props that say where a part is, in the order the Position section shows them. */
export const POSITION_PROPS = ["pcbX", "pcbY", "pcbRotation", "schX", "schY", "schRotation", "side", "layer"]

/** Props that move the part's name, value and silkscreen designator: shown in Position, set by dragging them on the canvas. */
export const TEXT_POSITION_PROPS = ["schNameAt", "schValueAt", "pcbNameAt"]

/** The prop the Footprint section holds; footprint parameters join it in later rounds. */
const FOOTPRINT = "footprint"

/** The Footprint section's row: the part's footprint, or the usual one offered when it has none; empty when neither. */
function footprintRows(part: InspectorPart, suggested: readonly string[]): string[] {
  if (FOOTPRINT in part.props) return [`prop:${FOOTPRINT}`]
  return suggested.includes(FOOTPRINT) ? [`suggest:${FOOTPRINT}`] : []
}

/** The row of a part the engine placed in the open view (it has no position there of its own yet). */
export const PLACED_ROW = { label: "Placement", value: "Placed by Studio" } as const

/** What the sections show besides the part: a Library section, and whether Studio placed the part in the open view. */
export interface SectionOptions {
  library: boolean
  autoPlaced?: boolean
}

/** The sections of a selected part and the rows each holds. */
export function inspectorSections(part: InspectorPart, opts: SectionOptions): InspectorSection[] {
  const valueKeys = Object.keys(part.props).filter((key) => !POSITION_PROPS.includes(key) && !TEXT_POSITION_PROPS.includes(key) && key !== FOOTPRINT)
  const suggested = (SUGGESTED_PROPS[part.tag] ?? []).map(([key]) => key).filter((key) => !(key in part.props))
  const missing = suggested.filter((key) => key !== FOOTPRINT)
  const placed = POSITION_PROPS.filter((key) => key in part.props)
  const moved = TEXT_POSITION_PROPS.filter((key) => key in part.props)
  const footprint = footprintRows(part, suggested)
  return [
    { title: "Basic", rows: ["name", "kind", ...valueKeys.map((k) => `prop:${k}`), ...missing.map((k) => `suggest:${k}`)] },
    ...(footprint.length > 0 ? [{ title: "Footprint", rows: footprint }] : []),
    { title: "Position", rows: [...(opts.autoPlaced ? ["placed"] : []), ...placed.map((k) => `prop:${k}`), ...moved.map((k) => `textAt:${k}`), "lock"] },
    { title: "Connections", rows: ["connections"] },
    ...(opts.library ? [{ title: "Library", rows: ["library"] }] : []),
    { title: "Notes", rows: ["notes"] },
  ]
}

/** The sections when nothing is selected. */
export function boardSections(): InspectorSection[] {
  return [
    { title: "Build", rows: ["build"] },
    { title: "Notes for the agent", rows: ["notes"] },
  ]
}

/** A selected part as Properties sees it. */
export interface SelectedPart extends InspectorPart {
  name: string
}

/** What Properties shows: the header's count and the sections under it. */
export interface PropertiesView {
  header: string
  sections: InspectorSection[]
}

/**
 * What Properties shows for a selection of `parts` parts, `wires` wires, `labels` net labels and flags and `drawings`
 * drawings: the board, one part's, one wire's, one label's, one drawing's, or the group's.
 */
export type PropertiesKind = "board" | "part" | "wire" | "label" | "drawing" | "copper" | "text" | "pour" | "group"

/** `texts` counts the parts' names and values (or designators) selected. */
export function propertiesKind(parts: number, wires: number, labels = 0, drawings = 0, copper = 0, texts = 0, pours = 0): PropertiesKind {
  const total = parts + wires + labels + drawings + copper + texts + pours
  if (total === 0) return "board"
  if (total > 1) return "group"
  if (parts === 1) return "part"
  if (wires === 1) return "wire"
  if (copper === 1) return "copper"
  if (texts === 1) return "text"
  if (pours === 1) return "pour"
  return labels === 1 ? "label" : "drawing"
}

/** The kinds of object a selection counts, and how Properties names them. */
export type ObjectKind = "parts" | "wires" | "labels" | "drawings" | "copper" | "texts" | "pours"

export const KIND_LABELS: Record<ObjectKind, string> = {
  parts: "Parts",
  wires: "Wires",
  labels: "Net labels and flags",
  drawings: "Drawings",
  copper: "Tracks and vias",
  texts: "Names and values",
  pours: "Copper pours and holes",
}

const KIND_ROW = /^kind:(parts|wires|labels|drawings|copper|texts|pours):(\d+)$/

/** A "kind:<parts|wires|labels|drawings|copper|texts>:<count>" row read back; undefined for any other row. */
export function kindRow(id: string): { kind: ObjectKind; count: number } | undefined {
  const match = KIND_ROW.exec(id)
  return match ? { kind: match[1] as ObjectKind, count: Number(match[2]) } : undefined
}

/**
 * The board's sections with nothing selected, a part's own with one, and the Selection section listing several; with
 * wires, labels or drawings among them (`wires`, `labels`, `drawings`, how many), the section first counts each kind
 * present. The header counts every object.
 */
export function propertiesView(parts: readonly SelectedPart[], opts: SectionOptions, wires = 0, labels = 0, drawings = 0, copper = 0, texts = 0, pours = 0): PropertiesView {
  const header = `Selected objects: ${parts.length + wires + labels + drawings + copper + texts + pours}`
  const [first] = parts
  const listed = parts.map((part) => `part:${part.name}`)
  const present: [ObjectKind, number][] = [["parts", parts.length], ["wires", wires], ["labels", labels], ["drawings", drawings], ["copper", copper], ["texts", texts], ["pours", pours]]
  const counts = present.flatMap(([kind, count]) => (count > 0 ? [`kind:${kind}:${count}`] : []))
  if (wires + labels + drawings + copper + texts + pours > 0) return { header, sections: [{ title: "Selection", rows: [...counts, ...listed] }] }
  if (!first) return { header, sections: boardSections() }
  if (parts.length === 1) return { header, sections: inspectorSections(first, opts) }
  return { header, sections: [{ title: "Selection", rows: listed }] }
}

/** What applies to every part of a selection of several; each runs the menu command, so it is one change in the history. */
export const GROUP_ACTIONS = [
  { label: "Rotate", command: "rotate" },
  { label: "Lock", command: "lock" },
  { label: "Unlock", command: "unlock" },
  { label: "Delete", command: "delete" },
] as const satisfies readonly { label: string; command: CommandId }[]

export type GroupCommand = (typeof GROUP_ACTIONS)[number]["command"]

/**
 * Whether a group action has something to change: Lock an unlocked part (or a locked one changed outside the editor),
 * Unlock a locked one, Rotate an editable part that is not locked, Delete such a part or any of the `others` selected,
 * wires, labels and drawings (Delete names those it cannot remove). Rotate, Lock and Unlock act on the parts only.
 */
export function groupActionEnabled(
  command: GroupCommand,
  parts: readonly { name: string; editable: boolean }[],
  locks: { locked: ReadonlySet<string>; violated: ReadonlySet<string> },
  others = 0,
): boolean {
  const names = parts.map((part) => part.name)
  if (command === "lock" || command === "unlock") return "parts" in lockChange(names, locks.locked, command === "lock", locks.violated)
  if (command === "delete" && others > 0) return true
  return parts.some((part) => part.editable && !locks.locked.has(part.name))
}

/** The one-part Lock button: the menu command it runs, its text, whether it shows pressed, and its tooltip. */
export interface PartLockButton {
  command: "lock" | "unlock"
  label: string
  pressed: boolean
  title: string
}

/**
 * Lock for an unlocked part, Unlock for a locked one, and, for a locked part changed outside the editor, Lock again,
 * which takes the change as the lock (the banner's remedy). Each runs the menu's command, as the group's buttons do.
 */
export function partLockButton(name: string, locks: { locked: ReadonlySet<string>; violated: ReadonlySet<string> }): PartLockButton {
  if (!locks.locked.has(name)) return { command: "lock", label: "Lock", pressed: false, title: "Lock this part, so the agent cannot move or change it" }
  if (locks.violated.has(name)) return { command: "lock", label: "Lock again", pressed: true, title: "Changed outside the editor: lock it again to accept the change" }
  return { command: "unlock", label: "Locked", pressed: true, title: "Unlock this part" }
}
