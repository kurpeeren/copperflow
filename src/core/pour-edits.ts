// Edits of the board's copper pours and holes (`<copperpour>`, `<hole>`), addressed by the engine's ids
// ("copperpour:1", "hole:1"; see board-items.ts). Each writes only its element's text.
import MagicString from "magic-string"
import type { JSXElement } from "@babel/types"
import { scanCircuit, type Scan } from "./analyze.js"
import { outlineProblem, POUR_LAYERS } from "./board-items.js"
import { drawingKeeper } from "./drawing-identity.js"
import { EditError } from "./edit-error.js"
import { atTop, attributeNamed, boardInsertion, cleanPoint, jsxAttributes, lineEnding, lineIndent, MAX_COORDINATE, putAttribute, removeRange } from "./edit-text.js"
import { formatLiteral, formatPointList } from "./literals.js"
import type { BoardBox, BoardItemInfo, BoardItemTag, BoardItemValue, Edit, Literal, Point } from "./types.js"

const MAX_OUTLINE = 1000
/** Far beyond any board; keeps the file's numbers sane. */
const MAX_SIZE = 1000
/** A pour's clearance, minimum width and thermal sizes, in mm: anything larger is a slip, not a design. */
const MAX_POUR_SIZE = 10
/** The smallest hole a fab drills, in mm. */
const MIN_HOLE = 0.1

type Check = (key: string, value: unknown) => void

const positive: Check = (key, value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_SIZE) throw new EditError("invalid", `${key} must be a number of mm above 0 and at most ${MAX_SIZE}`)
}
const smallSize: Check = (key, value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_POUR_SIZE) throw new EditError("invalid", `${key} must be a number of mm above 0 and at most ${MAX_POUR_SIZE}`)
}
const coordinate: Check = (key, value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) throw new EditError("invalid", `${key} must be a number of mm`)
}

/** The props a pour may be given, each with its check; net, layer and outline have their own. */
const POUR_PROPS: Record<string, Check> = {
  priority: (key, value) => {
    if (typeof value !== "number" || !Number.isInteger(value) || Math.abs(value) > MAX_SIZE) throw new EditError("invalid", `${key} must be a whole number`)
  },
  clearance: smallSize,
  minWidth: smallSize,
  thermal: (key, value) => {
    if (value !== "relief" && value !== "solid") throw new EditError("invalid", `${key} must be "relief" or "solid"`)
  },
  thermalWidth: smallSize,
  thermalGap: smallSize,
}

const HOLE_PROPS: Record<string, Check> = { x: coordinate, y: coordinate, diameter: positive }

function netOrThrow(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 200) throw new EditError("invalid", 'net must be a net name such as "GND"')
  return value
}

function layerOrThrow(value: unknown): string {
  if (!(POUR_LAYERS as readonly unknown[]).includes(value)) throw new EditError("invalid", `layer must be one of ${POUR_LAYERS.join(", ")}`)
  return value as string
}

const mmText = (n: number) => String(Math.round(n * 1e6) / 1e6)
const pointText = (p: Point) => `(${mmText(p.x)}, ${mmText(p.y)})`
const onBoard = (box: BoardBox, p: Point) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY

/** A pour's outline, rounded as corners are: 3 to MAX_OUTLINE points, each on the board when its rectangle is known. */
function outlineOrThrow(value: unknown, box: BoardBox | undefined): Point[] {
  const points = Array.isArray(value) && value.length >= 3 && value.length <= MAX_OUTLINE ? value.map(cleanPoint) : []
  if (points.length < 3 || points.some((point) => point === undefined)) throw new EditError("invalid", `outline must be a list of 3 to ${MAX_OUTLINE} points with numbers x and y`)
  const outside = box && (points as Point[]).find((point) => !onBoard(box, point))
  if (outside) throw new EditError("invalid", `outline point ${pointText(outside)} lies outside the board`)
  const problem = outlineProblem(points as Point[])
  if (problem) throw new EditError("invalid", `The pour's outline is not a simple polygon: ${problem}`)
  return points as Point[]
}

/** A hole whose centre is on the board and whose diameter is at least MIN_HOLE and at most the board's smaller side. */
function checkHole(hole: { x: number; y: number; diameter: number }, box: BoardBox | undefined): void {
  if (hole.diameter < MIN_HOLE) throw new EditError("invalid", `diameter must be at least ${MIN_HOLE} mm`)
  if (!box) return
  const side = Math.min(box.maxX - box.minX, box.maxY - box.minY)
  if (hole.diameter > side) throw new EditError("invalid", `diameter must be at most ${mmText(side)} mm, the board's smaller side`)
  const known = Number.isFinite(hole.x) && Number.isFinite(hole.y)
  if (known && !onBoard(box, hole)) throw new EditError("invalid", `the hole at ${pointText(hole)} lies outside the board`)
}

