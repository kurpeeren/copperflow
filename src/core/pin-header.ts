// The pin map as a C header: for each part, a define per wired pin naming its net, and for each named signal net on
// the part, the reverse <PART>_<NET>_PIN (the pin's name, and the name itself when it is an identifier). Names are
// made valid C identifiers and carry the part, so two parts never collide; one net on two pins of a part gets the
// pad number added. Deterministic: the same rows give the same bytes.
import type { MappedPart, PinRow } from "./pin-map.js"

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Upper case, every other character to "_", and "N" before a leading digit: "can1/txcan" is CAN1_TXCAN, "5V" N5V. */
export function cIdentifier(text: string): string {
  const upper = text.toUpperCase().replace(/[^A-Z0-9_]/g, "_")
  return /^[0-9]/.test(upper) ? `N${upper}` : upper
}

const cString = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
const comment = (text: string) => `/* ${text.replace(/\*\//g, "* /")} */`

interface Define {
  part: string
  pad: string
  base: string
  value: string
  note?: string
  /** The pin's name as an identifier, for a reverse define whose pin name is one. */
  id?: string
  name?: string
}

/** Gives every define a unique name: a repeated name gets "_<pad>", and one still repeated "_<part>_<pad>". */
function nameDefines(defines: readonly Define[]): { named: Define[]; collided: string[] } {
  const count = (names: readonly string[]) => names.reduce((map, name) => map.set(name, (map.get(name) ?? 0) + 1), new Map<string, number>())
  const bases = count(defines.map((d) => d.base))
  const withPad = defines.map((d) => (bases.get(d.base) === 1 ? d.base : `${d.base}_${d.pad}`))
  const padded = count(withPad)
  const named = defines.map((d, i) => {
    const name = withPad[i] as string
    return { ...d, name: padded.get(name) === 1 ? name : `${d.base}_${cIdentifier(d.part)}_${d.pad}` }
  })
  const collided = named.filter((d) => d.name !== d.base).map((d) => d.name as string)
  return { named, collided }
}

const forwardDefine = (part: string, row: PinRow): Define | string => {
  if (row.origin === undefined) return comment(`${part} ${row.pin}: pad ${row.pad}, ${row.type}, not connected`)
  if (row.origin === "made up") return comment(`${part} ${row.pin}: pad ${row.pad}, ${row.type}, on a net with no name`)
  return { part, pad: row.pad, base: `${cIdentifier(part)}_${cIdentifier(row.pin)}_NET`, value: cString(row.net), note: `pad ${row.pad}, ${row.type}` }
}

const reverseDefine = (part: string, row: PinRow): Define => ({
  part,
  pad: row.pad,
  base: `${cIdentifier(part)}_${cIdentifier(row.net)}_PIN`,
  value: cString(row.pin),
  note: `${part} pad ${row.pad}`,
  ...(IDENTIFIER.test(row.pin) ? { id: row.pin } : {}),
})

/** A block of defines and comment lines, the names and values in columns. */
function block(lines: ReadonlyArray<Define | string>): string[] {
  const defines = lines.filter((line): line is Define => typeof line !== "string")
  const nameWidth = Math.max(0, ...defines.flatMap((d) => [d.name?.length ?? 0, d.id ? (d.name?.length ?? 0) + 3 : 0]))
  const valueWidth = Math.max(0, ...defines.map((d) => d.value.length))
  return lines.flatMap((line) => {
    if (typeof line === "string") return [line]
    const name = line.name as string
    const main = `#define ${name.padEnd(nameWidth)}  ${line.note ? `${line.value.padEnd(valueWidth)}  ${comment(line.note)}` : line.value}`
    return line.id ? [main, `#define ${`${name}_ID`.padEnd(nameWidth)}  ${line.id}`] : [main]
  })
}

/** The header of the parts, wired as in `file`; `guard` names it (U101 gives U101_PINS_H). */
export function formatPinHeader(file: string, parts: readonly MappedPart[], guard: string): string {
  const sections = parts.map((part) => ({
    part,
    forward: part.rows.map((row) => forwardDefine(part.id, row)),
    reverse: part.rows.filter((row) => row.signal === true).map((row) => reverseDefine(part.id, row)),
  }))
  const all = sections.flatMap((s) => [...s.forward, ...s.reverse].filter((line): line is Define => typeof line !== "string"))
  const { named, collided } = nameDefines(all)
  const nameOf = new Map(all.map((define, i) => [define, named[i] as Define]))
  const resolve = (lines: ReadonlyArray<Define | string>) => lines.map((line) => (typeof line === "string" ? line : (nameOf.get(line) as Define)))
  const guardName = `${cIdentifier(guard)}_PINS_H`
  return [
    comment(`Pins as wired in ${file}, written by copperflow pins. Net and pin names are strings.`),
    `#ifndef ${guardName}`,
    `#define ${guardName}`,
    ...(collided.length > 0 ? [comment(`Names that collided have the pad number added: ${collided.join(", ")}`)] : []),
    ...sections.flatMap(({ part, forward, reverse }) => [
      "",
      comment(`${part.id}: ${part.title}, pins as wired in ${file}`),
      ...block(resolve(forward)),
      ...(reverse.length > 0 ? ["", comment(`Signal nets on ${part.id}'s pins`), ...block(resolve(reverse))] : []),
    ]),
    "",
    "#endif",
  ].join("\n")
}
