// Edits of schematic drawings, addressed by the engine's drawing id (see drawing-scan.ts).
import MagicString from "magic-string"
import type { JSXElement } from "@babel/types"
import { drawingKindOf } from "../engine/drawing-kinds.js"
import { MAIN_PAGE, type DrawingKind } from "../engine/model.js"
import { scanCircuit, type Scan } from "./analyze.js"
import { drawingKeeper } from "./drawing-identity.js"
import { checkDrawingName } from "./drawing-names.js"
import { EditError } from "./edit-error.js"
import { insertOnPage } from "./page-edits.js"
import {
  atTop,
  attributeNamed,
  boardInsertion,
  cleanPoint,
  lineEnding,
  lineIndent,
  MAX_COORDINATE,
  putAttribute,
  removeRange,
  validateOrThrow,
} from "./edit-text.js"
import { formatLiteral, formatPointList } from "./literals.js"
import type { DrawingInfo, Edit, Literal, Point } from "./types.js"

const MAX_POINTS = 1000
const POINTS = `a list of 2 to ${MAX_POINTS} points with numbers x and y between -${MAX_COORDINATE} and ${MAX_COORDINATE}`

/** A drawing's points, rounded as wire corners are; throws for anything but a list of 2 to MAX_POINTS points. */
function pointsOrThrow(value: unknown): Point[] {
  const points = Array.isArray(value) && value.length >= 2 && value.length <= MAX_POINTS ? value.map(cleanPoint) : []
  if (points.length < 2 || points.some((point) => point === undefined)) throw new EditError("invalid", `points must be ${POINTS}`)
  return points as Point[]
}

/** A drawing prop as an attribute value: `points` a literal list of points, every other prop a literal. */
function formatDrawingProp(key: string, value: unknown): string {
  if (key === "points") return formatPointList(pointsOrThrow(value))
  if (Array.isArray(value)) throw new EditError("invalid", `${key} takes a string, number or boolean; only points takes a list of points`)
  validateOrThrow(key, value)
  return formatLiteral(value as Literal)
}

function kindOrThrow(tag: string): DrawingKind {
  const kind = drawingKindOf(tag)
  if (!kind) throw new EditError("invalid", `"${tag}" is not a drawing tag such as schematicrect or bus`)
  return kind
}

/**
 * Where a new drawing goes: before the board's first trace (or before </board>), as addPart puts a part, or
 * right after the last drawing of its kind when that one is written later in the board, since a drawing's index
 * id counts every earlier tag of its kind and a new one before it would shift it.
 */
function drawingInsertion(source: string, scan: Scan, tag: string): { lineStart: number; indent: string } {
  const usual = boardInsertion(source, scan, "a drawing")
  const last = scan.model.drawings.filter((d) => d.tag === tag).at(-1)
  if (!last || last.start < usual.lineStart || !atTop(last.parent)) return usual
  const indent = lineIndent(source, last.start)
  const newline = source.indexOf("\n", last.end)
  if (indent === undefined || newline === -1 || source.slice(last.end, newline).trim() !== "") return usual
  return { lineStart: newline + 1, indent }
}

/**
 * Adds a drawing (see drawingInsertion for where). One that would still change the id of a drawing already in
 * the file, such as a later one of its kind inside a group, is refused.
 */
export function addDrawing(source: string, scan: Scan, edit: Extract<Edit, { kind: "addDrawing" }>): string {
  const kind = kindOrThrow(edit.tag)
  if (kind === "bus" && edit.name === undefined) throw new EditError("invalid", 'A bus needs a name such as "D[0:7]" or "CLK"')
  if (edit.name !== undefined) checkDrawingName(scan.model, kind, edit.name)
  const props = Object.entries(edit.props).map(([key, value]) => {
    if (key === "name") throw new EditError("invalid", "pass name as its own argument")
    return ` ${key}=${formatDrawingProp(key, value)}`
  })
  const name = edit.name === undefined ? "" : ` name=${formatLiteral(edit.name)}`
  const element = `<${edit.tag}${name}${props.join("")} />`
  if (edit.page !== undefined && edit.page !== MAIN_PAGE) {
    const next = insertOnPage(source, scan, element, edit.page, "a drawing")
    keepIdsAround(source, scan, next, element)
    return next
  }
  const { lineStart, indent } = drawingInsertion(source, scan, edit.tag)
  const next = source.slice(0, lineStart) + indent + element + lineEnding(source) + source.slice(lineStart)
  keepOtherIds(scan, next, lineStart + indent.length)
  return next
}

