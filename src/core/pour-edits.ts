// Edits of the board's copper pours and holes (`<copperpour>`, `<hole>`), addressed by the engine's ids
// ("copperpour:1", "hole:1"; see board-items.ts). Each writes only its element's text.
import MagicString from "magic-string"
import type { JSXElement } from "@babel/types"
import { scanCircuit, type Scan } from "./analyze.js"
import { POUR_LAYERS } from "./board-items.js"
import { drawingKeeper } from "./drawing-identity.js"
import { EditError } from "./edit-error.js"
import { atTop, attributeNamed, boardInsertion, cleanPoint, jsxAttributes, lineEnding, lineIndent, MAX_COORDINATE, putAttribute, removeRange } from "./edit-text.js"
import { formatLiteral, formatPointList } from "./literals.js"
import type { BoardItemInfo, BoardItemTag, BoardItemValue, Edit, Literal, Point } from "./types.js"

const MAX_OUTLINE = 1000
/** Far beyond any board; keeps the file's numbers sane. */
const MAX_SIZE = 1000

type Check = (key: string, value: unknown) => void

const positive: Check = (key, value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_SIZE) throw new EditError("invalid", `${key} must be a number of mm above 0 and at most ${MAX_SIZE}`)
}
const coordinate: Check = (key, value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) throw new EditError("invalid", `${key} must be a number of mm`)
}

/** The props a pour may be given, each with its check; net, layer and outline have their own. */
const POUR_PROPS: Record<string, Check> = {
  priority: (key, value) => {
    if (typeof value !== "number" || !Number.isInteger(value) || Math.abs(value) > MAX_SIZE) throw new EditError("invalid", `${key} must be a whole number`)
  },
  clearance: positive,
  minWidth: positive,
  thermal: (key, value) => {
    if (value !== "relief" && value !== "solid") throw new EditError("invalid", `${key} must be "relief" or "solid"`)
  },
  thermalWidth: positive,
  thermalGap: positive,
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

/** A pour's outline, rounded as corners are: 3 to MAX_OUTLINE points. */
function outlineOrThrow(value: unknown): Point[] {
  const points = Array.isArray(value) && value.length >= 3 && value.length <= MAX_OUTLINE ? value.map(cleanPoint) : []
  if (points.length < 3 || points.some((point) => point === undefined)) throw new EditError("invalid", `outline must be a list of 3 to ${MAX_OUTLINE} points with numbers x and y`)
  return points as Point[]
}

/** A pour prop as an attribute value, checked. */
function formatPourProp(key: string, value: unknown): string {
  if (key === "net") return formatLiteral(netOrThrow(value))
  if (key === "layer") return formatLiteral(layerOrThrow(value))
  if (key === "outline") return formatPointList(outlineOrThrow(value))
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
 * Where a new pour or hole goes: right after the last one of its tag when that one is at the top of the board and
 * on its own line, so the earlier ids stay; else before the board's first trace, as a part goes.
 */
function itemInsertion(source: string, scan: Scan, tag: BoardItemTag): { lineStart: number; indent: string } {
  const usual = boardInsertion(source, scan, tag === "hole" ? "a hole" : "a copper pour")
  const last = itemsOf(scan).filter((item) => item.tag === tag).at(-1)
  if (!last || last.start < usual.lineStart || !atTop(last.parent)) return usual
  const indent = lineIndent(source, last.start)
  const newline = source.indexOf("\n", last.end)
  if (indent === undefined || newline === -1 || source.slice(last.end, newline).trim() !== "") return usual
  return { lineStart: newline + 1, indent }
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
  const attributes = [`net=${formatPourProp("net", edit.net)}`, `layer=${formatPourProp("layer", edit.layer)}`]
  if (edit.outline !== undefined) attributes.push(`outline=${formatPourProp("outline", edit.outline)}`)
  for (const [key, value] of Object.entries(edit.props ?? {})) {
    if (key === "net" || key === "layer" || key === "outline") throw new EditError("invalid", `pass ${key} as its own argument`)
    attributes.push(`${key}=${formatPourProp(key, value)}`)
  }
  return addItem(source, scan, "copperpour", `<copperpour ${attributes.join(" ")} />`)
}

export function addHole(source: string, scan: Scan, edit: Extract<Edit, { kind: "addHole" }>): string {
  const attributes = (["x", "y", "diameter"] as const).map((key) => `${key}=${formatHoleProp(key, edit[key])}`)
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

function setItem(source: string, scan: Scan, tag: BoardItemTag, id: string, props: Record<string, BoardItemValue>, locked: ReadonlySet<string>): string {
  const { item, node } = requireEditableItem(scan, tag, id, locked)
  const out = new MagicString(source)
  for (const [key, value] of Object.entries(props)) {
    if (value === null) {
      if (tag === "hole" || key === "net" || key === "layer") throw new EditError("invalid", `${key} cannot be removed`)
      if (key !== "outline" && !POUR_PROPS[key]) throw new EditError("invalid", `A copper pour has no prop "${key}"`)
      removeAttribute(out, source, node, key)
      continue
    }
    const formatted = tag === "hole" ? formatHoleProp(key, value) : formatPourProp(key, value)
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
