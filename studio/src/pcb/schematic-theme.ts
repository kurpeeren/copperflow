// The schematic's colours: EasyEDA Pro's default light theme, as listed in docs/studio-easyeda-parity.md section 6.
// Every schematic drawing routine takes its colours from here; the keys under "not in the table" are ours.
export const schematicTheme = {
  background: "#FFFCF8",
  grid: "#F0F0EB",
  wire: "#008800",
  bus: "#008800",
  junction: "#CC0000",
  /** Symbol outlines and the ground and power flags; symbols have no fill. */
  symbolOutline: "#A00000",
  pin: "#880000",
  pinName: "#000000",
  pinNumber: "#000000",
  designator: "#0000FF",
  netName: "#0000FF",
  /** Values and other properties. */
  value: "#000080",
  noConnect: "#33CC33",
  selection: "#FF0000",
  highlight: "#FF9933",
  border: "#A00000",
  titleText: "#000080",
  // Not in the table: they have to read on the light sheet.
  /** The dashed box round a symbol the engine placed for itself. */
  autoBox: "rgb(160 0 0 / 55%)",
  /** Outline of the part or label under the pointer. */
  hover: "rgb(255 0 0 / 45%)",
  /** Fill of the note box drawn with Shift-drag. */
  selectionFill: "rgb(255 0 0 / 8%)",
  /** The lock badge's ground and its padlock. */
  lockBadge: "#4f9a6c",
  lockGlyph: "#ffffff",
  /** A note for the agent: its pin and leader, the panel behind its text, and the text. */
  notePin: "#e0a46a",
  notePanel: "rgb(34 38 44 / 92%)",
  noteText: "#e9e6df",
} as const

export type SchematicTheme = typeof schematicTheme
