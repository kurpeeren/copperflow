// Source text helpers shared by the part, trace and drawing edits.
import type MagicString from "magic-string"
import type { JSXAttribute, JSXElement } from "@babel/types"
import type { Scan } from "./analyze.js"
import { EditError } from "./edit-error.js"
import { validateProp } from "./literals.js"
import type { Point } from "./types.js"

// Far beyond any sheet; keeps rounding and formatting exact.
export const MAX_COORDINATE = 1_000_000

/** A point with numbers x and y within ±MAX_COORDINATE, rounded so the file stays readable; undefined for anything else. */
export function cleanPoint(point: unknown): Point | undefined {
  const { x, y } = (point ?? {}) as { x?: unknown; y?: unknown }
  const inRange = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_COORDINATE
  return inRange(x) && inRange(y) ? { x: roundCoordinate(x), y: roundCoordinate(y) } : undefined
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000 || 0
}

export function jsxAttributes(node: JSXElement): JSXAttribute[] {
  return node.openingElement.attributes.filter((a): a is JSXAttribute => a.type === "JSXAttribute")
}

export function attributeNamed(source: string, node: JSXElement, key: string): JSXAttribute | undefined {
  return jsxAttributes(node).find((a) => source.slice(a.name.start ?? 0, a.name.end ?? 0) === key)
}

/** Sets `key` to an already formatted value: replaces the value, gives a bare attribute one, or adds the attribute after the last. */
export function putAttribute(out: MagicString, source: string, node: JSXElement, key: string, formatted: string): void {
  const attribute = attributeNamed(source, node, key)
  if (attribute?.value) {
    out.overwrite(attribute.value.start ?? 0, attribute.value.end ?? 0, formatted)
  } else if (attribute) {
    out.appendLeft(attribute.end ?? 0, `=${formatted}`)
  } else {
    const attributes = jsxAttributes(node)
    const last = attributes[attributes.length - 1]
    const separator = last ? attributeSeparator(source, node, last) : " "
    out.appendLeft(last?.end ?? node.openingElement.name.end ?? 0, `${separator}${key}=${formatted}`)
  }
}

/** Puts an element on its own line before the board's first trace (or before </board>), never inside a group. */
export function insertInBoard(source: string, scan: Scan, element: string, what: string): string {
  const { lineStart, indent } = boardInsertion(source, scan, what)
  return source.slice(0, lineStart) + indent + element + lineEnding(source) + source.slice(lineStart)
}

/** The line a new element goes before (the board's first trace, or </board>) and the indent it takes there. */
export function boardInsertion(source: string, scan: Scan, what: string): { lineStart: number; indent: string } {
  // Anchor on the board's own traces, so the element never lands inside a group.
  const firstTrace = scan.model.traces.find((t) => t.parent === "board" && lineIndent(source, t.start) !== undefined)
  const anchor = firstTrace ? firstTrace.start : scan.model.boardClose?.start
  if (anchor === undefined) throw new EditError("invalid", "No <board> element with a closing tag was found")
  const indent = lineIndent(source, anchor)
  if (indent === undefined) throw new EditError("invalid", `</board> must be on its own line to add ${what}`)
  const childIndent = anchor === firstTrace?.start ? indent : indent + (indent.includes("\t") ? "\t" : "  ")
  return { lineStart: anchor - indent.length, indent: childIndent }
}

/** The whitespace before `offset` on its line, or undefined when other text precedes it. */
export function lineIndent(source: string, offset: number): string | undefined {
  const before = source.slice(source.lastIndexOf("\n", offset - 1) + 1, offset)
  return before.trim() === "" ? before : undefined
}

/** Removes [start, end) and, when the element fills its lines, the whole lines. */
export function removeRange(source: string, start: number, end: number): string {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1
  const newline = source.indexOf("\n", end)
  const lineEnd = newline === -1 ? source.length : newline + 1
  const fillsLines = source.slice(lineStart, start).trim() === "" && source.slice(end, lineEnd).trim() === ""
  return fillsLines ? source.slice(0, lineStart) + source.slice(lineEnd) : source.slice(0, start) + source.slice(end)
}

/** A space for one-line elements, or a newline with the attribute's indent for multi-line ones. */
export function attributeSeparator(source: string, node: JSXElement, last: JSXAttribute): string {
  const lastLine = last.loc?.start.line ?? 0
  const tagLine = node.openingElement.loc?.start.line ?? 0
  if (lastLine === tagLine) return " "
  const lineStart = source.lastIndexOf("\n", (last.start ?? 0) - 1) + 1
  return `${lineEnding(source)}${source.slice(lineStart, last.start ?? 0)}`
}

export function lineEnding(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n"
}

export function validateOrThrow(key: string, value: unknown): void {
  try {
    validateProp(key, value)
  } catch (error) {
    throw new EditError("invalid", (error as Error).message)
  }
}
