// The board's own shape: `setBoard` writes a rectangle as the `<board>` element draws it, width, height and centre
// (pcbX, pcbY), or its four corners when the board is drawn with an outline. Layout → Fit board and the agent's
// fit_board write it.
import MagicString from "magic-string"
import type { Scan } from "./analyze.js"
import { EditError } from "./edit-error.js"
import { attributeNamed, putAttribute } from "./edit-text.js"
import { formatLiteral, formatPointList, readPointList } from "./literals.js"
import type { Edit } from "./types.js"

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
  return { kind: "setBoard", width: tidy(edit.width), height: tidy(edit.height), x: tidy(edit.x), y: tidy(edit.y) }
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
