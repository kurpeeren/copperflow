// The board from a drawing as one edit (`setBoardShape`): the `<board>`'s outline, its `<hole>`s and its `<keepout>`s
// at once. The outline replaces width, height, pcbX and pcbY; the holes and keepouts go just before </board>. A board
// that has holes or keepouts already is refused unless `replace`, which removes them first; only those written right
// inside the board can be removed here.
import MagicString from "magic-string"
import type { JSXElement, Node } from "@babel/types"
import { pointInPolygon } from "../engine/checks/geometry.js"
import { parseSource, type Scan } from "./analyze.js"
import { outlineProblem } from "./board-items.js"
import { EditError } from "./edit-error.js"
import { attributeNamed, cleanPoint, jsxAttributes, lineEnding, lineIndent } from "./edit-text.js"
import { formatLiteral, formatPointList, readPointList } from "./literals.js"
import type { Edit, Point } from "./types.js"

type SetBoardShape = Extract<Edit, { kind: "setBoardShape" }>

/** Far beyond any drawing's corner count. */
const MAX_CORNERS = 20_000
const MAX_ITEMS = 1000
/** The smallest hole a fab drills, in mm. */
const MIN_HOLE = 0.1
const MAX_HOLE = 1000
/** The props a board's rectangle is written with; an outline takes their place. */
const RECTANGLE_PROPS = ["width", "height", "pcbX", "pcbY"]

const mmText = (n: number) => String(Math.round(n * 1e4) / 1e4)

function polygonOrThrow(value: unknown, what: string): Point[] {
  const points = Array.isArray(value) && value.length >= 3 && value.length <= MAX_CORNERS ? value.map(cleanPoint) : []
  if (points.length < 3 || points.some((p) => p === undefined)) throw new EditError("invalid", `${what} must be a list of 3 to ${MAX_CORNERS} points with numbers x and y`)
  const problem = outlineProblem(points as Point[])
  if (problem) throw new EditError("invalid", `${what} is not a simple polygon: ${problem}`)
  return points as Point[]
}

interface Element {
  tag: string
  start: number
  end: number
  /** Written right inside the board. */
  direct: boolean
}

/** Every `<hole>` and `<keepout>` of the file, and whether each is a direct child of the (first) board. */
function holesAndKeepouts(source: string): Element[] {
  const found: Element[] = []
  let board: JSXElement | undefined
  const tagOf = (node: JSXElement) => source.slice(node.openingElement.name.start ?? 0, node.openingElement.name.end ?? 0)
  const visit = (node: Node, parent: JSXElement | undefined) => {
    let inside = parent
    if (node.type === "JSXElement") {
      const tag = tagOf(node)
      if (tag === "board" && !board) board = node
      if (tag === "hole" || tag === "keepout") found.push({ tag, start: node.start ?? 0, end: node.end ?? 0, direct: parent !== undefined && parent === board })
      inside = node
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key.endsWith("Comments")) continue
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === "object" && typeof (child as Node).type === "string") visit(child as Node, inside)
      }
    }
  }
  visit(parseSource(source).program, undefined)
  return found
}

