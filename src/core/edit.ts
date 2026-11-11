import MagicString from "magic-string"
import { scanCircuit, type Scan } from "./analyze.js"
import { addDrawing, keepLockedDrawings, removeDrawing, setDrawingProps } from "./drawing-edits.js"
import { EditError } from "./edit-error.js"
import { addHole, addPour, keepLockedBoardItems, removeBoardItem, setHole, setPour } from "./pour-edits.js"
import {
  attributeNamed,
  cleanPoint,
  insertInBoard,
  jsxAttributes,
  lineEnding,
  MAX_COORDINATE,
  putAttribute,
  removeRange,
  validateOrThrow,
} from "./edit-text.js"
import { formatLiteral, formatPoint, formatPointList, readPointList } from "./literals.js"
import { addInstance, setConnections } from "./instance-edits.js"
import { addPage, insertOnPage, movePartToPage, removePage, renamePage } from "./page-edits.js"
import { localNet, localNetRefusal } from "../engine/selectors.js"
import { partsInSelector, sheetFileIn } from "./selectors.js"
import { renamePort, setSheetSize } from "./sheet-edits.js"
import { renameParts } from "./rename-parts.js"
import { setBoard } from "./board-edits.js"
import { LABEL_AT_PROPS } from "../engine/component.js"
import { NO_CONNECT_PROP } from "../engine/no-connect.js"
import { MAIN_PAGE } from "../engine/model.js"
import type { Edit, Literal, PartInfo, Point, PropValue } from "./types.js"

export { EditError, type EditErrorCode } from "./edit-error.js"

/**
 * Applies edits in order and returns the new source. Only the edited spans change.
 * Throws EditError when an edit touches a locked or read-only part or drawing, or breaks the code.
 */
export function applyEdits(source: string, edits: Edit[], locked: ReadonlySet<string>): string {
  return edits.reduce((current, edit) => applyEdit(current, edit, locked), source)
}

function applyEdit(source: string, edit: Edit, locked: ReadonlySet<string>): string {
  const scan = scanOrThrow(source)
  const next = editSource(source, scan, edit, locked)
  const after = scanOrThrow(next, "The edit would produce invalid code")
  keepLockedDrawings(source, scan, next, after, locked)
  keepLockedBoardItems(source, scan, next, after, locked)
  return next
}

function editSource(source: string, scan: Scan, edit: Edit, locked: ReadonlySet<string>): string {
  switch (edit.kind) {
    case "setProps":
      return setProps(source, scan, edit.part, edit.props, locked)
    case "removePart":
      return removePart(source, scan, edit.part, locked)
    case "renameParts":
      return renameParts(source, scan, edit, locked)
    case "addTrace":
      return addTrace(source, scan, edit.from, edit.to, edit.props ?? {}, edit.schematicRouteHints, edit.page)
    case "removeTrace":
      return removeTrace(source, scan, edit.from, edit.to, locked)
    case "setTraceHints":
      return setTraceHints(source, scan, edit, locked)
    case "addPart":
      return addPart(source, scan, edit)
    case "addDrawing":
      return addDrawing(source, scan, edit)
    case "removeDrawing":
      return removeDrawing(source, scan, edit.id, locked)
    case "setDrawingProps":
      return setDrawingProps(source, scan, edit, locked)
    case "movePartToPage":
      return movePartToPage(source, scan, requireEditablePart(scan, edit.part, locked), edit.page)
    case "addInstance":
      return addInstance(source, scan, edit)
    case "setConnections":
      return setConnections(source, scan, edit, locked)
    case "addPage":
      return addPage(source, scan, edit.name)
    case "renamePage":
      return renamePage(source, scan, edit.from, edit.to)
    case "removePage":
      return removePage(source, scan, edit.name, locked)
    case "addPour":
      return addPour(source, scan, edit)
    case "setPour":
      return setPour(source, scan, edit, locked)
    case "removePour":
      return removeBoardItem(source, scan, "copperpour", edit.id, locked)
    case "addHole":
      return addHole(source, scan, edit)
    case "setHole":
      return setHole(source, scan, edit, locked)
    case "removeHole":
      return removeBoardItem(source, scan, "hole", edit.id, locked)
    case "renamePort":
      return renamePort(source, scan, edit.from, edit.to)
    case "setSheetSize":
      return setSheetSize(source, scan, edit)
    case "setBoard":
      return setBoard(source, scan, edit)
  }
}

