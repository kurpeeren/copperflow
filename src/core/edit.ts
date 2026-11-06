import MagicString from "magic-string"
import type { JSXAttribute, JSXElement } from "@babel/types"
import { scanCircuit, type Scan } from "./analyze.js"
import { formatLiteral, formatPointList, readPointList, validateProp } from "./literals.js"
import { partsInSelector } from "./selectors.js"
import type { Edit, Literal, PartInfo, Point } from "./types.js"

export type EditErrorCode = "not_found" | "locked" | "readonly" | "invalid" | "parse"

export class EditError extends Error {
  constructor(
    readonly code: EditErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "EditError"
  }
}

/**
 * Applies edits in order and returns the new source. Only the edited spans change.
 * Throws EditError when an edit touches a locked or read-only part or breaks the code.
 */
export function applyEdits(source: string, edits: Edit[], locked: ReadonlySet<string>): string {
  return edits.reduce((current, edit) => applyEdit(current, edit, locked), source)
}

function applyEdit(source: string, edit: Edit, locked: ReadonlySet<string>): string {
  const scan = scanOrThrow(source)
  let next: string
  switch (edit.kind) {
    case "setProps":
      next = setProps(source, scan, edit.part, edit.props, locked)
      break
    case "removePart":
      next = removePart(source, scan, edit.part, locked)
      break
    case "addTrace":
      next = addTrace(source, scan, edit.from, edit.to, edit.props ?? {}, edit.schematicRouteHints)
      break
    case "removeTrace":
      next = removeTrace(source, scan, edit.from, edit.to, locked)
      break
    case "setTraceHints":
      next = setTraceHints(source, scan, edit, locked)
      break
    case "addPart":
      next = addPart(source, scan, edit)
      break
  }
  scanOrThrow(next, "The edit would produce invalid code")
  return next
}

