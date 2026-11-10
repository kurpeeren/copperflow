// A part's name and value on the schematic and its designator on the silkscreen, as things a click picks, a drag or
// an arrow key moves and Properties puts back: where each is (engine part-labels.ts on the sheet; the courtyard's top
// on the board), the one under a point, the set_props edit a move writes (an offset from the part's origin, which a
// moved part keeps), the reset that removes it, and the layout drawn with moves that wait for their build.
// Plain TypeScript with .js imports, so the tests can run it.
import type { Edit } from "../../../src/core/types.js"
import type { Selection } from "../selection.js"
import { nudgeDirection, type KeyResult } from "./canvas-keys.js"
import { nudgeOffset } from "./group-edits.js"
import { partLabelId, partLabels, parsePartLabelId, textBox } from "../../../src/engine/part-labels.js"
import type { PcbLayout, PlacedFootprint } from "../../../src/engine/pcb.js"
import { rotatePoint } from "../../../src/engine/schematic-geometry.js"
import type { PlacedSymbol, SchematicLayout } from "../../../src/engine/schematic.js"
import { roundPosition, type Box, type Point } from "./geometry.js"
import type { SourceCircuit, View } from "./positions.js"

/** The silkscreen designator's height, in mm. */
export const DESIGNATOR_MM = 0.8

/** The props that move a part's texts, by view: its name and value on the schematic, its designator on the board. */
export const TEXT_PROPS: Readonly<Record<View, readonly string[]>> = { schematic: ["schNameAt", "schValueAt"], pcb: ["pcbNameAt"] }

/** What each prop moves, as Properties names it. */
export const TEXT_NAMES: Readonly<Record<string, string>> = { schNameAt: "Name", schValueAt: "Value", pcbNameAt: "Designator" }

export interface PartText {
  /** "<part>:<prop>", e.g. "R1:schNameAt". */
  id: string
  part: string
  prop: string
  text: string
  /** The middle of the text, on the sheet or the board. */
  at: Point
  /** `at` less the part's origin: what the prop holds. */
  offset: Point
  box: Box
}

/** The view a text id belongs to, from its prop; undefined for an id that is not a text's. */
export function textView(id: string): View | undefined {
  const prop = parsePartLabelId(id)?.prop
  if (prop === undefined) return undefined
  return TEXT_PROPS.schematic.includes(prop) ? "schematic" : TEXT_PROPS.pcb.includes(prop) ? "pcb" : undefined
}

/** Every symbol's name and value, where the sheet draws them. */
export function sheetTexts(layout: SchematicLayout): PartText[] {
  return layout.symbols.flatMap((placed) => partLabels(placed))
}

function courtyardTop(part: PlacedFootprint): Point {
  const xs = part.courtyard.map((c) => c.x)
  const ys = part.courtyard.map((c) => c.y)
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(...ys) }
}

/** A part's silkscreen designator: where pcbNameAt puts it, else centred just above the courtyard's top edge. */
export function designatorText(part: PlacedFootprint): PartText {
  const top = courtyardTop(part)
  const at = part.nameAt ?? { x: top.x, y: top.y + DESIGNATOR_MM / 2 }
  const offset = { x: at.x - part.x, y: at.y - part.y }
  return { id: partLabelId(part.component, "pcbNameAt"), part: part.component, prop: "pcbNameAt", text: part.component, at, offset, box: textBox(at, DESIGNATOR_MM, part.component.length) }
}

/** Every part's silkscreen designator. */
export function boardTexts(layout: PcbLayout): PartText[] {
  return layout.parts.map(designatorText)
}

/** The texts of a view's layout. */
export function viewTexts(view: View, layout: { schematic: SchematicLayout; pcb: PcbLayout }): PartText[] {
  return view === "pcb" ? boardTexts(layout.pcb) : sheetTexts(layout.schematic)
}

const contains = (box: Box, p: Point) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY
const area = (box: Box) => (box.maxX - box.minX) * (box.maxY - box.minY)

/** The text under a point, the smallest when several overlap. */
export function textUnder(texts: readonly PartText[], p: Point): PartText | undefined {
  return texts.filter((text) => contains(text.box, p)).sort((a, b) => area(a.box) - area(b.box))[0]
}

/** The text moved so its middle is at `at`: the same offset change, the box moved with it. */
export function textMovedTo(text: PartText, at: Point): PartText {
  const dx = at.x - text.at.x
  const dy = at.y - text.at.y
  const { box } = text
  return { ...text, at, offset: { x: text.offset.x + dx, y: text.offset.y + dy }, box: { minX: box.minX + dx, maxX: box.maxX + dx, minY: box.minY + dy, maxY: box.maxY + dy } }
}

/** The texts with the moves (dragged, or sent and waiting for their build) in place. */
export function textsWithMoves(texts: readonly PartText[], moves: readonly TextMove[]): PartText[] {
  if (moves.length === 0) return [...texts]
  return texts.map((text) => {
    const move = moves.find((m) => m.id === text.id)
    return move ? textMovedTo(text, move.at) : text
  })
}

/** The set_props edit that puts the text's middle at `at`: its offset from the part's origin, rounded; none when it would not move. */
export function textMoveEdits(text: PartText, at: Point): Edit[] {
  const origin = { x: text.at.x - text.offset.x, y: text.at.y - text.offset.y }
  const offset = { x: roundPosition(at.x - origin.x), y: roundPosition(at.y - origin.y) }
  if (roundPosition(text.offset.x) === offset.x && roundPosition(text.offset.y) === offset.y) return []
  return [{ kind: "setProps", part: text.part, props: { [text.prop]: offset } }]
}

