import MagicString from "magic-string"
import type { JSXAttribute, JSXElement } from "@babel/types"
import { scanCircuit, type Scan } from "./analyze.js"
import { formatLiteral, validateProp } from "./literals.js"
import { partsInSelector } from "./selectors.js"
import type { Edit, Literal, PartInfo } from "./types.js"

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
      next = addTrace(source, scan, edit.from, edit.to, edit.props ?? {})
      break
    case "removeTrace":
      next = removeTrace(source, scan, edit.from, edit.to, locked)
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

function addTrace(source: string, scan: Scan, from: string, to: string, props: Record<string, Literal>): string {
  for (const [label, value] of [
    ["from", from],
    ["to", to],
  ] as const) {
    if (typeof value !== "string" || value.trim() === "") throw new EditError("invalid", `${label} must be a selector`)
  }
  for (const [key, value] of Object.entries(props)) {
    if (key === "from" || key === "to") throw new EditError("invalid", `pass ${key} as its own argument`)
    validateOrThrow(key, value)
  }
  const close = scan.model.boardClose?.start
  if (close === undefined) throw new EditError("invalid", "No <board> element with a closing tag was found")
  const lineStart = source.lastIndexOf("\n", close - 1) + 1
  const indent = source.slice(lineStart, close)
  if (indent.trim() !== "") throw new EditError("invalid", "</board> must be on its own line to add a trace")
  const extra = Object.entries(props)
    .map(([key, value]) => ` ${key}=${formatLiteral(value)}`)
    .join("")
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
