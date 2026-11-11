// The renameParts edit (Design → Annotate designators): parts take new names in one pass (names may swap, R3 → R1
// while R1 → R3), and every reference to them in the file follows, so no connection changes: trace ends, a sub-sheet
// instance's connections and any other string naming a renamed part's pin. A string naming an unnamed net by its id
// ("net:R1.pin2", as a pour may) takes the id the `nets` map gives (rename-designators.ts works it out from the built
// design, since a swap changes which pin comes first); without one it is refused. A reference that cannot be rewritten
// safely refuses the whole edit, naming it: a prop written as an expression that mentions a renamed part, a plain
// string equal to a renamed part's name, a change inside a locked part. A locked or read-only part is not renamed.
import MagicString from "magic-string"
import { parseSelector } from "../engine/selectors.js"
import type { Scan } from "./analyze.js"
import { EditError } from "./edit-error.js"
import { attributeNamed } from "./edit-text.js"
import { formatLiteral } from "./literals.js"
import type { Edit } from "./types.js"

const PART_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

type RenameEdit = Extract<Edit, { kind: "renameParts" }>

/** Checks the mapping against the file: known editable unlocked parts, usable new names, no clash. */
function checkMapping(scan: Scan, mapping: RenameEdit["mapping"], locked: ReadonlySet<string>): Map<string, string> {
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

const STRING = /(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g
const NET_OF_PIN = /^net:([A-Za-z_]\w*)\.([\w-]+)$/

/**
 * A string as it reads after the rename: a renamed part's pin with the new name, an unnamed net's id as `nets` gives
 * it; `undefined` for an unnamed net of a renamed part that `nets` does not know (it cannot be worked out here).
 */
export function renamedString(text: string, names: ReadonlyMap<string, string>, nets?: Readonly<Record<string, string>>): string | undefined {
  const net = NET_OF_PIN.exec(text)
  if (net) {
    // A net's id can change when a part that is not its first pin's takes a name that sorts first, so the map decides.
    if (nets && Object.hasOwn(nets, text)) return nets[text]
    const to = names.get(net[1] as string)
    if (to === undefined) return text
    // With the design's map, an id it lacks names a pin on no net of its own: it follows the pin.
    return nets ? `net:${to}.${net[2]}` : undefined
  }
  const parsed = text.includes(".") ? parseSelector(text) : undefined
  if (!parsed || parsed.kind === "net") return text
  const to = names.get(parsed.part)
  return to === undefined ? text : `${to}.${parsed.pin}`
}

const stripStrings = (text: string): string => text.replace(STRING, '""')
const lineAt = (source: string, offset: number): number => source.slice(0, offset).split("\n").length

/** Refuses when a prop written as an expression mentions a renamed part: it cannot be rewritten safely. */
function refuseHiddenNames(scan: Scan, names: ReadonlyMap<string, string>): void {
  const owners: { what: string; line: number; props: Record<string, { literal: unknown; source: string }> }[] = [
    ...scan.model.parts.map((p) => ({ what: p.name, line: p.line, props: p.props })),
    ...scan.model.traces.map((t) => ({ what: "a trace", line: t.line, props: t.props })),
    ...scan.model.drawings.map((d) => ({ what: d.id, line: d.line, props: d.props })),
    ...(scan.model.boardItems ?? []).map((b) => ({ what: b.id, line: b.line, props: b.props })),
  ]
  for (const owner of owners) {
    for (const [key, prop] of Object.entries(owner.props)) {
      if (prop.literal !== undefined) continue
      const bare = stripStrings(prop.source)
      const hit = [...names.keys()].find((name) => new RegExp(`\\b${name}\\b`).test(bare))
      if (hit) throw new EditError("readonly", `${owner.what}.${key} on line ${owner.line} names ${hit} in an expression (${prop.source}); rename it by hand`)
    }
  }
}

/** The ranges of the renamed parts' own `name` values, which the string pass leaves to the rename itself. */
function nameRanges(source: string, scan: Scan, names: ReadonlyMap<string, string>): [number, number][] {
  return [...names.keys()].map((from) => {
    const node = scan.partNodes.get(from)
    const attribute = node ? attributeNamed(source, node, "name") : undefined
    if (!attribute?.value) throw new EditError("readonly", `${from} has no name attribute to change`)
    return [attribute.value.start ?? 0, attribute.value.end ?? 0]
  })
}

/** Whether a plain string equal to a part's name is a drawn text (`text="R1"`), which shows the name and refers to nothing. */
const isDrawnText = (source: string, start: number): boolean => /\btext\s*=\s*\{?\s*$/.test(source.slice(Math.max(0, start - 12), start))

export function renameParts(source: string, scan: Scan, edit: RenameEdit, locked: ReadonlySet<string>): string {
  const names = checkMapping(scan, edit.mapping, locked)
  refuseHiddenNames(scan, names)
  const out = new MagicString(source)
  const own = nameRanges(source, scan, names)
  ;[...names].forEach(([from, to], i) => {
    const [start, end] = own[i] as [number, number]
    if (from !== to) out.overwrite(start, end, formatLiteral(to))
  })
  const lockedParts = scan.model.parts.filter((part) => locked.has(part.name))
  const importEnd = scan.model.imports.reduce((end, spec) => Math.max(end, spec.end), 0)
  // Every other string in the file that names a renamed part follows. Import paths are not references.
  for (const match of source.matchAll(STRING)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (start < importEnd || own.some(([a, b]) => start === a && end === b)) continue
    const text = match[2] ?? ""
    if (names.has(text) && !isDrawnText(source, start)) {
      throw new EditError("readonly", `Line ${lineAt(source, start)} names ${text} as a plain string, which may refer to the part; rename it by hand`)
    }
    const next = renamedString(text, names, edit.nets)
    if (next === undefined) throw new EditError("invalid", `Line ${lineAt(source, start)} names the net ${text}, whose new id needs the built design; annotate from Studio, which builds it`)
    if (next === text) continue
    const owner = lockedParts.find((part) => start >= part.start && end <= part.end)
    if (owner) throw new EditError("locked", `${owner.name} is locked and names ${text}; unlock it to rename`)
    out.overwrite(start, end, formatLiteral(next))
  }
  return out.toString()
}
