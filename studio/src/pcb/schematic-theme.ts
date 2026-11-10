// The schematic's colours: EasyEDA Pro's default light theme, as listed in docs/studio-easyeda-parity.md section 6,
// and our own dark one (View → Theme → Dark). Every schematic drawing routine takes its colours from the palette the
// sheet is drawn with (sheetPalette); the light keys under "not in the table" are ours.
import type { ThemeName } from "../shell/theme-state.js"
import { PALETTE, type Ctx } from "./ctx.js"

/** Every colour the schematic draws in, and how much its selection glows. */
export interface SchematicPalette {
  background: string
  grid: string
  wire: string
  bus: string
  /** Lines, shapes and texts drawn on the sheet (Place → Polyline, Rectangle, …) unless they give their own colour. */
  drawing: string
  junction: string
  /** Symbol outlines; symbols have no fill. */
  symbolOutline: string
  pin: string
  pinName: string
  pinNumber: string
  designator: string
  netName: string
  /** Values and other properties. */
  value: string
  noConnect: string
  selection: string
  highlight: string
  border: string
  titleText: string
  /** The grid's dots. */
  gridDot: string
  /** Every fifth line or dot, a step brighter; none on the light sheet. */
  gridFifth?: string
  /** The ground and power flags. */
  flag: string
  /** Violation rings: errors and warnings. */
  markerError: string
  markerWarning: string
  /** The blur round selected wires, labels, drawings and outlines, in device pixels; 0 for none. */
  selectionGlow: number
  hover: string
  handleFill: string
  selectionFill: string
  selectionBox: string
  selectionBoxFill: string
  lockBadge: string
  lockGlyph: string
  notePin: string
  notePanel: string
  noteText: string
}

export const schematicTheme: SchematicPalette = {
  background: "#FFFCF8",
  grid: "#F0F0EB",
  wire: "#008800",
  bus: "#008800",
  /** Lines, shapes and texts drawn on the sheet (Place → Polyline, Rectangle, …) unless they give their own colour. */
  drawing: "#000080",
  junction: "#CC0000",
  /** Symbol outlines; symbols have no fill. */
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
  /** The flags are drawn in the symbol colour, the violation rings in the PCB's, and nothing glows. */
  flag: "#A00000",
  markerError: PALETTE.error,
  markerWarning: PALETTE.warning,
  selectionGlow: 0,
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
}

/**
 * The dark sheet: charcoal, a quiet dot grid, bright wires and a cyan selection that glows softly. Designators,
 * values and labels are at least 4.5:1 on it (a test holds them); the frame and title block are muted.
 */
export const darkSchematicTheme: SchematicPalette = {
  background: "#141619",
  grid: "#2B3038",
  gridDot: "#2B3038",
  gridFifth: "#3A4049",
  wire: "#5BD3C7",
  bus: "#8AB4FF",
  drawing: "#9AA1A9",
  junction: "#5BD3C7",
  symbolOutline: "#D9DEE5",
  pin: "#D9DEE5",
  pinName: "#AEB6C0",
  pinNumber: "#7E8792",
  designator: "#E6E8EB",
  netName: "#F2C66D",
  value: "#AEB6C0",
  noConnect: "#5BD3C7",
  selection: "#4CC9F0",
  /** A highlighted net, in the copper accent. */
  highlight: "#E89A4F",
  border: "#9AA1A9",
  titleText: "#9AA1A9",
  flag: "#FF9E80",
  markerError: "#FF6B6B",
  markerWarning: "#FFC857",
  selectionGlow: 8,
  hover: "#8BE0F5",
  handleFill: "#141619",
  selectionFill: "rgb(76 201 240 / 10%)",
  selectionBox: "#4CC9F0",
  selectionBoxFill: "rgb(76 201 240 / 8%)",
  lockBadge: "#4f9a6c",
  lockGlyph: "#ffffff",
  notePin: "#e0a46a",
  notePanel: "rgb(34 38 44 / 92%)",
  noteText: "#e9e6df",
}

export const schematicThemeFor = (theme: ThemeName): SchematicPalette => (theme === "dark" ? darkSchematicTheme : schematicTheme)

let current: SchematicPalette = schematicTheme

/** The palette the sheet is drawn with: the one set last, light until the canvas sets one. */
export const sheetPalette = (): SchematicPalette => current

/** The schematic canvas sets its theme's palette here before it paints, so every drawing routine draws in it. */
export function setSheetPalette(palette: SchematicPalette): void {
  current = palette
}

/** Turns the selection glow on or off for what is stroked next: the palette's blur, in its selection colour. */
export function glow(ctx: Ctx, on: boolean, palette: SchematicPalette = current): void {
  const blur = on ? palette.selectionGlow : 0
  ctx.shadowBlur = blur
  ctx.shadowColor = blur > 0 ? palette.selection : "transparent"
}
