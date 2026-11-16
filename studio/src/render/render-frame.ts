// What a render shows and at what size: the box of the whole board or sheet, or of some parts, grown by a margin, and
// the picture's height from its width and that box's shape. No canvas here, so it is tested without one.
import type { Design } from "../../../src/engine/design.js"
import { drawingExtents } from "../pcb/drawing-extents.js"
import { fitCamera, pointBounds, unionBoxes, type Box, type Camera, type Size } from "../pcb/geometry.js"
import { sheetBoxes } from "../pcb/schematic-draw.js"
import { designOnPage, pageNames } from "../shell/schematic-pages.js"

export const MIN_WIDTH = 320
export const MAX_WIDTH = 2000
export const DEFAULT_WIDTH = 1024
/** The margin round the whole board or sheet, as a share of its longer side. */
const WHOLE_MARGIN = 0.04
/** The margin round zoomed parts: a share of the box's longer side, at least MIN_PART_MARGIN drawing units. */
const PART_MARGIN = 0.25
const MIN_PART_MARGIN = 1.5
/** A very long or very tall drawing still gives a picture of a sensible shape. */
const MAX_ASPECT = 4

export interface Frame {
  box: Box
  what: string
  /** The schematic page drawn; none for the PCB. */
  page?: string
  /** The design as drawn: one page of the schematic, or the whole design. */
  design: Design
}

const round1 = (value: number) => Math.round(value * 10) / 10

function grown(box: Box, share: number, least: number): Box {
  const pad = Math.max(Math.max(box.maxX - box.minX, box.maxY - box.minY) * share, least)
  return { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad }
}

/** The boxes of the named parts, or an error naming those that are not there. */
function partBoxes(names: readonly string[], boxes: ReadonlyMap<string, Box>, where: string): Box {
  const missing = names.filter((name) => !boxes.has(name))
  if (missing.length > 0) throw new Error(`${missing.length === 1 ? "No part" : "No parts"} named ${missing.join(", ")} ${where}`)
  const box = unionBoxes(names.map((name) => boxes.get(name) as Box))
  if (!box) throw new Error("No parts were named to zoom to")
  return box
}

function pcbFrame(design: Design, parts: readonly string[] | undefined): Frame {
  const pcb = design.pcb
  if (parts && parts.length > 0) {
    const boxes = new Map(pcb.parts.flatMap((part) => {
      const box = pointBounds(part.courtyard)
      return box ? [[part.component, box] as const] : []
    }))
    return { box: grown(partBoxes(parts, boxes, "on the board"), PART_MARGIN, MIN_PART_MARGIN), what: `PCB, around ${parts.join(", ")}`, design }
  }
  const outline = pointBounds(pcb.board?.outline ?? [])
  const courtyards = pcb.parts.flatMap((part) => pointBounds(part.courtyard) ?? [])
  const board = outline ?? unionBoxes(courtyards)
  if (!board) throw new Error("The board is empty: it has no outline and no parts to draw")
  const size = `${round1(board.maxX - board.minX)} x ${round1(board.maxY - board.minY)} mm`
  if (!outline) return { box: grown(board, WHOLE_MARGIN, 0), what: `PCB, all parts ${size}`, design }
  // A part that lies off the board is a fault the picture must show, so the box grows to hold it.
  const outside = courtyards.filter((yard) => yard.minX < outline.minX || yard.maxX > outline.maxX || yard.minY < outline.minY || yard.maxY > outline.maxY)
  const box = unionBoxes([outline, ...outside]) ?? outline
  const also = outside.length === 0 ? "" : `, and ${outside.length} ${outside.length === 1 ? "part" : "parts"} outside it`
  return { box: grown(box, WHOLE_MARGIN, 0), what: `PCB, whole board ${size}${also}`, design }
}

function schematicFrame(design: Design, page: string | undefined, parts: readonly string[] | undefined): Frame {
  const pages = pageNames(design)
  const shown = page ?? pages[0] ?? "Main"
  if (!pages.includes(shown)) throw new Error(`No schematic page "${shown}"; the pages are ${pages.map((name) => `"${name}"`).join(", ")}`)
  const onPage = designOnPage(design, shown)
  const layout = onPage.schematic
  const title = `Schematic page "${shown}"`
  if (parts && parts.length > 0) {
    const boxes = new Map(sheetBoxes(layout).map((part) => [part.name, part.box] as const))
    return { box: grown(partBoxes(parts, boxes, `on page "${shown}"`), PART_MARGIN, MIN_PART_MARGIN), what: `${title}, around ${parts.join(", ")}`, page: shown, design: onPage }
  }
  const box = drawingExtents(layout)
  if (!box) throw new Error(`${title} is empty`)
  return { box: grown(box, WHOLE_MARGIN, 0), what: title, page: shown, design: onPage }
}

/** The box to draw and the line that says what it is; a page for the PCB, a missing page or a missing part is refused. */
export function frameFor(design: Design, request: { view: "pcb" | "schematic"; page?: string; parts?: string[] }): Frame {
  if (request.view === "pcb") {
    if (request.page !== undefined) throw new Error("page is for the schematic only; the PCB has no pages")
    return pcbFrame(design, request.parts)
  }
  return schematicFrame(design, request.page, request.parts)
}

/** The width asked for, or why it is refused. */
export function widthOf(width: number | undefined): number {
  const chosen = width ?? DEFAULT_WIDTH
  if (!Number.isInteger(chosen) || chosen < MIN_WIDTH || chosen > MAX_WIDTH) throw new Error(`width must be a whole number of pixels from ${MIN_WIDTH} to ${MAX_WIDTH}`)
  return chosen
}

/** The picture's size: the width given, the height following the box's shape. */
export function imageSize(box: Box, width: number): Size {
  const across = Math.max(box.maxX - box.minX, 1e-6)
  const down = Math.max(box.maxY - box.minY, 1e-6)
  const aspect = Math.min(Math.max(down / across, 1 / MAX_ASPECT), MAX_ASPECT)
  return { width, height: Math.max(1, Math.round(width * aspect)) }
}

/** The camera that fits the box into the picture, the margin already in the box. */
export function cameraFor(box: Box, size: Size): Camera {
  return fitCamera(box, size, 0)
}
