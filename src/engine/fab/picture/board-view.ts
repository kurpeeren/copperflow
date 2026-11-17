// render's view "board": what part of the board to draw, at what size, and the words that say what the picture shows.
// Parts zoom as they do for the PCB view: their courtyards and a margin.
import type { Design } from "../../design.js"
import { designName } from "../names.js"
import { boardPicture, MAX_PICTURE_SIDE, outlineBox, type Side } from "./board-picture.js"
import { lookWords, type LookRequest } from "./looks.js"
import { encodePng, loadCanvas, type CanvasLoader } from "./png.js"
import type { Box } from "./raster.js"

export interface BoardViewRequest {
  side?: Side
  look?: LookRequest
  parts?: string[]
  page?: string
  width?: number
}

export const MIN_BOARD_WIDTH = 320
/** A width when none is asked for: 1024 px, more when the board is small, so it is drawn at least this fine. */
const DEFAULT_WIDTH = 1024
const LEAST_PX_PER_MM = 40
/** The margin round zoomed parts: a share of the box's longer side, at least PART_MARGIN_MM. */
const PART_MARGIN = 0.25
const PART_MARGIN_MM = 1.5

const round1 = (value: number) => Math.round(value * 10) / 10

function partsBox(design: Design, names: readonly string[]): Box {
  const boxes = new Map(
    design.pcb.parts.flatMap((part) => {
      if (part.courtyard.length === 0) return []
      const xs = part.courtyard.map((p) => p.x)
      const ys = part.courtyard.map((p) => p.y)
      return [[part.component, { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }] as const]
    }),
  )
  const missing = names.filter((name) => !boxes.has(name))
  if (missing.length > 0) throw new Error(`${missing.length === 1 ? "No part" : "No parts"} named ${missing.join(", ")} on the board`)
  const chosen = names.map((name) => boxes.get(name) as Box)
  const box = { minX: Math.min(...chosen.map((b) => b.minX)), minY: Math.min(...chosen.map((b) => b.minY)), maxX: Math.max(...chosen.map((b) => b.maxX)), maxY: Math.max(...chosen.map((b) => b.maxY)) }
  const pad = Math.max(Math.max(box.maxX - box.minX, box.maxY - box.minY) * PART_MARGIN, PART_MARGIN_MM)
  return { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad }
}

function widthFor(request: BoardViewRequest, across: number): number {
  const width = request.width ?? Math.min(Math.max(DEFAULT_WIDTH, Math.ceil(across * LEAST_PX_PER_MM)), MAX_PICTURE_SIDE)
  if (!Number.isInteger(width) || width < MIN_BOARD_WIDTH || width > MAX_PICTURE_SIDE) throw new Error(`width must be a whole number of pixels from ${MIN_BOARD_WIDTH} to ${MAX_PICTURE_SIDE}`)
  return width
}

const sideWords = (side: Side) => (side === "top" ? "top" : "bottom seen from below (left and right swapped)")

/** The picture as a PNG and what it shows: "the board as made, top, green mask, ENIG, 43.4 x 24.2 mm". */
export async function renderBoardView(design: Design, request: BoardViewRequest, canvas: CanvasLoader = loadCanvas): Promise<{ png: Uint8Array; width: number; height: number; what: string; label: string }> {
  if (request.page !== undefined) throw new Error("page is for the schematic only; the board has no pages")
  const side = request.side ?? "top"
  const outline = outlineBox(design.pcb)
  const zoomed = request.parts !== undefined && request.parts.length > 0
  const box = zoomed ? partsBox(design, request.parts as string[]) : outline
  const width = widthFor(request, box.maxX - box.minX)
  const picture = boardPicture(design, { side, ...(request.look ? { look: request.look } : {}), pxPerMm: width / (box.maxX - box.minX), box })
  const where = zoomed ? `around ${(request.parts as string[]).join(", ")}` : `${round1(outline.maxX - outline.minX)} x ${round1(outline.maxY - outline.minY)} mm`
  const what = `the board as made, ${sideWords(side)}, ${lookWords(picture.look)}, ${where}`
  return { png: await encodePng(picture, canvas), width: picture.width, height: picture.height, what, label: designName(design.file) }
}