/** Refuses a new drawing (starting at `added`) that would change the id of a drawing already in the file. */
function keepOtherIds(scan: Scan, next: string, added: number): void {
  let after: Scan
  try {
    after = scanCircuit(next)
  } catch {
    return // applyEdits rescans the result and reports code that does not parse.
  }
  const before = scan.model.drawings.map((d) => d.id)
  const now = after.model.drawings.filter((d) => d.start !== added).map((d) => d.id)
  const changed = before.find((id, index) => now[index] !== id)
  if (changed !== undefined) throw new EditError("invalid", `The new drawing would change the id of ${changed}; add it after that one by hand`)
}

/** Refuses a new drawing (`element`), wherever it went, that would change the id of a drawing already in the file. */
function keepIdsAround(source: string, scan: Scan, next: string, element: string): void {
  const textOf = (text: string, d: { start: number; end: number }) => text.slice(d.start, d.end)
  const before = scan.model.drawings.map((d) => ({ id: d.id, text: textOf(source, d) }))
  const now = scanCircuit(next).model.drawings.map((d) => ({ id: d.id, text: textOf(next, d) }))
  const sameOthers = (added: number) => {
    const rest = now.filter((_, index) => index !== added)
    return rest.length === before.length && rest.every((d, index) => d.text === before[index]?.text)
  }
  const added = now.findIndex((d, index) => d.text === element && sameOthers(index))
  const changed = before.find((d, index) => now.filter((_, other) => other !== added)[index]?.id !== d.id)
  if (changed !== undefined) throw new EditError("invalid", `The new drawing would change the id of ${changed.id}; add it after that one by hand`)
}

function requireEditableDrawing(scan: Scan, id: string, locked: ReadonlySet<string>): { drawing: DrawingInfo; node: JSXElement } {
  const drawing = scan.model.drawings.find((d) => d.id === id)
  const node = scan.drawingNodes.get(id)
  if (!drawing || !node) throw new EditError("not_found", `No drawing with id ${id}`)
  if (locked.has(id)) throw new EditError("locked", `${id} is locked; ask the human to unlock it`)
  if (!drawing.editable) throw new EditError("readonly", `${id} is read-only (${drawing.readonlyReason})`)
  return { drawing, node }
}

export function removeDrawing(source: string, scan: Scan, id: string, locked: ReadonlySet<string>): string {
  const { drawing } = requireEditableDrawing(scan, id, locked)
  return removeRange(source, drawing.start, drawing.end)
}

/** Sets literal props of a drawing (moving it is setting x and y, or points); a `name` renames it. */
export function setDrawingProps(source: string, scan: Scan, edit: Extract<Edit, { kind: "setDrawingProps" }>, locked: ReadonlySet<string>): string {
  const { drawing, node } = requireEditableDrawing(scan, edit.id, locked)
  const out = new MagicString(source)
  for (const [key, value] of Object.entries(edit.props)) {
    if (key === "name") {
      if (typeof value !== "string") throw new EditError("invalid", "name must be a string")
      checkDrawingName(scan.model, kindOrThrow(drawing.tag), value, drawing.id)
      putAttribute(out, source, node, key, formatLiteral(value))
      continue
    }
    const formatted = formatDrawingProp(key, value)
    if (attributeNamed(source, node, key) && !drawing.props[key]?.editable) {
      throw new EditError("readonly", `${edit.id}.${key} is an expression (${drawing.props[key]?.source}) and cannot be edited`)
    }
    putAttribute(out, source, node, key, formatted)
  }
  return out.toString()
}

/**
 * Refuses an edit that would change, remove or renumber a locked drawing, even one it does not name: removing
 * an earlier unnamed drawing of the same kind, for example, would hand its id to the next one.
 */
export function keepLockedDrawings(source: string, scan: Scan, next: string, after: Scan, locked: ReadonlySet<string>): void {
  const kept = drawingKeeper(source, next)
  for (const drawing of scan.model.drawings) {
    if (!locked.has(drawing.id)) continue
    const now = after.model.drawings.find((d) => d.id === drawing.id)
    if (!now || !kept(drawing, now)) {
      throw new EditError("locked", `The edit would change the locked drawing ${drawing.id}; ask the human to unlock it`)
    }
  }
}