/** A pour prop as an attribute value, checked. */
function formatPourProp(key: string, value: unknown, box: BoardBox | undefined): string {
  if (key === "net") return formatLiteral(netOrThrow(value))
  if (key === "layer") return formatLiteral(layerOrThrow(value))
  if (key === "outline") return formatPointList(outlineOrThrow(value, box))
  const check = POUR_PROPS[key]
  if (!check) throw new EditError("invalid", `A copper pour has no prop "${key}"; it takes net, layer, outline, ${Object.keys(POUR_PROPS).join(", ")}`)
  check(key, value)
  return formatLiteral(value as Literal)
}

function formatHoleProp(key: string, value: unknown): string {
  const check = HOLE_PROPS[key]
  if (!check) throw new EditError("invalid", `A hole has no prop "${key}"; it takes x, y and diameter`)
  check(key, value)
  return formatLiteral(value as number)
}

const itemsOf = (scan: Scan): BoardItemInfo[] => scan.model.boardItems ?? []

/**
 * Where a new pour or hole goes, always after every one of its tag, so it takes the next id and no id already in the
 * file moves: before the board's first trace (as a part goes) when they all come earlier; right after the last one when
 * it is at the top of the board on its own line; else (the last is in a group or a page) just before </board>.
 */
function itemInsertion(source: string, scan: Scan, tag: BoardItemTag): { lineStart: number; indent: string } {
  const what = tag === "hole" ? "a hole" : "a copper pour"
  const usual = boardInsertion(source, scan, what)
  const last = itemsOf(scan).filter((item) => item.tag === tag).at(-1)
  if (!last || last.end <= usual.lineStart) return usual
  const indent = lineIndent(source, last.start)
  const newline = source.indexOf("\n", last.end)
  if (atTop(last.parent) && indent !== undefined && newline !== -1 && source.slice(last.end, newline).trim() === "") return { lineStart: newline + 1, indent }
  return beforeBoardClose(source, scan, what)
}

/** The line of </board> and the indent of the board's children. */
function beforeBoardClose(source: string, scan: Scan, what: string): { lineStart: number; indent: string } {
  const close = scan.model.boardClose?.start
  const indent = close === undefined ? undefined : lineIndent(source, close)
  if (close === undefined || indent === undefined) throw new EditError("invalid", `</board> must be on its own line to add ${what}`)
  return { lineStart: close - indent.length, indent: indent + (indent.includes("\t") ? "\t" : "  ") }
}

/** Adds an element of `tag` and refuses the result when it would change the id of a pour or hole already in the file. */
function addItem(source: string, scan: Scan, tag: BoardItemTag, element: string): string {
  const { lineStart, indent } = itemInsertion(source, scan, tag)
  const next = source.slice(0, lineStart) + indent + element + lineEnding(source) + source.slice(lineStart)
  const added = lineStart + indent.length
  const before = itemsOf(scan).map((item) => item.id)
  const now = (scanCircuit(next).model.boardItems ?? []).filter((item) => item.start !== added).map((item) => item.id)
  const changed = before.find((id, index) => now[index] !== id)
  if (changed !== undefined) throw new EditError("invalid", `The new ${tag} would change the id of ${changed}; add it by hand`)
  return next
}

export function addPour(source: string, scan: Scan, edit: Extract<Edit, { kind: "addPour" }>): string {
  const box = scan.model.boardBox
  const attributes = [`net=${formatPourProp("net", edit.net, box)}`, `layer=${formatPourProp("layer", edit.layer, box)}`]
  if (edit.outline !== undefined) attributes.push(`outline=${formatPourProp("outline", edit.outline, box)}`)
  for (const [key, value] of Object.entries(edit.props ?? {})) {
    if (key === "net" || key === "layer" || key === "outline") throw new EditError("invalid", `pass ${key} as its own argument`)
    attributes.push(`${key}=${formatPourProp(key, value, box)}`)
  }
  return addItem(source, scan, "copperpour", `<copperpour ${attributes.join(" ")} />`)
}

