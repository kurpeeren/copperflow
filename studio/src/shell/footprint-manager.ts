// Tools → Footprint manager, as plain data: one row per part with its kind, value and footprint, as EasyEDA's footprint
// manager lists them, and the changes typed in turned into setProps edits of `footprint`, all as one history entry. A
// part whose footprint comes from a library part, is written as an expression, is locked or is read-only shows why
// it cannot change here. Pure.
import type { Edit, PartInfo } from "../../../src/core/types.js"

export interface FootprintRow {
  name: string
  kind: string
  value: string
  footprint: string
  /** Why the footprint cannot be changed here; absent when it can. */
  fixed?: string
}

export interface FootprintSource {
  components: readonly { id: string; kind: string; value?: string; footprint?: string; library?: string }[]
  parts: readonly Pick<PartInfo, "name" | "props" | "editable">[]
  locked: ReadonlySet<string>
}

/** Why a part's footprint cannot change here, or undefined. */
function fixedReason(component: FootprintSource["components"][number], part: FootprintSource["parts"][number] | undefined, locked: ReadonlySet<string>): string | undefined {
  if (!part) return "Not written in this file"
  if (component.library) return `From library part ${component.library}; change it in the library`
  if (locked.has(part.name)) return "Locked"
  if (!part.editable) return "Read-only"
  const written = part.props["footprint"]
  return written && written.literal === undefined ? `Written as ${written.source}` : undefined
}

/** One row per part, in the design's order. */
export function footprintRows({ components, parts, locked }: FootprintSource): FootprintRow[] {
  return components.map((component) => {
    const part = parts.find((candidate) => candidate.name === component.id)
    const fixed = fixedReason(component, part, locked)
    return { name: component.id, kind: component.kind, value: component.value ?? "", footprint: component.footprint ?? "", ...(fixed ? { fixed } : {}) }
  })
}

/** The footprints the design uses, for the field's suggestions. */
export const usedFootprints = (rows: readonly FootprintRow[]): string[] => [...new Set(rows.map((row) => row.footprint).filter((name) => name !== ""))].sort()

const FOOTPRINT = /^[\w.\-+:,=()]+$/

/** The edits that write the changed footprints, or why one cannot be written. */
export function footprintEdits(rows: readonly FootprintRow[], changes: Readonly<Record<string, string>>): { edits: Edit[]; summary: string } | { message: string } {
  const changed = rows.filter((row) => changes[row.name] !== undefined && changes[row.name]?.trim() !== row.footprint)
  if (changed.length === 0) return { message: "No footprint was changed." }
  const fixed = changed.find((row) => row.fixed)
  if (fixed) return { message: `${fixed.name}: ${fixed.fixed}` }
  const bad = changed.find((row) => !FOOTPRINT.test((changes[row.name] ?? "").trim()))
  if (bad) return { message: `${bad.name}: a footprint is a name such as 0603 or soic8, without spaces` }
  const edits = changed.map((row): Edit => ({ kind: "setProps", part: row.name, props: { footprint: (changes[row.name] ?? "").trim() } }))
  const shown = changed.slice(0, 3).map((row) => `${row.name} → ${(changes[row.name] ?? "").trim()}`).join(", ")
  return { edits, summary: `change footprints: ${shown}${changed.length > 3 ? ` and ${changed.length - 3} more` : ""}` }
}
