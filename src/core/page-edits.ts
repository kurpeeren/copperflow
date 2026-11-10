// Edits of schematic pages: `<page name="Power">…</page>` around parts, traces and drawings. Pages are drawing only,
// so moving a part between pages changes no net; everything keeps its written position.
import MagicString from "magic-string"
import { MAIN_PAGE } from "../engine/model.js"
import { scanCircuit, type Scan } from "./analyze.js"
import { EditError } from "./edit-error.js"
import { atTop, attributeNamed, insertInBoard, lineEnding, lineIndent, removeRange } from "./edit-text.js"
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

const outside = (t: TraceInfo, part: PartInfo): boolean => t.start >= part.end || t.end <= part.start

/** A trace that reaches only this part: its pins to nets, or two of its own pins. */
const onlyItsOwn = (t: TraceInfo, part: PartInfo): boolean => {
  const ends = traceEnds(t)
  return ends.length > 0 && ends.every((end) => end === part.name)
}

/** The traces that move with a part: its hand-drawn wires, and every trace that reaches only it. */
function tracesThatMove(scan: Scan, part: PartInfo): TraceInfo[] {
  return scan.model.traces.filter((t) => outside(t, part) && traceEnds(t).includes(part.name) && (t.schematicRouteHints !== undefined || onlyItsOwn(t, part)))
}

const endText = (end: string | undefined): string => (end ?? "?").replace(/^net\./, "")
const traceText = (t: TraceInfo): string => `${endText(t.from)} to ${endText(t.to)}`

/**
 * What a move leaves behind, for the answer to the person or agent: the traces from the part to other parts stay
 * where they are written. Undefined when nothing stays.
 */
export function movePartNote(scan: Scan, name: string, page: string): string | undefined {
  const part = scan.model.parts.find((p) => p.name === name)
  if (!part) return undefined
  const moving = new Set(tracesThatMove(scan, part))
  const staying = scan.model.traces.filter((t) => outside(t, part) && traceEnds(t).includes(name) && !moving.has(t))
  if (staying.length === 0) return undefined
  const crossing = staying.some((t) => traceEnds(t).some((end) => end !== name && (scan.model.parts.find((p) => p.name === end)?.page ?? MAIN_PAGE) !== (isMain(page) ? MAIN_PAGE : page)))
  const list = staying.map(traceText).join(", ")
  const verb = staying.length === 1 ? "stays where it is written" : "stay where they are written"
  return `${list} ${verb}${crossing ? `; ${staying.length === 1 ? "it joins" : "they join"} pins on two pages and ${staying.length === 1 ? "is" : "are"} not drawn` : ""}`
}

/**
 * Moves a part onto a page with its hand-drawn wires and the traces that reach only it; a trace to another part stays
 * (movePartNote says which). The text of each element moves as it is written.
 */
export function movePartToPage(source: string, scan: Scan, part: PartInfo, page: string): string {
  const target = isMain(page) ? MAIN_PAGE : checkPageName(page)
  if (pageOfThing(part) === target) throw new EditError("invalid", `${part.name} is already on page ${target}`)
  if (!atTop(part.parent) && part.parent !== "page") {
    throw new EditError("readonly", `${part.name} is inside a <${part.parent ?? "?"}>; move what holds it instead`)
  }
  const traces = tracesThatMove(scan, part)
  const stuck = traces.find((t) => !t.editable || (!atTop(t.parent) && t.parent !== "page"))
  if (stuck) throw new EditError("readonly", `${part.name} has a trace on line ${stuck.line} that cannot be moved; move it by hand`)
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

const lineOf = (source: string, offset: number): number => source.slice(0, offset).split("\n").length

/** Elements in the page that the scan skipped, such as parts with computed names: the file alone cannot tell what they are. */
function unnamedIn(source: string, scan: Scan, pages: readonly PageInfo[]): number[] {
  const ranges = pages.map((info) => [lineOf(source, info.start), lineOf(source, info.end)] as const)
  return scan.model.skipped.filter((s) => ranges.some(([from, to]) => s.line >= from && s.line <= to)).map((s) => s.line)
}

/**
 * Removes a page with the drawings it holds. Refused while a part or a trace is on it (a trace removed with the page
 * would take a pin off its net), while it holds something the file alone cannot name, or a locked drawing.
 */
export function removePage(source: string, scan: Scan, name: string, locked: ReadonlySet<string>): string {
  const found = writtenPage(scan, name, "removed")
  const parts = scan.model.parts.filter((p) => p.page === name).map((p) => p.name)
  if (parts.length > 0) throw new EditError("invalid", `Page ${name} still has parts (${parts.join(", ")}); move or remove them first`)
  const pages = found.map(({ info }) => info)
  const unnamed = unnamedIn(source, scan, pages)
  if (unnamed.length > 0) throw new EditError("invalid", `Page ${name} holds elements the file alone cannot name (line ${unnamed.join(", ")}); remove them by hand first`)
  const traces = scan.model.traces.filter((t) => t.page === name)
  if (traces.length > 0) {
    const count = traces.length === 1 ? "1 trace" : `${traces.length} traces`
    throw new EditError("invalid", `${name} still has ${count}: ${traces.map(traceText).join(", ")}; move or remove ${traces.length === 1 ? "it" : "them"} first`)
  }
  const lockedDrawing = scan.model.drawings.find((d) => d.page === name && locked.has(d.id))
  if (lockedDrawing) throw new EditError("locked", `Page ${name} holds the locked drawing ${lockedDrawing.id}`)
  return pages.sort((a, b) => b.start - a.start).reduce((text, info) => removeRange(text, info.start, info.end), source)
}
