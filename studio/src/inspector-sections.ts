import type { PropInfo } from "../../src/core/types.js"
import { lockChange } from "./pcb/group-edits.js"
import type { CommandId } from "./shell/menus.js"

/** What the sections need to know about a part. */
export interface InspectorPart {
  tag: string
  props: Record<string, PropInfo>
}

/**
 * A row names what the component draws in it: "name", "kind", "lock", "connections", "library", "notes",
 * "prop:<key>" for a prop the part has, "suggest:<key>" for a usual prop it does not have yet, and
 * "part:<name>" for one part of a selection of several.
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
}

/** Props that say where a part is, in the order the Position section shows them. */
export const POSITION_PROPS = ["pcbX", "pcbY", "pcbRotation", "schX", "schY", "schRotation", "side", "layer"]

/** The prop the Footprint section holds; footprint parameters join it in later rounds. */
const FOOTPRINT = "footprint"

/** The Footprint section's row: the part's footprint, or the usual one offered when it has none; empty when neither. */
function footprintRows(part: InspectorPart, suggested: readonly string[]): string[] {
  if (FOOTPRINT in part.props) return [`prop:${FOOTPRINT}`]
  return suggested.includes(FOOTPRINT) ? [`suggest:${FOOTPRINT}`] : []
}

/** The sections of a selected part and the rows each holds. */
export function inspectorSections(part: InspectorPart, opts: { library: boolean }): InspectorSection[] {
  const valueKeys = Object.keys(part.props).filter((key) => !POSITION_PROPS.includes(key) && key !== FOOTPRINT)
  const suggested = (SUGGESTED_PROPS[part.tag] ?? []).map(([key]) => key).filter((key) => !(key in part.props))
  const missing = suggested.filter((key) => key !== FOOTPRINT)
  const placed = POSITION_PROPS.filter((key) => key in part.props)
  const footprint = footprintRows(part, suggested)
  return [
    { title: "Basic", rows: ["name", "kind", ...valueKeys.map((k) => `prop:${k}`), ...missing.map((k) => `suggest:${k}`)] },
    ...(footprint.length > 0 ? [{ title: "Footprint", rows: footprint }] : []),
    { title: "Position", rows: [...placed.map((k) => `prop:${k}`), "lock"] },
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

/** The board's sections with nothing selected, a part's own with one, and the Selection section listing several. */
export function propertiesView(parts: readonly SelectedPart[], opts: { library: boolean }): PropertiesView {
  const header = `Selected objects: ${parts.length}`
  const [first] = parts
  if (!first) return { header, sections: boardSections() }
  if (parts.length === 1) return { header, sections: inspectorSections(first, opts) }
  return { header, sections: [{ title: "Selection", rows: parts.map((part) => `part:${part.name}`) }] }
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
 * Whether a group action has a part to change: Lock an unlocked part (or a locked one changed outside the editor),
 * Unlock a locked one, Rotate and Delete an editable part that is not locked.
 */
export function groupActionEnabled(
  command: GroupCommand,
  parts: readonly { name: string; editable: boolean }[],
  locks: { locked: ReadonlySet<string>; violated: ReadonlySet<string> },
): boolean {
  const names = parts.map((part) => part.name)
  if (command === "lock" || command === "unlock") return "parts" in lockChange(names, locks.locked, command === "lock", locks.violated)
  return parts.some((part) => part.editable && !locks.locked.has(part.name))
}