function setProps(
  source: string,
  scan: Scan,
  name: string,
  props: Record<string, Literal>,
  locked: ReadonlySet<string>,
): string {
  const part = requireEditablePart(scan, name, locked)
  const node = scan.partNodes.get(name) as JSXElement
  const attributes = node.openingElement.attributes.filter((a): a is JSXAttribute => a.type === "JSXAttribute")
  const out = new MagicString(source)
  for (const [key, value] of Object.entries(props)) {
    validateOrThrow(key, value)
    const attribute = attributes.find((a) => source.slice(a.name.start ?? 0, a.name.end ?? 0) === key)
    if (!attribute) {
      const last = attributes[attributes.length - 1] as JSXAttribute
      out.appendLeft(last.end ?? 0, `${attributeSeparator(source, node, last)}${key}=${formatLiteral(value)}`)
    } else if (!part.props[key]?.editable) {
      throw new EditError("readonly", `${name}.${key} is an expression (${part.props[key]?.source}) and cannot be edited`)
    } else if (attribute.value) {
      out.overwrite(attribute.value.start ?? 0, attribute.value.end ?? 0, formatLiteral(value))
    } else {
      out.appendLeft(attribute.end ?? 0, `=${formatLiteral(value)}`)
    }
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
    const { x, y } = (p ?? {}) as { x?: unknown; y?: unknown }
    const inRange = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_COORDINATE
    if (!inRange(x) || !inRange(y)) {
      throw new EditError("invalid", `Each corner in schematicRouteHints needs numbers x and y between -${MAX_COORDINATE} and ${MAX_COORDINATE}`)
    }
    return { x: roundCoordinate(x), y: roundCoordinate(y) }
  })
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000 || 0
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
  const attributes = node.openingElement.attributes.filter((a): a is JSXAttribute => a.type === "JSXAttribute")
  const attribute = attributes.find((a) => source.slice(a.name.start ?? 0, a.name.end ?? 0) === "schematicRouteHints")
  if (attribute && readPointList(attribute.value) === undefined) {
    throw new EditError("readonly", `The corners of the trace on line ${trace.line} are an expression and cannot be edited`)
  }
  const out = new MagicString(source)
  if (!attribute) {
    const last = attributes[attributes.length - 1] as JSXAttribute
    if (corners.length > 0) out.appendLeft(last.end ?? 0, `${attributeSeparator(source, node, last)}schematicRouteHints=${formatPointList(corners)}`)
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
// Far beyond any sheet; keeps rounding and formatting exact.
const MAX_COORDINATE = 1_000_000
const PART_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const RELATIVE_IMPORT = /^\.{1,2}\/[\w./-]+$/

/** Adds a part element before the board's first trace (or before </board>), plus its import. */
function addPart(source: string, scan: Scan, edit: Extract<Edit, { kind: "addPart" }>): string {
  if (!TAG.test(edit.tag)) throw new EditError("invalid", `"${edit.tag}" is not a component name`)
  if (!PART_NAME.test(edit.name)) throw new EditError("invalid", `"${edit.name}" is not a valid part name; use letters, digits and _`)
  if (scan.model.parts.some((p) => p.name === edit.name)) throw new EditError("invalid", `A part named ${edit.name} already exists`)
  if (edit.importFrom !== undefined && !RELATIVE_IMPORT.test(edit.importFrom)) {
    throw new EditError("invalid", `"${edit.importFrom}" is not a relative import path`)
  }
  const props = Object.entries(edit.props ?? {}).map(([key, value]) => {
    validateOrThrow(key, value)
    return ` ${key}=${formatLiteral(value)}`
  })
  const eol = lineEnding(source)
  const element = `<${edit.tag} name=${formatLiteral(edit.name)}${props.join("")} />`

  const existingImport = scan.model.imports.find((i) => i.local === edit.tag)
  if (edit.importFrom !== undefined && existingImport && existingImport.source !== edit.importFrom) {
    throw new EditError("invalid", `${edit.tag} is already imported from "${existingImport.source}"`)
  }
  // Anchor on the board's own traces, so the part never lands inside a group.
  const firstTrace = scan.model.traces.find((t) => t.parent === "board" && lineIndent(source, t.start) !== undefined)
  const anchor = firstTrace ? firstTrace.start : scan.model.boardClose?.start
  if (anchor === undefined) throw new EditError("invalid", "No <board> element with a closing tag was found")
  const indent = lineIndent(source, anchor)
  if (indent === undefined) throw new EditError("invalid", "</board> must be on its own line to add a part")
  const childIndent = anchor === firstTrace?.start ? indent : indent + (indent.includes("\t") ? "\t" : "  ")
  const lineStart = anchor - indent.length
  const withPart = source.slice(0, lineStart) + childIndent + element + eol + source.slice(lineStart)

  if (edit.importFrom === undefined || existingImport) return withPart
  const statement = `import { ${edit.tag} } from ${JSON.stringify(edit.importFrom)}`
  const lastImport = scan.model.imports.reduce((end, i) => Math.max(end, i.end), -1)
  return lastImport < 0
    ? statement + eol + withPart
    : withPart.slice(0, lastImport) + eol + statement + withPart.slice(lastImport)
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

/** Removes [start, end) and, when the element fills its lines, the whole lines. */
function removeRange(source: string, start: number, end: number): string {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1
  const newline = source.indexOf("\n", end)
  const lineEnd = newline === -1 ? source.length : newline + 1
  const fillsLines = source.slice(lineStart, start).trim() === "" && source.slice(end, lineEnd).trim() === ""
  return fillsLines ? source.slice(0, lineStart) + source.slice(lineEnd) : source.slice(0, start) + source.slice(end)
}

/** A space for one-line elements, or a newline with the attribute's indent for multi-line ones. */
function attributeSeparator(source: string, node: JSXElement, last: JSXAttribute): string {
  const lastLine = last.loc?.start.line ?? 0
  const tagLine = node.openingElement.loc?.start.line ?? 0
  if (lastLine === tagLine) return " "
  const lineStart = source.lastIndexOf("\n", (last.start ?? 0) - 1) + 1
  return `${lineEnding(source)}${source.slice(lineStart, last.start ?? 0)}`
}

function lineEnding(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n"
}

function validateOrThrow(key: string, value: unknown): void {
  try {
    validateProp(key, value)
  } catch (error) {
    throw new EditError("invalid", (error as Error).message)
  }
}

function scanOrThrow(source: string, context?: string): Scan {
  try {
    return scanCircuit(source)
  } catch (error) {
    throw new EditError("parse", context ? `${context}: ${(error as Error).message}` : (error as Error).message)
  }
}
