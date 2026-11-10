// Edits of schematic pages: `<page name="Power">…</page>` around parts, traces and drawings. Pages are drawing only,
// so moving a part between pages changes no net; everything keeps its written position.
import MagicString from "magic-string"
import { MAIN_PAGE } from "../engine/model.js"
import { scanCircuit, type Scan } from "./analyze.js"
import { EditError } from "./edit-error.js"
import { attributeNamed, insertInBoard, lineEnding, lineIndent, removeRange } from "./edit-text.js"
import { formatLiteral } from "./literals.js"
import { partsInSelector } from "./selectors.js"
import type { PageInfo, PartInfo, TraceInfo } from "./types.js"

/** Letters, digits, spaces, _ and -, up to 32 characters, starting with a letter or digit. */
const PAGE_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9 _-]{0,30}[A-Za-z0-9_-])?$/

const isMain = (page: string | undefined): boolean => page === undefined || page === MAIN_PAGE
const pageOfThing = (thing: { page?: string }): string => thing.page ?? MAIN_PAGE

export function checkPageName(name: unknown): string {
  if (typeof name !== "string" || !PAGE_NAME.test(name)) {
    throw new EditError("invalid", `"${String(name)}" is not a page name; use up to 32 letters, digits, spaces, _ and -`)
  }
  return name
}

const pagesNamed = (scan: Scan, name: string): { info: PageInfo; index: number }[] =>
  (scan.model.pages ?? []).flatMap((info, index) => (info.name === name ? [{ info, index }] : []))

/** The indent one level inside an element whose line starts with `indent`. */
const deeper = (indent: string): string => indent + (indent.includes("\t") ? "\t" : "  ")

function pageText(name: string, inner: string | undefined, indent: string, eol: string): string {
  const open = `${indent}<page name=${formatLiteral(name)}>${eol}`
  const child = inner === undefined ? "" : `${deeper(indent)}${inner}${eol}`
  return `${open}${child}${indent}</page>${eol}`
}

/** Puts a new `<page>` (holding `inner`, when given) on its own lines at the end of the board. */
function newPage(source: string, scan: Scan, name: string, inner: string | undefined): string {
  const close = scan.model.boardClose?.start
  if (close === undefined) throw new EditError("invalid", "No <board> element with a closing tag was found")
  const indent = lineIndent(source, close)
  if (indent === undefined) throw new EditError("invalid", "</board> must be on its own line to add a page")
  const lineStart = close - indent.length
  return source.slice(0, lineStart) + pageText(name, inner, deeper(indent), lineEnding(source)) + source.slice(lineStart)
}

/**
 * Puts an element on its own line in page `page`: a part before the page's first trace, anything else before
 * `</page>`. The first page, Main, is the board itself; a page that is not written yet is made at the end of the board.
 */
export function insertOnPage(source: string, scan: Scan, element: string, page: string | undefined, what: string, first = false): string {
  if (isMain(page)) return insertInBoard(source, scan, element, what)
  const name = checkPageName(page)
  const found = pagesNamed(scan, name)
  const open = [...found].reverse().find(({ info }) => info.closeStart !== undefined)
  if (open) return insertInOpenPage(source, scan, open.info, element, what, first)
  const closed = found[found.length - 1]
  if (!closed) return newPage(source, scan, name, element)
  const indent = lineIndent(source, closed.info.start)
  if (indent === undefined) throw new EditError("invalid", `<page name="${name}" /> must be on its own line to add ${what}`)
  const eol = lineEnding(source)
  const text = pageText(name, element, indent, eol)
  return source.slice(0, closed.info.start - indent.length) + text.slice(0, -eol.length) + source.slice(closed.info.end)
}

function insertInOpenPage(source: string, scan: Scan, page: PageInfo, element: string, what: string, first: boolean): string {
  const inside = (t: TraceInfo) => t.parent === "page" && t.start > page.start && t.end < page.end && lineIndent(source, t.start) !== undefined
  const firstTrace = first ? scan.model.traces.find(inside) : undefined
  const anchor = firstTrace?.start ?? (page.closeStart as number)
  const indent = lineIndent(source, anchor)
  if (indent === undefined) throw new EditError("invalid", `</page> must be on its own line to add ${what}`)
  const childIndent = firstTrace ? indent : deeper(indent)
  const lineStart = anchor - indent.length
  return source.slice(0, lineStart) + childIndent + element + lineEnding(source) + source.slice(lineStart)
}

