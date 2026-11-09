import MagicString from "magic-string"
import { scanCircuit, type Scan } from "./analyze.js"
import { addDrawing, keepLockedDrawings, removeDrawing, setDrawingProps } from "./drawing-edits.js"
import { EditError } from "./edit-error.js"
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
import { formatLiteral, formatPointList, readPointList } from "./literals.js"
import { partsInSelector } from "./selectors.js"
import type { Edit, Literal, PartInfo, Point } from "./types.js"

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
  return next
}

function editSource(source: string, scan: Scan, edit: Edit, locked: ReadonlySet<string>): string {
  switch (edit.kind) {
    case "setProps":
      return setProps(source, scan, edit.part, edit.props, locked)
    case "removePart":
      return removePart(source, scan, edit.part, locked)
    case "addTrace":
      return addTrace(source, scan, edit.from, edit.to, edit.props ?? {}, edit.schematicRouteHints)
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
  }
}

function setProps(
  source: string,
  scan: Scan,
  name: string,
  props: Record<string, Literal>,
  locked: ReadonlySet<string>,
): string {
  const part = requireEditablePart(scan, name, locked)
  const node = scan.partNodes.get(name)
  if (!node) throw new EditError("not_found", `No part named ${name}`)
  const out = new MagicString(source)
  for (const [key, value] of Object.entries(props)) {
    validateOrThrow(key, value)
    if (attributeNamed(source, node, key) && !part.props[key]?.editable) {
      throw new EditError("readonly", `${name}.${key} is an expression (${part.props[key]?.source}) and cannot be edited`)
    }
    putAttribute(out, source, node, key, formatLiteral(value))
  }
  return out.toString()
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

function addTrace(source: string, scan: Scan, from: string, to: string, props: Record<string, Literal>, hints?: Point[]): string {
  for (const [label, value] of [
    ["from", from],
    ["to", to],
  ] as const) {
    if (typeof value !== "string" || value.trim() === "") throw new EditError("invalid", `${label} must be a selector`)
  }
  for (const [key, value] of Object.entries(props)) {
    if (key === "from" || key === "to" || key === "schematicRouteHints") throw new EditError("invalid", `pass ${key} as its own argument`)
    validateOrThrow(key, value)
  }
  const corners = hints === undefined ? [] : cornersOrThrow(hints)
  const ends = [samePort(from), samePort(to)].sort().join("\0")
  const existing = scan.model.traces.find((t) => t.from !== undefined && t.to !== undefined && [samePort(t.from), samePort(t.to)].sort().join("\0") === ends)
  if (existing) throw new EditError("invalid", `${from} and ${to} are already connected (line ${existing.line})`)
  const close = scan.model.boardClose?.start
  if (close === undefined) throw new EditError("invalid", "No <board> element with a closing tag was found")
  const lineStart = source.lastIndexOf("\n", close - 1) + 1
  const indent = source.slice(lineStart, close)
  if (indent.trim() !== "") throw new EditError("invalid", "</board> must be on its own line to add a trace")
  const extra =
    Object.entries(props)
      .map(([key, value]) => ` ${key}=${formatLiteral(value)}`)
      .join("") + (corners.length > 0 ? ` schematicRouteHints=${formatPointList(corners)}` : "")
  const childIndent = indent + (indent.includes("\t") ? "\t" : "  ")
  const element = `${childIndent}<trace from=${formatLiteral(from)} to=${formatLiteral(to)}${extra} />${lineEnding(source)}`
  return source.slice(0, lineStart) + element + source.slice(lineStart)
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
  const withPart = insertInBoard(source, scan, element, "a part")

  if (edit.importFrom === undefined || existingImport) return withPart
  const statement = `import { ${edit.tag} } from ${JSON.stringify(edit.importFrom)}`
  const lastImport = scan.model.imports.reduce((end, i) => Math.max(end, i.end), -1)
  return lastImport < 0
    ? statement + eol + withPart
    : withPart.slice(0, lastImport) + eol + statement + withPart.slice(lastImport)
}

const LABEL_KEY = /^pin[1-9][0-9]*$/
const LABEL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** `{ pin1: "cathode", pin2: "anode" }`; keys are pin1, pin2, ... and names are identifiers, as selectors need. */
function formatPinLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels).map(([key, name]) => {
    if (!LABEL_KEY.test(key)) throw new EditError("invalid", `pinLabels key "${key}" must be pin1, pin2, ...`)
    if (typeof name !== "string" || !LABEL_NAME.test(name)) throw new EditError("invalid", `pinLabels name for ${key} must be letters, digits and _, not starting with a digit`)
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
