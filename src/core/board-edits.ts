// The board's own shape: `setBoard` writes a rectangle as the `<board>` element draws it, width, height and centre
// (pcbX, pcbY), or its four corners when the board is drawn with an outline. Layout → Fit board and the agent's
// fit_board write it.
import MagicString from "magic-string"
import type { Scan } from "./analyze.js"
import { EditError } from "./edit-error.js"
import { attributeNamed, putAttribute } from "./edit-text.js"
import { formatLiteral, formatPointList, readPointList } from "./literals.js"
import type { Edit } from "./types.js"
import { removeAttribute } from "./pour-edits.js"
import { MAX_HOLES, MIN_HOLES } from "../engine/proto/grid.js"

type SetBoard = Extract<Edit, { kind: "setBoard" }>

/** Far beyond any board, in mm. */
const MAX_SIZE = 1000
const tidy = (v: number) => Math.round(v * 10_000) / 10_000 || 0

function checked(edit: SetBoard): SetBoard {
  for (const key of ["width", "height"] as const) {
    const value = edit[key]
    if (!Number.isFinite(value) || value <= 0 || value > MAX_SIZE) throw new EditError("invalid", `board ${key} must be a number of mm above 0 and at most ${MAX_SIZE}`)
  }
  for (const key of ["x", "y"] as const) if (!Number.isFinite(edit[key]) || Math.abs(edit[key]) > MAX_SIZE) throw new EditError("invalid", `board ${key} must be a number of mm`)
  const holes = edit.columns === undefined && edit.rows === undefined ? {} : { columns: holeCount(edit.columns, "columns"), rows: holeCount(edit.rows, "rows") }
  return { kind: "setBoard", width: tidy(edit.width), height: tidy(edit.height), x: tidy(edit.x), y: tidy(edit.y), ...holes }
}

function holeCount(value: number | undefined, key: string): number {
  if (value === undefined || !Number.isInteger(value) || value < MIN_HOLES || value > MAX_HOLES) throw new EditError("invalid", `board ${key} must be a whole number of holes from ${MIN_HOLES} to ${MAX_HOLES}`)
  return value
}

/** Gives the board the rectangle `edit` names; refuses a file without a `<board>` and a prop written as an expression. */
export function setBoard(source: string, scan: Scan, given: SetBoard): string {
  const board = scan.boardNode
  if (!board) throw new EditError("invalid", "The file has no <board> element to reshape")
  const edit = checked(given)
  const out = new MagicString(source)
  const put = (key: string, value: string) => {
    const prop = board.props[key]
    if (prop && !prop.editable) throw new EditError("readonly", `board.${key} is an expression (${prop.source}) and cannot be edited`)
    putAttribute(out, source, board.node, key, value)
  }
  if (edit.columns !== undefined && edit.rows !== undefined) {
    // A perfboard or stripboard is sized in holes.
    put("columns", formatLiteral(edit.columns))
    put("rows", formatLiteral(edit.rows))
    if (edit.x !== 0 || board.props["pcbX"]) put("pcbX", formatLiteral(edit.x))
    if (edit.y !== 0 || board.props["pcbY"]) put("pcbY", formatLiteral(edit.y))
    return out.toString()
  }
  const outline = attributeNamed(source, board.node, "outline")
  if (outline) {
    if (!readPointList(outline.value)) throw new EditError("readonly", "board.outline is not a literal list of points and cannot be edited")
    const [left, right, top, bottom] = [edit.x - edit.width / 2, edit.x + edit.width / 2, edit.y - edit.height / 2, edit.y + edit.height / 2].map(tidy) as [number, number, number, number]
    putAttribute(out, source, board.node, "outline", formatPointList([
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ]))
    return out.toString()
  }
  put("width", formatLiteral(edit.width))
  put("height", formatLiteral(edit.height))
  if (edit.x !== 0 || board.props["pcbX"]) put("pcbX", formatLiteral(edit.x))
  if (edit.y !== 0 || board.props["pcbY"]) put("pcbY", formatLiteral(edit.y))
  return out.toString()
}

/** Gives the board `layers` copper layers; refuses a value other than 2 or 4 and a prop written as an expression. */
export function setBoardLayers(source: string, scan: Scan, layers: number): string {
  const board = scan.boardNode
  if (!board) throw new EditError("invalid", "The file has no <board> element to change")
  if (layers !== 2 && layers !== 4) throw new EditError("invalid", "board layers must be 2 or 4")
  const prop = board.props["layers"]
  if (prop && !prop.editable) throw new EditError("readonly", `board.layers is an expression (${prop.source}) and cannot be edited`)
  const out = new MagicString(source)
  putAttribute(out, source, board.node, "layers", formatLiteral(layers))
  return out.toString()
}

type SetBoardKind = Extract<Edit, { kind: "setBoardKind" }>
const PROTO_PROPS = ["kind", "columns", "rows", "strips"] as const
const PCB_PROPS = ["width", "height", "outline"] as const

/**
 * Makes the board a made PCB of width × height mm, or a perfboard or stripboard of columns × rows holes, about the
 * same centre: the other kind's props go. Refuses a board drawn as an outline (a hole grid is a rectangle) and props
 * written as expressions.
 */
export function setBoardKind(source: string, scan: Scan, edit: SetBoardKind): string {
  const board = scan.boardNode
  if (!board) throw new EditError("invalid", "The file has no <board> element to change")
  if (edit.board !== "pcb" && board.props["outline"]) throw new EditError("invalid", `A ${edit.board} is a rectangle of holes; this board is drawn as an outline, so give it a width and height first`)
  const touched = edit.board === "pcb" ? [...PROTO_PROPS, "width", "height"] : [...PCB_PROPS, ...PROTO_PROPS]
  const fixed = touched.find((key) => board.props[key] && !board.props[key]?.editable)
  if (fixed) throw new EditError("readonly", `board.${fixed} is an expression (${board.props[fixed]?.source}) and cannot be edited`)
  const out = new MagicString(source)
  if (edit.board === "pcb") {
    for (const key of PROTO_PROPS) removeAttribute(out, source, board.node, key)
    putAttribute(out, source, board.node, "width", formatLiteral(checked({ kind: "setBoard", width: edit.width, height: edit.height, x: 0, y: 0 }).width))
    putAttribute(out, source, board.node, "height", formatLiteral(edit.height))
    return out.toString()
  }
  const columns = holeCount(edit.columns, "columns")
  const rows = holeCount(edit.rows, "rows")
  for (const key of PCB_PROPS) removeAttribute(out, source, board.node, key)
  if (edit.board === "perfboard") removeAttribute(out, source, board.node, "strips")
  putAttribute(out, source, board.node, "kind", formatLiteral(edit.board))
  putAttribute(out, source, board.node, "columns", formatLiteral(columns))
  putAttribute(out, source, board.node, "rows", formatLiteral(rows))
  return out.toString()
}