function setProps(
  source: string,
  scan: Scan,
  name: string,
  props: Record<string, PropValue>,
  locked: ReadonlySet<string>,
): string {
  const part = requireEditablePart(scan, name, locked)
  const node = scan.partNodes.get(name)
  if (!node) throw new EditError("not_found", `No part named ${name}`)
  const out = new MagicString(source)
  for (const [key, value] of Object.entries(props)) {
    if (value === null && !REMOVABLE_PROPS.has(key)) throw new EditError("invalid", `${key} cannot be removed with null; only ${[...REMOVABLE_PROPS].join(", ")} can`)
    const formatted = value === null ? null : formattedProp(key, value)
    const attribute = attributeNamed(source, node, key)
    if (attribute && !part.props[key]?.editable) {
      throw new EditError("readonly", `${name}.${key} is an expression (${part.props[key]?.source}) and cannot be edited`)
    }
    if (formatted !== null) putAttribute(out, source, node, key, formatted)
    else if (attribute) {
      const attributes = jsxAttributes(node)
      const before = attributes[attributes.indexOf(attribute) - 1]
      out.remove(before?.end ?? node.openingElement.name.end ?? 0, attribute.end ?? 0)
    }
  }
  return out.toString()
}

const LABEL_PROPS: ReadonlySet<string> = new Set(LABEL_AT_PROPS)
/** Props a null removes: the moved labels' positions, and the no connect flags once the last one goes. */
const REMOVABLE_PROPS: ReadonlySet<string> = new Set([...LABEL_AT_PROPS, NO_CONNECT_PROP])

/** A prop's value as written: a point for a label's position (rounded, as corners are), else a checked literal. */
function formattedProp(key: string, value: Literal | Point): string {
  if (typeof value !== "object") {
    validateOrThrow(key, value)
    return formatLiteral(value)
  }
  if (!LABEL_PROPS.has(key)) throw new EditError("invalid", `${key} must be a string, number or boolean; only ${LABEL_AT_PROPS.join(", ")} take a point`)
  const point = cleanPoint(value)
  if (!point) throw new EditError("invalid", `${key} needs numbers x and y between -${MAX_COORDINATE} and ${MAX_COORDINATE}`)
  return formatPoint(point)
}

/** Removes a part and its traces; refuses when that would touch a locked or read-only element. */
function removePart(source: string, scan: Scan, name: string, locked: ReadonlySet<string>): string {
  const part = requireEditablePart(scan, name, locked)
  const within = (node: { start: number; end: number }) => node.start >= part.start && node.end <= part.end
  const lockedInside = scan.model.parts.find((p) => p !== part && within(p) && locked.has(p.name))
  if (lockedInside) throw new EditError("locked", `${name} contains the locked part ${lockedInside.name}`)

  const connected = scan.model.traces.filter((t) => !within(t) && traceEnds(t).includes(name))
  for (const trace of [...connected, ...scan.model.traces.filter(within)]) {
    const lockedEnd = traceEnds(trace).find((p) => p !== name && locked.has(p))
    if (lockedEnd) throw new EditError("locked", `${name} is connected to the locked part ${lockedEnd}; remove that trace by hand`)
  }
  const readonly = connected.find((t) => !t.editable)
  if (readonly) throw new EditError("readonly", `${name} has a read-only trace on line ${readonly.line}; remove it by hand`)

  // Remove from the end of the file backwards so earlier offsets stay valid.
  const ranges = [part, ...connected].sort((a, b) => b.start - a.start)
  return ranges.reduce((text, range) => removeRange(text, range.start, range.end), source)
}

function traceEnds(trace: { from: string | undefined; to: string | undefined }): string[] {
  return [trace.from, trace.to].flatMap((end) => (end === undefined ? [] : partsInSelector(end)))
}

/** One spelling for a port selector: `.R1 > .pin1` and `R1.pin1` both become `R1.pin1`. */
function samePort(selector: string): string {
  const trimmed = selector.trim()
  const child = /^\.([\w-]+)\s*>\s*\.([\w-]+)$/.exec(trimmed)
  return child ? `${child[1]}.${child[2]}` : trimmed
}

/** Checks hand-drawn corners and rounds them, so the file stays readable. */
function cornersOrThrow(points: unknown): Point[] {
  if (!Array.isArray(points) || points.length > MAX_ROUTE_HINTS) {
    throw new EditError("invalid", `schematicRouteHints must be a list of at most ${MAX_ROUTE_HINTS} points`)
  }
  return points.map((p: unknown) => {
    const corner = cleanPoint(p)
    if (!corner) throw new EditError("invalid", `Each corner in schematicRouteHints needs numbers x and y between -${MAX_COORDINATE} and ${MAX_COORDINATE}`)
    return corner
  })
}

