import type { PartsData } from "./api.js"
import { placeDefaults, propText } from "./place-defaults.js"

export type VerifiedLabel = "Verified" | "Unverified" | ""

/** One row of the bottom Library table. `part` is what `onPlace` takes. */
export interface LibraryRow {
  part: string
  name: string
  value: string
  footprint: string
  description: string
  verified: VerifiedLabel
  /** The row's tooltip: the title and the component kind. */
  tooltip: string
  /** The badge's tooltip, as the list shows it. */
  verifiedTip: string
  /** Extra text the filter looks in (id, part number, component). */
  extra: string
}

/** The starting value of a built-in: its first property that is not the footprint. */
function startingValue(kind: string): string {
  const props = placeDefaults(kind)
  const key = Object.keys(props).find((k) => k !== "footprint")
  const value = key === undefined ? undefined : props[key]
  return value === undefined ? "" : propText(value)
}

/** Library parts first, then the built-ins. */
export function libraryRows(parts: PartsData): LibraryRow[] {
  const library = parts.library.map((p): LibraryRow => ({
    part: p.id,
    name: p.mpn ?? p.id,
    value: "",
    footprint: p.footprint,
    description: p.title,
    verified: p.verified ? "Verified" : "Unverified",
    tooltip: `${p.title} (${p.component})`,
    verifiedTip: p.verified ? `Checked by ${p.verifiedBy}${p.verifiedAgainst ? ` against ${p.verifiedAgainst}` : ""}` : "Not checked against the datasheet yet",
    extra: `${p.id} ${p.mpn ?? ""} ${p.component}`,
  }))
  const builtin = parts.builtin.map((kind): LibraryRow => ({
    part: kind,
    name: kind,
    value: startingValue(kind),
    footprint: propText(placeDefaults(kind).footprint ?? ""),
    description: "",
    verified: "",
    tooltip: kind,
    verifiedTip: "",
    extra: kind,
  }))
  return [...library, ...builtin]
}

/** Case-insensitive match of the query against every column. */
export function filterRows(rows: readonly LibraryRow[], query: string): LibraryRow[] {
  const needle = query.trim().toLowerCase()
  if (needle === "") return [...rows]
  return rows.filter((r) => [r.name, r.value, r.footprint, r.description, r.verified, r.extra].some((t) => t.toLowerCase().includes(needle)))
}

export type RowKeyResult = { move: number } | { place: true } | null

/** What a key does on the row at `index` of `count` rows: move focus, place, or nothing. */
export function rowKey(key: string, index: number, count: number, repeat = false): RowKeyResult {
  if (count === 0) return null
  if (key === "Enter" && repeat) return null
  const last = count - 1
  switch (key) {
    case "ArrowDown":
      return { move: Math.min(index + 1, last) }
    case "ArrowUp":
      return { move: Math.max(index - 1, 0) }
    case "Home":
      return { move: 0 }
    case "End":
      return { move: last }
    case "Enter":
      return { place: true }
    default:
      return null
  }
}

/** Two place requests closer than this are one intent (a double click, a held key). */
export const PLACE_GAP_MS = 500

/** Whether a place request goes through, given when the last one did. */
export const allowPlace = (lastAt: number | null, now: number): boolean => lastAt === null || now - lastAt >= PLACE_GAP_MS

/** A click on the Place button acts on the first click of a sequence only (keyboard clicks have detail 0). */
export const clickPlaces = (detail: number): boolean => detail <= 1

/** The row that keeps the table's one tab stop, kept inside the rows left after a filter. */
export const clampActive = (active: number, count: number): number => Math.max(0, Math.min(active, count - 1))