export function addHole(source: string, scan: Scan, edit: Extract<Edit, { kind: "addHole" }>): string {
  const attributes = (["x", "y", "diameter"] as const).map((key) => `${key}=${formatHoleProp(key, edit[key])}`)
  checkHole(edit, scan.model.boardBox)
  return addItem(source, scan, "hole", `<hole ${attributes.join(" ")} />`)
}

const WORD: Record<BoardItemTag, string> = { copperpour: "copper pour", hole: "hole" }

function requireEditableItem(scan: Scan, tag: BoardItemTag, id: string, locked: ReadonlySet<string>): { item: BoardItemInfo; node: JSXElement } {
  const item = itemsOf(scan).find((one) => one.id === id && one.tag === tag)
  const node = scan.boardItemNodes.get(id)
  if (!item || !node) throw new EditError("not_found", `No ${WORD[tag]} with id ${id}`)
  if (locked.has(id)) throw new EditError("locked", `${id} is locked; ask the human to unlock it`)
  if (!item.editable) throw new EditError("readonly", `${id} is read-only (${item.readonlyReason})`)
  return { item, node }
}

/** Removes an attribute and the space before it. */
function removeAttribute(out: MagicString, source: string, node: JSXElement, key: string): void {
  const attribute = attributeNamed(source, node, key)
  if (!attribute) return
  const attributes = jsxAttributes(node)
  const before = attributes[attributes.indexOf(attribute) - 1]
  out.remove(before?.end ?? node.openingElement.name.end ?? 0, attribute.end ?? 0)
}

/** A hole's position and diameter once `props` are set; an expression counts as unknown (NaN), which every check passes. */
function holeAfter(item: BoardItemInfo, props: Record<string, BoardItemValue>): { x: number; y: number; diameter: number } {
  const value = (key: string) => {
    const given = key in props ? props[key] : item.props[key]?.literal
    return typeof given === "number" ? given : Number.NaN
  }
  return { x: value("x"), y: value("y"), diameter: value("diameter") }
}

function setItem(source: string, scan: Scan, tag: BoardItemTag, id: string, props: Record<string, BoardItemValue>, locked: ReadonlySet<string>): string {
  const { item, node } = requireEditableItem(scan, tag, id, locked)
  // Inside a group or a page the coordinates are the group's own, so only an item at the top of the board is checked.
  const box = atTop(item.parent) ? scan.model.boardBox : undefined
  if (tag === "hole") checkHole(holeAfter(item, props), box)
  const out = new MagicString(source)
  for (const [key, value] of Object.entries(props)) {
    if (value === null) {
      if (tag === "hole" || key === "net" || key === "layer") throw new EditError("invalid", `${key} cannot be removed`)
      if (key !== "outline" && !POUR_PROPS[key]) throw new EditError("invalid", `A copper pour has no prop "${key}"`)
      removeAttribute(out, source, node, key)
      continue
    }
    const formatted = tag === "hole" ? formatHoleProp(key, value) : formatPourProp(key, value, box)
    if (attributeNamed(source, node, key) && !item.props[key]?.editable) {
      throw new EditError("readonly", `${id}.${key} is an expression (${item.props[key]?.source}) and cannot be edited`)
    }
    putAttribute(out, source, node, key, formatted)
  }
  return out.toString()
}

export function setPour(source: string, scan: Scan, edit: Extract<Edit, { kind: "setPour" }>, locked: ReadonlySet<string>): string {
  return setItem(source, scan, "copperpour", edit.id, edit.props, locked)
}

export function setHole(source: string, scan: Scan, edit: Extract<Edit, { kind: "setHole" }>, locked: ReadonlySet<string>): string {
  return setItem(source, scan, "hole", edit.id, edit.props, locked)
}

export function removeBoardItem(source: string, scan: Scan, tag: BoardItemTag, id: string, locked: ReadonlySet<string>): string {
  const { item } = requireEditableItem(scan, tag, id, locked)
  return removeRange(source, item.start, item.end)
}

/**
 * Refuses an edit that would change, remove or renumber a locked pour or hole, even one it does not name: removing an
 * earlier pour hands its id to the next one.
 */
export function keepLockedBoardItems(source: string, scan: Scan, next: string, after: Scan, locked: ReadonlySet<string>): void {
  const kept = drawingKeeper(source, next)
  for (const item of itemsOf(scan)) {
    if (!locked.has(item.id)) continue
    const now = itemsOf(after).find((one) => one.id === item.id)
    if (!now || !kept(item, now)) throw new EditError("locked", `The edit would change the locked ${WORD[item.tag]} ${item.id}; ask the human to unlock it`)
  }
}