function addTrace(source: string, scan: Scan, from: string, to: string, props: Record<string, Literal>, hints?: Point[], page?: string): string {
  for (const [label, value] of [
    ["from", from],
    ["to", to],
  ] as const) {
    if (typeof value !== "string" || value.trim() === "") throw new EditError("invalid", `${label} must be a selector`)
    const local = localNet(value)
    if (local) throw new EditError("invalid", localNetRefusal(local, sheetFileIn(scan.model, local.instance)))
  }
  for (const [key, value] of Object.entries(props)) {
    if (key === "from" || key === "to" || key === "schematicRouteHints") throw new EditError("invalid", `pass ${key} as its own argument`)
    validateOrThrow(key, value)
  }
  const corners = hints === undefined ? [] : cornersOrThrow(hints)
  const ends = [samePort(from), samePort(to)].sort().join("\0")
  const existing = scan.model.traces.find((t) => t.from !== undefined && t.to !== undefined && [samePort(t.from), samePort(t.to)].sort().join("\0") === ends)
  if (existing) throw new EditError("invalid", `${from} and ${to} are already connected (line ${existing.line})`)
  const extra =
    Object.entries(props)
      .map(([key, value]) => ` ${key}=${formatLiteral(value)}`)
      .join("") + (corners.length > 0 ? ` schematicRouteHints=${formatPointList(corners)}` : "")
  const element = `<trace from=${formatLiteral(from)} to=${formatLiteral(to)}${extra} />`
  if (page !== undefined && page !== MAIN_PAGE) return insertOnPage(source, scan, element, page, "a trace")
  const close = scan.model.boardClose?.start
  if (close === undefined) throw new EditError("invalid", "No <board> element with a closing tag was found")
  const lineStart = source.lastIndexOf("\n", close - 1) + 1
  const indent = source.slice(lineStart, close)
  if (indent.trim() !== "") throw new EditError("invalid", "</board> must be on its own line to add a trace")
  const childIndent = indent + (indent.includes("\t") ? "\t" : "  ")
  return source.slice(0, lineStart) + childIndent + element + lineEnding(source) + source.slice(lineStart)
}

function removeTrace(source: string, scan: Scan, from: string, to: string, locked: ReadonlySet<string>): string {
  const trace = scan.model.traces.find((t) => (t.from === from && t.to === to) || (t.from === to && t.to === from))
  if (!trace) throw new EditError("not_found", `No trace between ${from} and ${to}`)
  if (!trace.editable) throw new EditError("readonly", `The trace on line ${trace.line} is read-only (${trace.readonlyReason})`)
  const lockedEnd = traceEnds(trace).find((p) => locked.has(p))
  if (lockedEnd) throw new EditError("locked", `${lockedEnd} is locked; its traces cannot be removed`)
  return removeRange(source, trace.start, trace.end)
}

/** Sets, replaces or (for an empty list) removes the `schematicRouteHints` of the trace joining `from` and `to`. */
function setTraceHints(
  source: string,
  scan: Scan,
  edit: Extract<Edit, { kind: "setTraceHints" }>,
  locked: ReadonlySet<string>,
): string {
  const { from, to } = edit
  const index = scan.model.traces.findIndex((t) => (t.from === from && t.to === to) || (t.from === to && t.to === from))
  const trace = scan.model.traces[index]
  const node = scan.traceNodes[index]
  if (!trace || !node) throw new EditError("not_found", `No trace between ${from} and ${to}`)
  if (!trace.editable) throw new EditError("readonly", `The trace on line ${trace.line} is read-only (${trace.readonlyReason})`)
  const lockedEnd = traceEnds(trace).find((p) => locked.has(p))
  if (lockedEnd) throw new EditError("locked", `${lockedEnd} is locked; its traces cannot be changed`)
  const corners = cornersOrThrow(edit.schematicRouteHints)
  const attributes = jsxAttributes(node)
  const attribute = attributeNamed(source, node, "schematicRouteHints")
  if (attribute && readPointList(attribute.value) === undefined) {
    throw new EditError("readonly", `The corners of the trace on line ${trace.line} are an expression and cannot be edited`)
  }
  const out = new MagicString(source)
  if (!attribute) {
    if (corners.length > 0) putAttribute(out, source, node, "schematicRouteHints", formatPointList(corners))
  } else if (corners.length === 0) {
    const before = attributes[attributes.indexOf(attribute) - 1]
    out.remove(before?.end ?? node.openingElement.name.end ?? 0, attribute.end ?? 0)
  } else {
    out.overwrite(attribute.value?.start ?? 0, attribute.value?.end ?? 0, formatPointList(corners))
  }
  return out.toString()
}

const TAG = /^[A-Za-z][A-Za-z0-9_]*$/
const MAX_ROUTE_HINTS = 200
const PART_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const RELATIVE_IMPORT = /^\.{1,2}\/[\w./-]+$/

