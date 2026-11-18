// Edits of the board's silkscreen texts (`<silkscreentext>`), addressed by the engine's ids ("silkscreentext:1"; see
// board-items.ts). The words, side and height are held to the engine's limits (engine/silk-text.ts), so a text the
// build would drop is refused here with the same reason. Each edit writes only its element's text.
import MagicString from "magic-string"
import { silkHeightProblem, silkLayerProblem, silkWordsProblem, SILK_TEXT_TAG } from "../engine/silk-text.js"
import type { Scan } from "./analyze.js"
import { EditError } from "./edit-error.js"
import { atTop, attributeNamed, MAX_COORDINATE, putAttribute } from "./edit-text.js"
import { formatLiteral } from "./literals.js"
import { addItem, removeAttribute, requireEditableItem } from "./pour-edits.js"
import type { BoardBox, Edit, Literal } from "./types.js"

/** The longest name a text may carry, in characters. */
const MAX_NAME = 100
/** A turn beyond this many degrees either way is a slip. */
const MAX_TURN = 360
/** The props that may be removed: the text then takes the default height, no turn, or no name. */
const REMOVABLE = new Set(["height", "rotation", "name"])

type Check = (value: unknown) => string | undefined

const coordinate: Check = (value) => (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE ? undefined : "must be a number of mm")
/** Each prop a text takes, with what is wrong with a value for it. */
const PROPS: Record<string, Check> = {
  text: silkWordsProblem,
  x: (value) => coordinate(value) && `x ${coordinate(value)}`,
  y: (value) => coordinate(value) && `y ${coordinate(value)}`,
  layer: silkLayerProblem,
  height: silkHeightProblem,
  rotation: (value) => (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_TURN ? undefined : `rotation must be a number of degrees from -${MAX_TURN} to ${MAX_TURN}`),
  name: (value) => (typeof value === "string" && value.trim() !== "" && value.length <= MAX_NAME ? undefined : `name must be some words of at most ${MAX_NAME} characters`),
}

function formatted(key: string, value: unknown): string {
  const check = PROPS[key]
  if (!check) throw new EditError("invalid", `A silkscreen text has no prop "${key}"; it takes ${Object.keys(PROPS).join(", ")}`)
  const problem = check(value)
  if (problem) throw new EditError("invalid", problem)
  return formatLiteral(value as Literal)
}

/** Refuses a centre off the board's rectangle, when the board's rectangle is known. */
function checkOnBoard(x: unknown, y: unknown, box: BoardBox | undefined): void {
  if (!box || typeof x !== "number" || typeof y !== "number") return
  if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) throw new EditError("invalid", `the text's middle (${x}, ${y}) lies outside the board; put it on the board`)
}

export function addSilkText(source: string, scan: Scan, edit: Extract<Edit, { kind: "addSilkText" }>): string {
  const ordered = { name: edit.name, text: edit.text, x: edit.x, y: edit.y, layer: edit.layer, height: edit.height, rotation: edit.rotation }
  const attributes = Object.entries(ordered).flatMap(([key, value]) => (value === undefined ? [] : [`${key}=${formatted(key, value)}`]))
  checkOnBoard(edit.x, edit.y, scan.model.boardBox)
  return addItem(source, scan, SILK_TEXT_TAG, `<${SILK_TEXT_TAG} ${attributes.join(" ")} />`)
}

export function setSilkText(source: string, scan: Scan, edit: Extract<Edit, { kind: "setSilkText" }>, locked: ReadonlySet<string>): string {
  const { item, node } = requireEditableItem(scan, SILK_TEXT_TAG, edit.id, locked)
  if (Object.keys(edit.props).length === 0) throw new EditError("invalid", `Nothing to change on ${edit.id}; give text, x, y, layer, height, rotation or name`)
  const value = (key: string) => (key in edit.props ? edit.props[key] : item.props[key]?.literal)
  if (atTop(item.parent)) checkOnBoard(value("x"), value("y"), scan.model.boardBox)
  const out = new MagicString(source)
  for (const [key, one] of Object.entries(edit.props)) {
    if (one === null) {
      if (!REMOVABLE.has(key)) throw new EditError("invalid", `${key} cannot be removed; only ${[...REMOVABLE].join(", ")} can`)
      removeAttribute(out, source, node, key)
      continue
    }
    const text = formatted(key, one)
    if (attributeNamed(source, node, key) && !item.props[key]?.editable) {
      throw new EditError("readonly", `${edit.id}.${key} is an expression (${item.props[key]?.source}) and cannot be edited`)
    }
    putAttribute(out, source, node, key, text)
  }
  return out.toString()
}