/** How many holes and keepouts the file writes. */
export function boardShapeItems(source: string, scan: Scan): { holes: number; keepouts: number } {
  const items = scan.boardNode ? holesAndKeepouts(source) : []
  return { holes: items.filter((item) => item.tag === "hole").length, keepouts: items.filter((item) => item.tag === "keepout").length }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

function removeLines(out: MagicString, source: string, item: Element): void {
  const lineStart = source.lastIndexOf("\n", item.start - 1) + 1
  const newline = source.indexOf("\n", item.end)
  const lineEnd = newline === -1 ? source.length : newline + 1
  const fills = source.slice(lineStart, item.start).trim() === "" && source.slice(item.end, lineEnd).trim() === ""
  out.remove(fills ? lineStart : item.start, fills ? lineEnd : item.end)
}

/** The new elements, each on its own line before </board>. */
function insertBeforeClose(out: MagicString, source: string, scan: Scan, elements: readonly string[]): void {
  if (elements.length === 0) return
  const close = scan.model.boardClose?.start
  const indent = close === undefined ? undefined : lineIndent(source, close)
  if (close === undefined || indent === undefined) throw new EditError("invalid", "</board> must be on its own line to add holes and keepouts")
  const child = indent + (indent.includes("\t") ? "\t" : "  ")
  out.appendRight(close - indent.length, elements.map((element) => child + element + lineEnding(source)).join(""))
}

function holeElement(hole: { x: number; y: number; diameter: number }, outline: Point[]): string {
  const [x, y, diameter] = [hole.x, hole.y, hole.diameter].map((v) => Math.round(v * 1e4) / 1e4 || 0) as [number, number, number]
  if (!Number.isFinite(diameter) || diameter < MIN_HOLE || diameter > MAX_HOLE) throw new EditError("invalid", `A hole's diameter must be at least ${MIN_HOLE} mm`)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !pointInPolygon({ x, y }, outline)) throw new EditError("invalid", `The hole at (${mmText(x)}, ${mmText(y)}) lies outside the outline`)
  return `<hole x=${formatLiteral(x)} y=${formatLiteral(y)} diameter=${formatLiteral(diameter)} />`
}

/** Gives the board the outline, holes and keepouts `edit` names. */
export function setBoardShape(source: string, scan: Scan, edit: SetBoardShape, locked: ReadonlySet<string>): string {
  const board = scan.boardNode?.node
  if (!board) throw new EditError("invalid", "The file has no <board> element to reshape")
  const outline = polygonOrThrow(edit.outline, "The board's outline")
  if (edit.holes.length > MAX_ITEMS || edit.keepouts.length > MAX_ITEMS) throw new EditError("invalid", `At most ${MAX_ITEMS} holes and ${MAX_ITEMS} keepouts`)
  const elements = [
    ...edit.holes.map((hole) => holeElement(hole, outline)),
    ...edit.keepouts.map((keepout, i) => `<keepout outline=${formatPointList(polygonOrThrow(keepout, `Inner shape ${i + 1}`))} layers="all" />`),
  ]
  if (edit.keepItems && elements.length > 0) throw new EditError("invalid", "keepItems changes only the outline: give no holes or keepouts with it")
  const existing = edit.keepItems ? [] : holesAndKeepouts(source)
  if (existing.length > 0 && !edit.replace) {
    const holes = existing.filter((item) => item.tag === "hole").length
    const words = [holes > 0 ? plural(holes, "hole") : "", existing.length > holes ? plural(existing.length - holes, "keepout") : ""].filter((w) => w !== "")
    throw new EditError("invalid", `The board already has ${words.join(" and ")}; pass replace: true to replace them`)
  }
  const nested = existing.find((item) => !item.direct)
  if (nested) throw new EditError("readonly", `A <${nested.tag}> on line ${source.slice(0, nested.start).split("\n").length} is not written right inside the board; remove it by hand first`)
  const lockedHole = edit.keepItems ? undefined : (scan.model.boardItems ?? []).find((item) => item.tag === "hole" && locked.has(item.id))
  if (lockedHole) throw new EditError("locked", `${lockedHole.id} is locked; ask the human to unlock it`)

  const out = new MagicString(source)
  const given = attributeNamed(source, board, "outline")
  if (given && !readPointList(given.value)) throw new EditError("readonly", "board.outline is not a literal list of points and cannot be edited")
  if (given?.value) out.overwrite(given.value.start ?? 0, given.value.end ?? 0, formatPointList(outline))
  else out.appendLeft(board.openingElement.name.end ?? 0, ` outline=${formatPointList(outline)}`)
  const attributes = jsxAttributes(board)
  for (const key of RECTANGLE_PROPS) {
    const attribute = attributeNamed(source, board, key)
    if (!attribute) continue
    const before = attributes[attributes.indexOf(attribute) - 1]
    out.remove(before?.end ?? board.openingElement.name.end ?? 0, attribute.end ?? 0)
  }
  for (const item of existing) removeLines(out, source, item)
  insertBeforeClose(out, source, scan, elements)
  return out.toString()
}
