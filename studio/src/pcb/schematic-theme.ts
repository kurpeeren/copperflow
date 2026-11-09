// The schematic's colours: EasyEDA Pro's default light theme, as listed in docs/studio-easyeda-parity.md section 6.
// Every schematic drawing routine takes its colours from here; the keys under "not in the table" are ours.
export const schematicTheme = {
  background: "#FFFCF8",
  grid: "#F0F0EB",
  wire: "#008800",
  bus: "#008800",
  /** Lines, shapes and texts drawn on the sheet (Place → Polyline, Rectangle, …) unless they give their own colour. */
  drawing: "#000080",
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
  /** The grid's dots, darker than its lines: lone dots in the line colour (about 1.1:1) look like no grid. */
  gridDot: "#D9D9D2",
  /** Outline of the part, label or wire under the pointer. */
  hover: "rgb(255 0 0 / 45%)",
  /** Fill of the square handles on a selected wire's corners; they are outlined in the selection colour. */
  handleFill: "#FFFFFF",
  /** Fill of the note box drawn with Place → Note box. */
  selectionFill: "rgb(255 0 0 / 8%)",
  /** The selection box dragged on the sheet: blue, as EasyEDA draws it, and its wash. */
  selectionBox: "#0000FF",
  selectionBoxFill: "rgb(0 0 255 / 8%)",
  /** The lock badge's ground and its padlock. */
  lockBadge: "#4f9a6c",
  lockGlyph: "#ffffff",
  /** A note for the agent: its pin and leader, the panel behind its text, and the text. */
  notePin: "#e0a46a",
  notePanel: "rgb(34 38 44 / 92%)",
  noteText: "#e9e6df",
} as const

export type SchematicTheme = typeof schematicTheme
