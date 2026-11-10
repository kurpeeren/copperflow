// A part's name and value on the schematic as things of their own: where each is drawn on the sheet, its offset from
// the symbol's origin (what schNameAt and schValueAt write) and the box its text takes, so the Studio can pick and drag
// them. Only the symbol library's types and the sheet geometry are used, so the Studio bundle can hold it.
import type { Point } from "./model.js"
import type { PlacedSymbol } from "./schematic.js"
import { sheetPoint, tidy } from "./schematic-geometry.js"
import type { Bounds } from "./symbols/index.js"
import { CHAR_WIDTH } from "./symbols/types.js"

/** The prop that moves a part's schematic name or value. */
export type SchLabelProp = "schNameAt" | "schValueAt"

/** The prop that moves each text role a symbol draws for its part. */
const PROP_OF: Readonly<Record<"reference" | "value", SchLabelProp>> = { reference: "schNameAt", value: "schValueAt" }

export interface PartLabel {
  /** "<part>:<prop>", e.g. "R1:schNameAt". */
  id: string
  part: string
  prop: SchLabelProp
  text: string
  /** The middle of the text on the sheet. */
  at: Point
  /** `at` less the symbol's origin: what the prop holds once the label is moved. */
  offset: Point
  /** The upright text's box on the sheet. */
  box: Bounds
}

/** The id of a part's moved label: the part and the prop, "R1:schNameAt". */
export const partLabelId = (part: string, prop: string): string => `${part}:${prop}`

/** The part and the prop a label id names, or undefined for an id that is not one. */
export function parsePartLabelId(id: string): { part: string; prop: string } | undefined {
  const cut = id.lastIndexOf(":")
  return cut > 0 ? { part: id.slice(0, cut), prop: id.slice(cut + 1) } : undefined
}

/** The box of an upright text of `size` and `length` characters centred on `at`. */
export function textBox(at: Point, size: number, length: number): Bounds {
  const half = (CHAR_WIDTH * size * length) / 2
  return { minX: at.x - half, maxX: at.x + half, minY: at.y - size / 2, maxY: at.y + size / 2 }
}

/** The symbol's name and then its value (when it has one), where the layout draws them. */
export function partLabels(placed: PlacedSymbol): PartLabel[] {
  return placed.symbol.shapes.flatMap((shape): PartLabel[] => {
    if (shape.type !== "text" || (shape.role !== "reference" && shape.role !== "value")) return []
    const at = sheetPoint(shape.at, placed)
    const prop = PROP_OF[shape.role]
    const offset = { x: tidy(at.x - placed.x), y: tidy(at.y - placed.y) }
    return [{ id: partLabelId(placed.component, prop), part: placed.component, prop, text: shape.text, at, offset, box: textBox(at, shape.size, shape.text.length) }]
  })
}
