// Edits of the board's drawings (`<boardgraphic>`), addressed by the engine's ids ("boardgraphic:1"; see
// board-items.ts). The file, layer and size are held to the engine's limits (engine/board-graphic.ts), so a drawing
// the build would drop for a bad prop is refused here with the same reason. Each edit writes only its element's text.
import MagicString from "magic-string"
import { BOARD_GRAPHIC_TAG, COPPER_GRAPHIC_LAYERS, graphicFileProblem, graphicNetProblem, graphicLayerProblem, graphicScaleProblem, graphicWidthProblem } from "../engine/board-graphic.js"
import type { Scan } from "./analyze.js"
import { EditError } from "./edit-error.js"
import { atTop, attributeNamed, MAX_COORDINATE, putAttribute } from "./edit-text.js"
import { formatLiteral } from "./literals.js"
import { addItem, removeAttribute, requireEditableItem } from "./pour-edits.js"
import type { BoardBox, Edit, Literal } from "./types.js"

/** The longest name a drawing may carry, in characters. */
const MAX_NAME = 100
/** A turn beyond this many degrees either way is a slip. */
const MAX_TURN = 360
/** The props that may be removed: the drawing then takes its own size, no turn, no fill, no name or no net. */
const REMOVABLE = new Set(["width", "scale", "rotation", "fill", "name", "net"])

type Check = (value: unknown) => string | undefined

const coordinate = (axis: string): Check => (value) =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE ? undefined : `${axis} must be a number of mm`
/** Each prop a drawing takes, with what is wrong with a value for it. */
const PROPS: Record<string, Check> = {
  file: graphicFileProblem,
  layer: graphicLayerProblem,
  x: coordinate("x"),
  y: coordinate("y"),
  width: graphicWidthProblem,
  scale: graphicScaleProblem,
  rotation: (value) => (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_TURN ? undefined : `rotation must be a number of degrees from -${MAX_TURN} to ${MAX_TURN}`),
  fill: (value) => (typeof value === "boolean" ? undefined : "fill must be true or false"),
  // The layer is checked with the net once both are known (netOnCopper); the circuit's nets are checked by the build.
  net: (value) => graphicNetProblem(value, COPPER_GRAPHIC_LAYERS[0]),
  name: (value) => (typeof value === "string" && value.trim() !== "" && value.length <= MAX_NAME ? undefined : `name must be some words of at most ${MAX_NAME} characters`),
}

function formatted(key: string, value: unknown): string {
  const check = PROPS[key]
  if (!check) throw new EditError("invalid", `A board drawing has no prop "${key}"; it takes ${Object.keys(PROPS).join(", ")}`)
  const problem = check(value)
  if (problem) throw new EditError("invalid", problem)
  return formatLiteral(value as Literal)
}

/** Refuses a net on a drawing that is not on copper. */
function netOnCopper(net: unknown, layer: unknown): void {
  if (net === undefined || net === null) return
  const problem = graphicNetProblem(net, layer ?? "top-silkscreen")
  if (problem) throw new EditError("invalid", problem)
}

/** Refuses a centre off the board's rectangle, when the board's rectangle is known. */
function checkOnBoard(x: unknown, y: unknown, box: BoardBox | undefined): void {
  if (!box || typeof x !== "number" || typeof y !== "number") return
  if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) throw new EditError("invalid", `the drawing's middle (${x}, ${y}) lies outside the board; put it on the board`)
}

export function addBoardGraphic(source: string, scan: Scan, edit: Extract<Edit, { kind: "addBoardGraphic" }>): string {
  if (edit.width !== undefined && edit.scale !== undefined) throw new EditError("invalid", "give width or scale, not both")
  const ordered = { name: edit.name, file: edit.file, layer: edit.layer, net: edit.net, x: edit.x, y: edit.y, width: edit.width, scale: edit.scale, rotation: edit.rotation, fill: edit.fill }
  const attributes = Object.entries(ordered).flatMap(([key, value]) => (value === undefined ? [] : [`${key}=${formatted(key, value)}`]))
  checkOnBoard(edit.x, edit.y, scan.model.boardBox)
  netOnCopper(edit.net, edit.layer)
  return addItem(source, scan, BOARD_GRAPHIC_TAG, `<${BOARD_GRAPHIC_TAG} ${attributes.join(" ")} />`)
}

/** The width and scale left once the edit's props are written: a new one of them takes the other's place. */
function sizeProps(props: Record<string, Literal | null>, written: (key: string) => boolean): Record<string, Literal | null> {
  if (props["width"] !== undefined && props["width"] !== null && props["scale"] !== undefined && props["scale"] !== null) throw new EditError("invalid", "give width or scale, not both")
  if (props["width"] !== undefined && props["width"] !== null && written("scale") && !("scale" in props)) return { ...props, scale: null }
  if (props["scale"] !== undefined && props["scale"] !== null && written("width") && !("width" in props)) return { ...props, width: null }
  return props
}

export function setBoardGraphic(source: string, scan: Scan, edit: Extract<Edit, { kind: "setBoardGraphic" }>, locked: ReadonlySet<string>): string {
  const { item, node } = requireEditableItem(scan, BOARD_GRAPHIC_TAG, edit.id, locked)
  if (Object.keys(edit.props).length === 0) throw new EditError("invalid", `Nothing to change on ${edit.id}; give ${Object.keys(PROPS).join(", ")}`)
  const props = sizeProps(edit.props, (key) => attributeNamed(source, node, key) !== undefined)
  const value = (key: string) => (key in props ? props[key] : item.props[key]?.literal)
  if (atTop(item.parent)) checkOnBoard(value("x"), value("y"), scan.model.boardBox)
  netOnCopper(value("net"), value("layer"))
  const out = new MagicString(source)
  for (const [key, one] of Object.entries(props)) {
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
