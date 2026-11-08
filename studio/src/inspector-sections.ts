import type { PropInfo } from "../../src/core/types.js"

/** What the sections need to know about a part. */
export interface InspectorPart {
  tag: string
  props: Record<string, PropInfo>
}

/**
 * A row names what the component draws in it: "name", "kind", "lock", "connections", "library", "notes",
 * "prop:<key>" for a prop the part has, "suggest:<key>" for a usual prop it does not have yet.
 */
export interface InspectorSection {
  title: string
  rows: string[]
}

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

/** The sections of a selected part and the rows each holds. */
export function inspectorSections(part: InspectorPart, opts: { library: boolean }): InspectorSection[] {
  const valueKeys = Object.keys(part.props).filter((key) => !POSITION_PROPS.includes(key))
  const missing = (SUGGESTED_PROPS[part.tag] ?? []).map(([key]) => key).filter((key) => !(key in part.props))
  const placed = POSITION_PROPS.filter((key) => key in part.props)
  return [
    { title: "Basic", rows: ["name", "kind", ...valueKeys.map((k) => `prop:${k}`), ...missing.map((k) => `suggest:${k}`)] },
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