function traceEnds(trace: TraceInfo): string[] {
  return [trace.from, trace.to].flatMap((end) => (end === undefined ? [] : partsInSelector(end)))
}

/** The traces that carry a part's hand-drawn wires: the ones with corners that reach it, outside the part itself. */
function handDrawnTraces(scan: Scan, part: PartInfo): TraceInfo[] {
  return scan.model.traces.filter((t) => t.schematicRouteHints !== undefined && (t.start >= part.end || t.end <= part.start) && traceEnds(t).includes(part.name))
}

/** Moves a part and its hand-drawn wires onto a page. The text of each element moves as it is written. */
export function movePartToPage(source: string, scan: Scan, part: PartInfo, page: string): string {
  const target = isMain(page) ? MAIN_PAGE : checkPageName(page)
  if (pageOfThing(part) === target) throw new EditError("invalid", `${part.name} is already on page ${target}`)
  if (part.parent !== "board" && part.parent !== "page") {
    throw new EditError("readonly", `${part.name} is inside a <${part.parent ?? "?"}>; move what holds it instead`)
  }
  const traces = handDrawnTraces(scan, part)
  const stuck = traces.find((t) => !t.editable || (t.parent !== "board" && t.parent !== "page"))
  if (stuck) throw new EditError("readonly", `${part.name} has a hand-drawn trace on line ${stuck.line} that cannot be moved; move it by hand`)
  const texts = [part, ...traces].map((range) => source.slice(range.start, range.end))
  const removed = [part, ...traces].sort((a, b) => b.start - a.start).reduce((text, range) => removeRange(text, range.start, range.end), source)
  return texts.reduce((text, element, index) => insertOnPage(text, scanCircuit(text), element, target, index === 0 ? "a part" : "a trace", index === 0), removed)
}

export function addPage(source: string, scan: Scan, name: string): string {
  const page = checkPageName(name)
  if (page === MAIN_PAGE || pagesNamed(scan, page).length > 0) throw new EditError("invalid", `There is already a page named ${page}`)
  return newPage(source, scan, page, undefined)
}

function writtenPage(scan: Scan, name: string, verb: string): { info: PageInfo; index: number }[] {
  if (name === MAIN_PAGE) throw new EditError("invalid", `The first page, ${MAIN_PAGE}, is the board itself and cannot be ${verb}`)
  const found = pagesNamed(scan, name)
  if (found.length === 0) throw new EditError("not_found", `No page named ${name}`)
  return found
}

export function renamePage(source: string, scan: Scan, from: string, to: string): string {
  const found = writtenPage(scan, from, "renamed")
  const name = checkPageName(to)
  if (name === MAIN_PAGE || pagesNamed(scan, name).length > 0) throw new EditError("invalid", `There is already a page named ${name}`)
  const out = new MagicString(source)
  for (const { index } of found) {
    const node = scan.pageNodes[index]
    const value = node ? attributeNamed(source, node, "name")?.value : undefined
    if (value) out.overwrite(value.start ?? 0, value.end ?? 0, formatLiteral(name))
  }
  return out.toString()
}

/** Removes a page with what it holds; refused while a part is on it or a locked drawing is in it. */
export function removePage(source: string, scan: Scan, name: string, locked: ReadonlySet<string>): string {
  const found = writtenPage(scan, name, "removed")
  const parts = scan.model.parts.filter((p) => p.page === name).map((p) => p.name)
  if (parts.length > 0) throw new EditError("invalid", `Page ${name} still has parts (${parts.join(", ")}); move or remove them first`)
  const lockedDrawing = scan.model.drawings.find((d) => d.page === name && locked.has(d.id))
  if (lockedDrawing) throw new EditError("locked", `Page ${name} holds the locked drawing ${lockedDrawing.id}`)
  return found
    .map(({ info }) => info)
    .sort((a, b) => b.start - a.start)
    .reduce((text, info) => removeRange(text, info.start, info.end), source)
}