/** Adds a part element before the board's first trace (or before </board>), plus its import. */
function addPart(source: string, scan: Scan, edit: Extract<Edit, { kind: "addPart" }>): string {
  if (!TAG.test(edit.tag)) throw new EditError("invalid", `"${edit.tag}" is not a component name`)
  if (!PART_NAME.test(edit.name)) throw new EditError("invalid", `"${edit.name}" is not a valid part name; use letters, digits and _`)
  if (scan.model.parts.some((p) => p.name === edit.name)) throw new EditError("invalid", `A part named ${edit.name} already exists`)
  // A part would take the name from a drawing and change the drawing's id, so the name must be free of drawings too.
  if (scan.model.drawings.some((d) => d.name === edit.name || d.id === edit.name)) {
    throw new EditError("invalid", `A drawing named ${edit.name} already exists`)
  }
  if (edit.importFrom !== undefined && !RELATIVE_IMPORT.test(edit.importFrom)) {
    throw new EditError("invalid", `"${edit.importFrom}" is not a relative import path`)
  }
  const props = Object.entries(edit.props ?? {}).map(([key, value]) => {
    validateOrThrow(key, value)
    return ` ${key}=${formatLiteral(value)}`
  })
  const eol = lineEnding(source)
  const labels = edit.pinLabels === undefined ? "" : ` pinLabels={${formatPinLabels(edit.pinLabels)}}`
  const element = `<${edit.tag} name=${formatLiteral(edit.name)}${props.join("")}${labels} />`

  const existingImport = scan.model.imports.find((i) => i.local === edit.tag)
  if (edit.importFrom !== undefined && existingImport && existingImport.source !== edit.importFrom) {
    throw new EditError("invalid", `${edit.tag} is already imported from "${existingImport.source}"`)
  }
  const withPart = insertOnPage(source, scan, element, edit.page, "a part", true)

  if (edit.importFrom === undefined || existingImport) return withPart
  const statement = `import { ${edit.tag} } from ${JSON.stringify(edit.importFrom)}`
  const lastImport = scan.model.imports.reduce((end, i) => Math.max(end, i.end), -1)
  return lastImport < 0
    ? statement + eol + withPart
    : withPart.slice(0, lastImport) + eol + statement + withPart.slice(lastImport)
}

const LABEL_KEY = /^pin[1-9][0-9]*$/
const LABEL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * A pin name close to `name` that LABEL_NAME takes. A leading sign goes ("+5V" as "5V"); a supply name puts its volts
 * after the V ("5V" is V5, "3V3" is V3_3); other leading digits move behind the letters ("12ABC" is ABC12); the
 * characters LABEL_NAME refuses become _, and what still starts with a digit gets _ in front.
 */
export function pinLabelSuggestion(name: string): string {
  const unsigned = name.replace(/^[+-]+/, "")
  const volts = /^(\d+)[Vv](\d*)$/.exec(unsigned)
  if (volts) return `V${volts[1]}${volts[2] ? `_${volts[2]}` : ""}`
  const moved = unsigned.replace(/^(\d+)([A-Za-z].*)$/, "$2$1")
  const cleaned = moved.replace(/[^A-Za-z0-9_]/g, "_")
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`
}

/** `{ pin1: "anode", pin2: "cathode" }`; keys are pin1, pin2, ... and names are identifiers, as selectors need. */
function formatPinLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels).map(([key, name]) => {
    if (!LABEL_KEY.test(key)) throw new EditError("invalid", `pinLabels key "${key}" must be pin1, pin2, ...`)
    if (typeof name !== "string") throw new EditError("invalid", `pinLabels name for ${key} must be letters, digits and _, not starting with a digit`)
    if (!LABEL_NAME.test(name)) throw new EditError("invalid", `pinLabels name "${name}" for ${key} must be letters, digits and _, not starting with a digit: use "${pinLabelSuggestion(name)}"`)
    return `${key}: ${JSON.stringify(name)}`
  })
  return `{ ${entries.join(", ")} }`
}

/** The whitespace before `offset` on its line, or undefined when other text precedes it. */
function lineIndent(source: string, offset: number): string | undefined {
  const before = source.slice(source.lastIndexOf("\n", offset - 1) + 1, offset)
  return before.trim() === "" ? before : undefined
}

function requireEditablePart(scan: Scan, name: string, locked: ReadonlySet<string>): PartInfo {
  const part = scan.model.parts.find((p) => p.name === name)
  if (!part) throw new EditError("not_found", `No part named ${name}`)
  if (locked.has(name)) throw new EditError("locked", `${name} is locked; ask the human to unlock it`)
  if (!part.editable) throw new EditError("readonly", `${name} is read-only (${part.readonlyReason})`)
  return part
}

function scanOrThrow(source: string, context?: string): Scan {
  try {
    return scanCircuit(source)
  } catch (error) {
    throw new EditError("parse", context ? `${context}: ${(error as Error).message}` : (error as Error).message)
  }
}
