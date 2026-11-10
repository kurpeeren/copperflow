// Editing a sheet symbol on its parent page, as a chip's pins are edited: a port's pin dragged along the box's edge or
// to another side writes the port's `side` and `order` in the sheet file, and the box's lower right corner dragged
// writes `<sheet width height>`. Both are the sheet's, so every instance shows the change. Pure; the canvas calls it.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { Point, SheetInstance } from "../../../src/engine/model.js"
import type { PlacedSymbol } from "../../../src/engine/schematic.js"
import { rotatePoint, sheetPoint } from "../../../src/engine/schematic-geometry.js"
import { nearestPlace, PORT_PITCH, sheetSymbolLayout, type SheetSymbolLayout } from "../../../src/engine/sheet-symbol.js"
import { topInstance } from "./instances.js"

/** What a press on a selected sheet symbol takes hold of: a port's pin where it meets the box, or the box's corner. */
export type SymbolHandle =
  | { kind: "pin"; instance: string; file: string; port: string; at: Point }
  | { kind: "corner"; instance: string; file: string; at: Point }

/** A sheet symbol as placed on the page, with its box and pins. */
interface PlacedSheet {
  instance: SheetInstance
  placed: PlacedSymbol
  layout: SheetSymbolLayout
}

function placedSheet(design: Design, name: string): PlacedSheet | undefined {
  const instance = topInstance(design, name)
  const placed = design.schematic.symbols.find((symbol) => symbol.component === name)
  if (!instance || !placed) return undefined
  return { instance, placed, layout: sheetSymbolLayout(instance.ports, instance.size) }
}

/** A point in the symbol's own frame (origin at the box's top left, unturned) as it lies on the sheet. */
const onSheet = (sheet: PlacedSheet, local: Point): Point => sheetPoint(local, sheet.placed)
/** A point on the sheet in the symbol's own frame. */
const inSymbol = (sheet: PlacedSheet, world: Point): Point => rotatePoint({ x: world.x - sheet.placed.x, y: world.y - sheet.placed.y }, -sheet.placed.rotation)

/** The handles of the selected sheet symbols: each port pin's inner end, and each box's lower right corner. */
export function symbolHandles(design: Design, selected: readonly string[]): SymbolHandle[] {
  return selected.flatMap((name): SymbolHandle[] => {
    const sheet = placedSheet(design, name)
    if (!sheet) return []
    const { instance, layout } = sheet
    const pins = layout.pins.map((pin): SymbolHandle => ({ kind: "pin", instance: name, file: instance.file, port: pin.name, at: onSheet(sheet, pin.edge) }))
    return [...pins, { kind: "corner", instance: name, file: instance.file, at: onSheet(sheet, { x: layout.width, y: -layout.height }) }]
  })
}

/** The handle within `reach` of a point, the nearest first. */
export function handleAt(handles: readonly SymbolHandle[], world: Point, reach: number): SymbolHandle | undefined {
  let best: { handle: SymbolHandle; distance: number } | undefined
  for (const handle of handles) {
    const distance = Math.hypot(handle.at.x - world.x, handle.at.y - world.y)
    if (distance <= reach && (!best || distance < best.distance)) best = { handle, distance }
  }
  return best?.handle
}

/** The edits a drop makes, the file they go to and the history entry's words; or a message why nothing changes. */
export type SymbolEdit = { file: string; edits: Edit[]; summary: string } | { message: string }

/**
 * A port's pin dropped at a point: its side and slot become the nearest place on the box. A port already there takes
 * the dragged one's old place, so two pins never share one. One edit request, one history entry, in the sheet file.
 */
export function dropPin(design: Design, handle: Extract<SymbolHandle, { kind: "pin" }>, world: Point): SymbolEdit {
  const sheet = placedSheet(design, handle.instance)
  const port = sheet?.instance.ports.find((candidate) => candidate.name === handle.port)
  if (!sheet || !port) return { message: `${handle.instance} has no port ${handle.port} any more` }
  const place = nearestPlace(inSymbol(sheet, world), sheet.layout.width, sheet.layout.height)
  if (place.side === port.side && place.order === port.order) return { message: `${port.name} stays where it is` }
  const there = sheet.instance.ports.find((other) => other !== port && other.side === place.side && other.order === place.order)
  const edits: Edit[] = [{ kind: "setProps", part: port.name, props: { side: place.side, order: place.order } }]
  if (there) edits.push({ kind: "setProps", part: there.name, props: { side: port.side, order: port.order } })
  const swap = there ? `, ${there.name} to ${port.side} ${port.order}` : ""
  return { file: sheet.instance.file, edits, summary: `Move port ${port.name} of ${sheet.instance.sheet} to ${place.side} ${place.order}${swap}` }
}

/** Rounds up to the pin pitch, so pins stay on the grid. */
const toPitch = (value: number): number => Math.round(Math.ceil(value / PORT_PITCH - 1e-9) * PORT_PITCH * 1000) / 1000

/** The box's corner dropped at a point: the new size, never smaller than its ports need. */
export function dropCorner(design: Design, handle: Extract<SymbolHandle, { kind: "corner" }>, world: Point): SymbolEdit {
  const sheet = placedSheet(design, handle.instance)
  if (!sheet) return { message: `${handle.instance} is gone` }
  const local = inSymbol(sheet, world)
  const width = Math.max(sheet.layout.needed.width, toPitch(local.x))
  const height = Math.max(sheet.layout.needed.height, toPitch(-local.y))
  if (width === sheet.layout.width && height === sheet.layout.height) return { message: `${sheet.instance.sheet} keeps its size` }
  return { file: sheet.instance.file, edits: [{ kind: "setSheetSize", width, height }], summary: `Size the ${sheet.instance.sheet} symbol to ${width} × ${height}` }
}