/** The edit that removes the prop, so the layout puts the text where it always has. */
export function textResetEdits(id: string): Edit[] {
  const parsed = parsePartLabelId(id)
  return parsed ? [{ kind: "setProps", part: parsed.part, props: { [parsed.prop]: null } }] : []
}

/** Whether the source moves this text (its prop is written), so Reset position has something to remove. */
export function textMoved(circuit: SourceCircuit, id: string): boolean {
  const parsed = parsePartLabelId(id)
  return parsed !== undefined && circuit.model.parts.find((p) => p.name === parsed.part)?.props[parsed.prop] !== undefined
}

/** Why the text cannot be moved or put back: its part is locked, read-only or not in the source, or its prop is an expression; else null. */
export function textBlocker(circuit: SourceCircuit, locked: ReadonlySet<string>, id: string): string | null {
  const parsed = parsePartLabelId(id)
  const part = parsed && circuit.model.parts.find((p) => p.name === parsed.part)
  if (!parsed || !part) return "This part has no editable source element"
  if (locked.has(part.name)) return `${part.name} is locked`
  if (!part.editable) return `${part.name} is read-only (${part.readonlyReason})`
  const prop = part.props[parsed.prop]
  return prop && !prop.editable ? `${part.name}.${parsed.prop} is an expression; change it in the code` : null
}

/** Why Reset position cannot run on a text, or null when it can: it is gone, cannot be edited, or nothing moved it. */
export function textResetReason(layout: { schematic: SchematicLayout; pcb: PcbLayout }, circuit: SourceCircuit, id: string, locked: ReadonlySet<string>): string | null {
  const shown = textProperties(layout, circuit, id, locked)
  if (!shown) return "It is not on this sheet"
  return shown.blocker ?? (shown.moved ? null : "It is where the layout puts it")
}

/** A text drawn away from where the layout has it: being dragged, or moved and waiting for its build. */
export interface TextMove {
  id: string
  at: Point
}

/** The symbol with its name or value drawn with its middle at `at` on the sheet. */
function symbolWithText(placed: PlacedSymbol, prop: string, at: Point): PlacedSymbol {
  const role = prop === "schNameAt" ? "reference" : prop === "schValueAt" ? "value" : undefined
  const local = rotatePoint({ x: at.x - placed.x, y: at.y - placed.y }, -placed.rotation)
  const shapes = placed.symbol.shapes.map((shape) => (shape.type === "text" && shape.role === role ? { ...shape, at: local, anchor: "center" as const } : shape))
  return { ...placed, symbol: { ...placed.symbol, shapes } }
}

/** The sheet with the moved names and values drawn where they go; the same layout when nothing moves. */
export function sheetWithTextMoves(layout: SchematicLayout, moves: readonly TextMove[]): SchematicLayout {
  if (moves.length === 0) return layout
  const symbols = layout.symbols.map((placed) =>
    moves.reduce((symbol, move) => {
      const parsed = parsePartLabelId(move.id)
      return parsed?.part === placed.component ? symbolWithText(symbol, parsed.prop, move.at) : symbol
    }, placed),
  )
  return { ...layout, symbols }
}

/** The board with the moved designators drawn where they go; the same layout when nothing moves. */
export function boardWithTextMoves(layout: PcbLayout, moves: readonly TextMove[]): PcbLayout {
  if (moves.length === 0) return layout
  const parts = layout.parts.map((part) => {
    const move = moves.find((m) => m.id === partLabelId(part.component, "pcbNameAt"))
    return move ? { ...part, nameAt: move.at } : part
  })
  return { ...layout, parts }
}

/** What Properties shows for a name, value or designator selected alone; undefined when its part is gone. */
export interface TextProperties {
  /** The section's title: "Name", "Value" or "Designator". */
  title: string
  rows: { label: string; value: string }[]
  /** Whether the source moves it, so Reset position has something to remove. */
  moved: boolean
  /** Why it cannot be moved or put back, or null. */
  blocker: string | null
}

const shownNumber = (value: number): string => String(roundPosition(value))

export function textProperties(layout: { schematic: SchematicLayout; pcb: PcbLayout }, circuit: SourceCircuit, id: string, locked: ReadonlySet<string>): TextProperties | undefined {
  const view = textView(id)
  const text = view && viewTexts(view, layout).find((t) => t.id === id)
  if (!view || !text) return undefined
  const moved = textMoved(circuit, id)
  const unit = view === "pcb" ? " mm" : ""
  const rows = [
    { label: "Part", value: text.part },
    { label: "Text", value: text.text },
    { label: "Offset X", value: `${shownNumber(text.offset.x)}${unit}` },
    { label: "Offset Y", value: `${shownNumber(text.offset.y)}${unit}` },
    { label: "Position", value: moved ? `Moved (${text.prop})` : "Where the layout puts it" },
  ]
  return { title: TEXT_NAMES[text.prop] ?? text.prop, rows, moved, blocker: textBlocker(circuit, locked, id) }
}

/** What an arrow key does to a name or value selected alone: moves it by whole grid steps (as it moves a part); undefined otherwise. */
export function textNudge(selection: Selection, hit: KeyResult, layout: { step: number; snap?: boolean }): { id: string; by: Point } | undefined {
  const id = selection.soleText
  const direction = nudgeDirection(hit.action)
  if (id === undefined || !direction) return undefined
  return { id, by: nudgeOffset(direction, layout.step, hit.steps ?? 1, layout.snap !== false) }
}
