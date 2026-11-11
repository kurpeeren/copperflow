// The renameParts edit (Design → Annotate designators): parts take new names in one pass (names may swap, R3 → R1
// while R1 → R3), and every trace end that names one of them follows, so no connection changes. Refused for a locked
// or read-only part, a name already taken by a part that keeps it, and a trace end written as an expression.
import MagicString from "magic-string"
import { parseSelector } from "../engine/selectors.js"
import type { Scan } from "./analyze.js"
import { EditError } from "./edit-error.js"
import { attributeNamed } from "./edit-text.js"
import { formatLiteral } from "./literals.js"
import type { Edit } from "./types.js"

const PART_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Checks the mapping against the file: known editable unlocked parts, usable new names, no clash. */
function checkMapping(scan: Scan, mapping: readonly { from: string; to: string }[], locked: ReadonlySet<string>): Map<string, string> {
  const names = new Map<string, string>()
  for (const { from, to } of mapping) {
    const part = scan.model.parts.find((candidate) => candidate.name === from)
    if (!part) throw new EditError("not_found", `No part named ${from}`)
    if (locked.has(from)) throw new EditError("locked", `${from} is locked; ask the human to unlock it`)
    if (!part.editable) throw new EditError("readonly", `${from} is read-only (${part.readonlyReason ?? "an expression"})`)
    if (!PART_NAME.test(to)) throw new EditError("invalid", `"${to}" is not a valid part name; use letters, digits and _`)
    if (names.has(from)) throw new EditError("invalid", `${from} is renamed twice`)
    names.set(from, to)
  }
  const kept = scan.model.parts.map((part) => part.name).filter((name) => !names.has(name))
  const targets = [...names.values()]
  const clash = targets.find((to, index) => kept.includes(to) || targets.indexOf(to) !== index || scan.model.drawings.some((d) => d.id === to || d.name === to))
  if (clash) throw new EditError("invalid", `${clash} would name two things`)
  return names
}

/** A trace end with its part renamed: `R1.pin1` → `R3.pin1`; a net end and any other part stay. */
function renamedEnd(end: string, names: ReadonlyMap<string, string>): string {
  const parsed = parseSelector(end)
  if (!parsed || parsed.kind === "net") return end
  const to = names.get(parsed.part)
  return to === undefined ? end : `${to}.${parsed.pin}`
}

export function renameParts(source: string, scan: Scan, edit: Extract<Edit, { kind: "renameParts" }>, locked: ReadonlySet<string>): string {
  const names = checkMapping(scan, edit.mapping, locked)
  const out = new MagicString(source)
  for (const [from, to] of names) {
    const node = scan.partNodes.get(from)
    const attribute = node ? attributeNamed(source, node, "name") : undefined
    if (!attribute?.value) throw new EditError("readonly", `${from} has no name attribute to change`)
    if (from !== to) out.overwrite(attribute.value.start ?? 0, attribute.value.end ?? 0, formatLiteral(to))
  }
  scan.model.traces.forEach((trace, index) => {
    const node = scan.traceNodes[index]
    if (!node) return
    for (const key of ["from", "to"] as const) {
      const end = trace[key]
      const prop = trace.props[key]
      if (end === undefined) {
        if (prop && !prop.editable) {
          const parts = [...names.keys()].filter((name) => prop.source.includes(name))
          if (parts.length > 0) throw new EditError("readonly", `The trace on line ${trace.line} names ${parts.join(", ")} in an expression; rename by hand`)
        }
        continue
      }
      const next = renamedEnd(end, names)
      const attribute = attributeNamed(source, node, key)
      if (next !== end && attribute?.value) out.overwrite(attribute.value.start ?? 0, attribute.value.end ?? 0, formatLiteral(next))
    }
  })
  return out.toString()
}
