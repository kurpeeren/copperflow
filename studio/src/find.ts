// Find: which parts and nets a typed query hits, the rows the Find Results tab lists, and what clicking a row changes.
// Plain functions, so they are tested without a DOM. Only types come from the engine, as in net-rows.ts.
import type { Design } from "../../src/engine/design.js"
import type { LibraryPart } from "./api.js"
import type { PartInfo } from "../../src/core/types.js"
import type { FocusRequest } from "./checks-panel-state.js"
import { netRows } from "./net-rows.js"
import { partAnchors, type View } from "./pcb/positions.js"

/** Props that say where a part sits, not what it is; the name is searched as the name. */
const NOT_SEARCHED: ReadonlySet<string> = new Set(["name", "pcbX", "pcbY", "pcbRotation", "schX", "schY", "schRotation", "layer", "side"])

/** "name" and "net name" stand alone; any other field is a prop name, "kind" (the tag) or a library entry's "title". */
export type MatchField = string

/** One piece of text that matched, and which field of the part or net it came from. */
export interface FindMatch {
  field: MatchField
  text: string
}

export interface FindRow {
  /** Unique across both kinds. */
  id: string
  kind: "part" | "net"
  /** The part's name, or the net's label. */
  name: string
  /** What matched, one entry per field. */
  matches: FindMatch[]
  /** The net's id in the design, which the highlight is keyed by. */
  net?: string
}

/** A net as the finder reads it: its id, the name shown for it and every name it has. */
export interface FindNet {
  id: string
  label: string
  names: readonly string[]
}

export const FIND_IDLE = "Press Ctrl+F to find a part or a net."
export const findNothing = (query: string): string => `Nothing matches "${query}".`

/** What the find box's live region says after a search: "No results", "1 result", "3 results"; nothing before one. */
export function findStatus(query: string | null, count: number): string {
  if (query === null) return ""
  if (count === 0) return "No results"
  return count === 1 ? "1 result" : `${count} results`
}

const collator = new Intl.Collator("en", { numeric: true })

/** The nets of a built design with the label the Net tab shows. */
export function findNets(design: Design): FindNet[] {
  const labels = new Map(netRows(design).map((row) => [row.id, row.label]))
  return design.circuit.nets.map((net) => ({ id: net.id, label: labels.get(net.id) ?? net.id, names: net.names }))
}

const textOf = (literal: unknown): string | undefined => (typeof literal === "string" || typeof literal === "number" ? String(literal) : undefined)

/** The library entry a placed part comes from: its component is the part's tag. */
function libraryOf(part: PartInfo, library: readonly LibraryPart[]): LibraryPart | undefined {
  return library.find((entry) => entry.component === part.tag)
}

function partCandidates(part: PartInfo, library: readonly LibraryPart[]): FindMatch[] {
  const candidates: FindMatch[] = [{ field: "name", text: part.name }, { field: "kind", text: part.tag }]
  for (const [key, prop] of Object.entries(part.props)) {
    const text = NOT_SEARCHED.has(key) ? undefined : textOf(prop.literal)
    if (text !== undefined) candidates.push({ field: key, text })
  }
  const entry = libraryOf(part, library)
  if (entry?.mpn) candidates.push({ field: "mpn", text: entry.mpn })
  if (entry) candidates.push({ field: "title", text: entry.title })
  return candidates
}

/** Every piece of text of the part that holds the needle, one per field. */
function partMatches(part: PartInfo, library: readonly LibraryPart[], needle: string): FindMatch[] {
  const hits = partCandidates(part, library).filter((candidate) => candidate.text.toLowerCase().includes(needle))
  return hits.filter((hit, index) => hits.findIndex((other) => other.field === hit.field) === index)
}

function netMatches(net: FindNet, needle: string): FindMatch[] {
  return net.names.filter((name) => name.toLowerCase().includes(needle)).map((text) => ({ field: "net name", text }))
}

const byName = (a: FindRow, b: FindRow): number => collator.compare(a.name, b.name)

/** Parts first by natural name order, then nets by label; case-insensitive substrings; an empty query finds nothing. */
export function findResults(query: string, parts: readonly PartInfo[], nets: readonly FindNet[], library: readonly LibraryPart[] = []): FindRow[] {
  const needle = query.trim().toLowerCase()
  if (needle === "") return []
  const partRows = parts
    .map((part): FindRow => ({ id: `part:${part.name}`, kind: "part", name: part.name, matches: partMatches(part, library, needle) }))
    .filter((row) => row.matches.length > 0)
    .sort(byName)
  const netHits = nets
    .map((net): FindRow => ({ id: `net:${net.id}`, kind: "net", name: net.label, net: net.id, matches: netMatches(net, needle) }))
    .filter((row) => row.matches.length > 0)
    .sort(byName)
  return [...partRows, ...netHits]
}

/** "value 10k, footprint 0402": what a row matched on, for the row's last column. */
export function matchSummary(row: FindRow): string {
  return row.matches.map((match) => (match.field === "name" || match.field === "net name" ? match.field : `${match.field} ${match.text}`)).join(", ")
}

/** What clicking a row changes: the part to select and where to centre the open view, or the nets to highlight. */
export interface FindPick {
  select?: string
  focus?: FocusRequest
  highlight?: readonly string[]
}

export function findPick(row: FindRow, design: Design | undefined, view: View): FindPick {
  if (row.kind === "net") return row.net ? { highlight: [row.net] } : {}
  const origin = design ? partAnchors(design, view).get(row.name)?.origin : undefined
  return { select: row.name, ...(origin ? { focus: { view, at: origin } } : {}) }
}
