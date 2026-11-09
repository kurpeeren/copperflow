import type { PartsData } from "./api.js"
import { PLACE_DEFAULTS } from "./place-defaults.js"

export type VerifiedLabel = "Verified" | "Not verified" | ""

/** One row of the bottom Library table. `part` is what `onPlace` takes. */
export interface LibraryRow {
  part: string
  name: string
  value: string
  footprint: string
  description: string
  verified: VerifiedLabel
}

/** The starting value of a built-in: its first property that is not the footprint. */
function startingValue(kind: string): string {
  const props = PLACE_DEFAULTS[kind] ?? {}
  const key = Object.keys(props).find((k) => k !== "footprint")
  return key ? (props[key] ?? "") : ""
}

/** Library parts first, then the built-ins. */
export function libraryRows(parts: PartsData): LibraryRow[] {
  const library = parts.library.map((p): LibraryRow => ({
    part: p.id,
    name: p.id,
    value: "",
    footprint: p.footprint,
    description: p.title,
    verified: p.verified ? "Verified" : "Not verified",
  }))
  const builtin = parts.builtin.map((kind): LibraryRow => ({
    part: kind,
    name: kind,
    value: startingValue(kind),
    footprint: PLACE_DEFAULTS[kind]?.footprint ?? "",
    description: "",
    verified: "",
  }))
  return [...library, ...builtin]
}

/** Case-insensitive match of the query against every column. */
export function filterRows(rows: readonly LibraryRow[], query: string): LibraryRow[] {
  const needle = query.trim().toLowerCase()
  if (needle === "") return [...rows]
  return rows.filter((r) => [r.name, r.value, r.footprint, r.description, r.verified].some((t) => t.toLowerCase().includes(needle)))
}

export type RowKeyResult = { move: number } | { place: true } | null

/** What a key does on the row at `index` of `count` rows: move focus, place, or nothing. */
export function rowKey(key: string, index: number, count: number): RowKeyResult {
  if (count === 0) return null
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
