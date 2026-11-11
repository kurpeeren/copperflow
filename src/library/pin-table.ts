// A pin table pasted from a datasheet: one pin per line, "number name type [description]", separated by tabs, commas
// or spaces. Pure. A type that is not one of copperflow's pin types is reported on its line, never guessed.
import { PIN_TYPES, type PinType } from "../core/pin-types.js"

export interface PinRow {
  number: string
  name: string
  type: PinType
  description?: string
}

export interface PinTableError {
  /** 1-based, counting blank lines, so it matches the pasted text. */
  line: number
  text: string
  message: string
}

export interface PinTable {
  pins: PinRow[]
  errors: PinTableError[]
}

const PIN_NUMBER = /^[1-9][0-9]*$/
const PIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const TYPE_LIST = `${PIN_TYPES.slice(0, -1).join(", ")} or ${PIN_TYPES[PIN_TYPES.length - 1]}`

type Separator = "tab" | "comma" | "spaces" | "space"

/** The pins of the table and a message per line that is not a pin; the first line is skipped when it is a header. */
export function parsePinTable(text: string): PinTable {
  const lines = text.split(/\r?\n/)
  const separator = separatorOf(lines)
  const firstFilled = lines.findIndex((line) => line.trim() !== "")
  const pins: PinRow[] = []
  const errors: PinTableError[] = []
  const seen = new Map<string, number>()
  lines.forEach((raw, index) => {
    const text = raw.trim()
    if (text === "" || (index === firstFilled && isHeader(text))) return
    const line = index + 1
    const result = readRow(cellsOf(text, separator), seen)
    if (typeof result === "string") errors.push({ line, text, message: `Line ${line}: ${result}` })
    else {
      seen.set(result.number, line)
      pins.push(result)
    }
  })
  return { pins, errors }
}

/** The rows as a tab-separated table, the form the paste area shows and reads back. */
export function pinTableText(rows: readonly PinRow[]): string {
  return rows.map((row) => [row.number, row.name, row.type, ...(row.description ? [row.description] : [])].join("\t")).join("\n")
}

/** A name copperflow accepts made from a datasheet's ("+3V3" becomes "_3V3"); a suggestion, never applied by itself. */
export function suggestedPinName(text: string): string {
  const name = text.replace(/[^A-Za-z0-9_]/g, "_")
  return /^[A-Za-z_]/.test(name) ? name : `_${name}`
}

/** One separator for the whole table: tabs if any line has one, commas if every line has one, else spaces. */
function separatorOf(lines: readonly string[]): Separator {
  const filled = lines.map((line) => line.trim()).filter((line) => line !== "")
  if (filled.some((line) => line.includes("\t"))) return "tab"
  if (filled.length > 0 && filled.every((line) => line.includes(","))) return "comma"
  return filled.some((line) => / {2,}/.test(line)) ? "spaces" : "space"
}

function cellsOf(text: string, separator: Separator): string[] {
  const pattern = { tab: /\t/, comma: /,/, spaces: / {2,}/, space: /\s+/ }[separator]
  // In an aligned table a line may have only single spaces; then its words are its cells.
  const split = separator === "spaces" && !/ {2,}/.test(text) ? /\s+/ : pattern
  const cells = text.split(split).map((cell) => cell.trim())
  if (separator !== "space") return cells
  // Space-separated: the words after the type are the description.
  return cells.length > 3 ? [...cells.slice(0, 3), cells.slice(3).join(" ")] : cells
}

/** A header names its columns: it has no digits ("Pin Name Type", "No., Name, Type"). */
function isHeader(text: string): boolean {
  return !/[0-9]/.test(text)
}

function readRow(cells: readonly string[], seen: ReadonlyMap<string, number>): PinRow | string {
  const [number = "", name = "", typeText = "", ...rest] = cells
  if (!PIN_NUMBER.test(number)) return `"${number}" is not a pin number; pins are numbered 1, 2, 3 …`
  const earlier = seen.get(number)
  if (earlier !== undefined) return `pin ${number} is already on line ${earlier}`
  if (name === "") return `pin ${number} has no name`
  if (!PIN_NAME.test(name)) return `"${name}" is not a pin name; use letters, digits and _, starting with a letter (e.g. ${suggestedPinName(name)})`
  const type = typeText === "" ? "passive" : pinType(typeText)
  if (!type) return `"${typeText}" is not a pin type; use ${TYPE_LIST}`
  const description = rest.filter((cell) => cell !== "").join(", ")
  return { number, name, type, ...(description ? { description } : {}) }
}

/** The pin type a word names, in any case, with "-" or a space for "_" ("Power-In" is power_in). */
function pinType(text: string): PinType | undefined {
  const word = text.toLowerCase().replace(/[-\s]+/g, "_")
  return PIN_TYPES.find((type) => type === word)
}
