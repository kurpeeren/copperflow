// A PCB relay drawn from its library footprint: a dark plinth on the board, the case on it with its top edges
// chamfered, and its part number printed on the top along its length. A lead goes through each hole. Pure.
import { leads, type ShapeInput } from "./input.js"
import { box, clipped, frustum, grown, type Piece, type Rect } from "./kit.js"
import { LIFT, lidPrint } from "./sleeve-print.js"
import type { Rgb } from "../scene.js"

/** The plinth's height and how far the case stands inside it, the chamfer round the top, and the outline inset. */
const PLINTH = 0.6
const PLINTH_INSET = 0.15
const CHAMFER = 0.5
const INSET = 0.15
/** The printed text keeps this share of the top's length and width. */
const PRINT_SHARE = 0.8
const PLINTH_COLOR: Rgb = [30, 30, 33]
const INK: Rgb = [232, 234, 236]

/** The part number to print, when the part has one. */
const printed = (props: ShapeInput["props"]): string[] => {
  const mpn = props?.["manufacturerPartNumber"]
  return typeof mpn === "string" && mpn.trim() !== "" ? [mpn.trim()] : []
}

export function relayShape(input: ShapeInput): Piece[] {
  const outline: Rect = clipped(input.body ?? grown(input.limit, -INSET), input.limit)
  const { look } = input
  const lines = printed(input.props)
  // The print stands a hair proud of the top, so the top sits that much lower and the part keeps its height.
  const h = Math.max(input.height, PLINTH + CHAMFER * 2) - (lines.length > 0 ? LIFT : 0)
  const chamfer = Math.min(CHAMFER, (outline.maxX - outline.minX) / 4, (outline.maxY - outline.minY) / 4)
  const caseRect = grown(outline, -PLINTH_INSET)
  const shoulder = h - chamfer
  const top = grown(caseRect, -chamfer)
  const pieces: Piece[] = [
    ...box(outline, 0, PLINTH, PLINTH_COLOR, "matt", "body"),
    ...box(caseRect, PLINTH, shoulder, { top: look.top ?? look.body, side: look.body }, "matt", "body").filter((piece) => piece.normal[2] < 0.99),
    ...frustum(caseRect, top, shoulder, h, { top: look.top ?? look.body, side: look.body }, "matt", "body"),
  ]
  const along = top.maxY - top.minY >= top.maxX - top.minX
  const [length, width] = along ? [top.maxY - top.minY, top.maxX - top.minX] : [top.maxX - top.minX, top.maxY - top.minY]
  const at = { x: (top.minX + top.maxX) / 2, y: (top.minY + top.maxY) / 2 }
  const print = lidPrint(at, length * PRINT_SHARE, width * PRINT_SHARE, h, lines, INK, along)
  return [...pieces, ...print, ...leads(input)]
}
