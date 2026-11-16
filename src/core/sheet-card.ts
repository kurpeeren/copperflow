// A sheet's card: what `<sheet does sources>` says it does and where it comes from, and each `<port type carries>`.
// Read from the file's text without building it, written by describe_sheet, and shown by the summaries and the shelf.
import type { JSXElement } from "@babel/types"
import MagicString from "magic-string"
import { CARD_LIMITS, PORT_TYPES } from "../engine/sheet-ports.js"
import type { PinType } from "../engine/model.js"
import { scanCircuit, type Scan } from "./analyze.js"
import { EditError } from "./edit-error.js"
import { attributeNamed, putAttribute } from "./edit-text.js"
import { formatLiteral } from "./literals.js"

export { CARD_LIMITS, PORT_TYPES }

export interface CardPort {
  name: string
  type?: PinType
  carries?: string
}

export interface SheetCardText {
  does?: string
  sources?: string[]
  ports: CardPort[]
}

/** What describe_sheet changes: a value sets, null removes, absent keeps. */
export interface CardChange {
  does?: string | null
  sources?: string[] | null
  ports?: Record<string, { type?: string | null; carries?: string | null }>
}

const textProp = (scan: Scan, part: string, key: string): string | undefined => {
  const value = scan.model.parts.find((p) => p.name === part && p.tag === "port")?.props[key]?.literal
  return typeof value === "string" ? value : undefined
}

/** A `sources={["…", "…"]}` written as a list of plain texts, or undefined. */
function readSources(source: string, node: JSXElement): string[] | undefined {
  const value = attributeNamed(source, node, "sources")?.value
  if (value?.type !== "JSXExpressionContainer" || value.expression.type !== "ArrayExpression") return undefined
  const items = value.expression.elements.map((item) => (item?.type === "StringLiteral" ? item.value : undefined))
  return items.every((item): item is string => item !== undefined) ? items : undefined
}

function readDoes(source: string, node: JSXElement): string | undefined {
  const value = attributeNamed(source, node, "does")?.value
  if (value?.type === "StringLiteral") return value.value
  if (value?.type === "JSXExpressionContainer" && value.expression.type === "StringLiteral") return value.expression.value
  return undefined
}

/** The card a sheet file's text writes; a sheet without one has only its ports. */
export function readCard(text: string, scan: Scan = scanCircuit(text)): SheetCardText {
  const names = [...new Set(scan.model.parts.filter((part) => part.tag === "port").map((part) => part.name))]
  const ports = names.map((name): CardPort => {
    const type = textProp(scan, name, "type")
    const carries = textProp(scan, name, "carries")
    return { name, ...(type && (PORT_TYPES as readonly string[]).includes(type) ? { type: type as PinType } : {}), ...(carries ? { carries } : {}) }
  })
  const node = scan.sheetNode
  const does = node ? readDoes(text, node) : undefined
  const sources = node ? readSources(text, node) : undefined
  return { ...(does ? { does } : {}), ...(sources && sources.length > 0 ? { sources } : {}), ports }
}

/** What a card lacks before it can go on the shelf: `does`, and a port with neither a type nor what it carries. */
export function cardGaps(card: SheetCardText): string[] {
  const gaps = card.does ? [] : ["does"]
  for (const port of card.ports) if (!port.type && !port.carries) gaps.push(`port ${port.name}`)
  return gaps
}

/** `IN (input, 0 to 24 V from the field)`, `GND (ground)`, `AUX`. */
export function portText(port: CardPort): string {
  const about = [port.type, port.carries].filter(Boolean).join(", ")
  return about === "" ? port.name : `${port.name} (${about})`
}

/** The card as summary lines: what it does, its sources, then one line a port. */
export function cardLines(card: SheetCardText): string[] {
  return [
    `Does: ${card.does ?? "(not written; describe_sheet)"}`,
    ...(card.sources ? [`Sources: ${card.sources.join("; ")}`] : []),
    ...card.ports.map((port) => `  port ${portText(port)}`),
  ]
}

function checkText(value: unknown, limit: number, what: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > limit || /[\r\n]/.test(value)) {
    throw new EditError("invalid", `${what} must be one line of text, at most ${limit} characters`)
  }
  return value
}

function checkSources(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > CARD_LIMITS.sources) throw new EditError("invalid", `sources must be a list of at most ${CARD_LIMITS.sources} entries`)
  return value.map((item) => checkText(item, CARD_LIMITS.source, "Each source"))
}

/** Puts or removes one attribute; `formatted` undefined removes it. */
function setAttribute(out: MagicString, source: string, node: JSXElement, key: string, formatted: string | undefined): void {
  if (formatted !== undefined) return putAttribute(out, source, node, key, formatted)
  const attribute = attributeNamed(source, node, key)
  if (attribute) out.remove((attribute.start ?? 1) - 1, attribute.end ?? 0)
}

function describePorts(out: MagicString, source: string, scan: Scan, ports: NonNullable<CardChange["ports"]>): void {
  for (const [name, change] of Object.entries(ports)) {
    const port = scan.model.parts.find((part) => part.name === name && part.tag === "port")
    const node = scan.partNodes.get(name)
    if (!port || !node) {
      const known = scan.model.parts.filter((part) => part.tag === "port").map((part) => part.name)
      throw new EditError("not_found", `${name} is not a port of this sheet; its ports are ${known.join(", ") || "none"}`)
    }
    if (!port.editable) throw new EditError("readonly", `Port ${name} is read-only (${port.readonlyReason})`)
    if (change.type !== undefined && change.type !== null && !(PORT_TYPES as readonly string[]).includes(change.type)) {
      throw new EditError("invalid", `Port ${name}: type must be one of ${PORT_TYPES.join(", ")}`)
    }
    if (change.type !== undefined) setAttribute(out, source, node, "type", change.type === null ? undefined : formatLiteral(change.type))
    if (change.carries !== undefined) {
      const carries = change.carries === null ? undefined : checkText(change.carries, CARD_LIMITS.carries, `Port ${name}: carries`)
      setAttribute(out, source, node, "carries", carries === undefined ? undefined : formatLiteral(carries))
    }
  }
}

/** Writes a sheet's card: `does` and `sources` on `<sheet>`, `type` and `carries` on its ports. */
export function describeSheet(source: string, scan: Scan, change: CardChange): string {
  const node = scan.sheetNode
  if (!node) throw new EditError("invalid", "This file has no <sheet>; only a sheet file has a card")
  const out = new MagicString(source)
  if (change.does !== undefined) {
    setAttribute(out, source, node, "does", change.does === null ? undefined : formatLiteral(checkText(change.does, CARD_LIMITS.does, "does")))
  }
  if (change.sources !== undefined) {
    const sources = change.sources === null || change.sources.length === 0 ? undefined : checkSources(change.sources)
    setAttribute(out, source, node, "sources", sources === undefined ? undefined : `{${JSON.stringify(sources)}}`)
  }
  describePorts(out, source, scan, change.ports ?? {})
  return out.toString()
}
