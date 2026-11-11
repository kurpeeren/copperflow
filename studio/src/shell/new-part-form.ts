// Library → New part…: the dialog's fields, its pin rows and paste, and the request it sends. Pure; plain TypeScript
// with .js imports, so the tests can run it. The server's writer checks everything again.
import { PIN_TYPES, type PinType } from "../../../src/core/pin-types.js"
import { generateFootprint } from "../../../src/engine/footprints/index.js"
import { parsePinTable, suggestedPinName, type PinRow, type PinTableError } from "../../../src/library/pin-table.js"

export { PIN_TYPES }

/** A pin row as typed; empty number and name together is an unused row. */
export interface PinField {
  number: string
  name: string
  type: PinType
  description: string
}

export interface SupplierField {
  supplier: string
  number: string
}

export interface NewPartFields {
  id: string
  title: string
  manufacturer: string
  mpn: string
  /** A footprint string the generator draws, or the part's own footprint.yaml, written as a placeholder. */
  packageKind: "string" | "file"
  packageText: string
  pins: PinField[]
  suppliers: SupplierField[]
  datasheet: string
  replace: boolean
}

export const EMPTY_FIELDS: NewPartFields = {
  id: "",
  title: "",
  manufacturer: "",
  mpn: "",
  packageKind: "string",
  packageText: "",
  pins: [],
  suppliers: [{ supplier: "lcsc", number: "" }],
  datasheet: "",
  replace: false,
}

/** What the dialog sends to POST /api/create-part. */
export interface CreatePartRequest {
  id: string
  title: string
  manufacturer?: string
  mpn?: string
  package: string | { file: "footprint.yaml" }
  pins: PinRow[]
  suppliers?: Record<string, string>
  datasheet?: { url: string }
  replace: boolean
}

/** The server's answer. */
export interface CreatePartResult {
  id: string
  title: string
  pins: number
  footprint: string
  files: string[]
  /** What the person still has to do; also in verification.md. */
  notes: string[]
  /** verification.md's path in the project, and its text. */
  verification: string
  checklist: string
}

const PART_ID = /^[A-Za-z](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/
const PIN_NUMBER = /^[1-9][0-9]*$/
const PIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const SUPPLIER = /^[a-z0-9_]+$/

const isBlank = (pin: PinField) => pin.number.trim() === "" && pin.name.trim() === ""
const byNumber = (a: PinField, b: PinField) => (Number(a.number) || Infinity) - (Number(b.number) || Infinity)

/** The rows with one more, numbered after the highest. */
export function withPin(pins: readonly PinField[]): PinField[] {
  const highest = Math.max(0, ...pins.map((pin) => Number(pin.number)).filter((n) => Number.isInteger(n)))
  return [...pins, { number: String(highest + 1), name: "", type: "passive", description: "" }]
}

export function withPinChanged(pins: readonly PinField[], index: number, change: Partial<PinField>): PinField[] {
  return pins.map((pin, at) => (at === index ? { ...pin, ...change } : pin))
}

export function withoutPin(pins: readonly PinField[], index: number): PinField[] {
  return pins.filter((_, at) => at !== index)
}

/** The rows with a pasted table's pins: a pasted number replaces its row, the rest are added, in number order. */
export function withPasted(pins: readonly PinField[], text: string): { pins: PinField[]; errors: PinTableError[] } {
  const table = parsePinTable(text)
  const pasted = new Map(table.pins.map((pin) => [pin.number, { ...pin, description: pin.description ?? "" }]))
  const kept = pins.filter((pin) => !isBlank(pin) && !pasted.has(pin.number.trim()))
  return { pins: [...kept, ...pasted.values()].sort(byNumber), errors: table.errors }
}

/** The request for the fields as typed, or every problem with them. */
export function readCreateRequest(fields: NewPartFields): CreatePartRequest | { problems: string[] } {
  const id = fields.id.trim()
  const title = fields.title.trim()
  const pins = readPins(fields.pins)
  const suppliers = readSuppliers(fields.suppliers)
  const datasheet = fields.datasheet.trim()
  const problems = [
    ...(id === "" ? ["Give the part an id, such as its part number."] : PART_ID.test(id) && !id.includes("..") ? [] : [`"${id}" is not a part id: start with a letter, end with a letter or digit, and use letters, digits, ".", "_" or "-".`]),
    ...(title === "" ? ["Give the part a title."] : []),
    ...packageProblems(fields),
    ...pins.problems,
    ...suppliers.problems,
    ...(datasheet === "" || /^https?:\/\/\S+$/.test(datasheet) ? [] : ["The datasheet link must start with http:// or https://."]),
  ]
  if (problems.length > 0) return { problems }
  const optional = (key: "manufacturer" | "mpn") => (fields[key].trim() ? { [key]: fields[key].trim() } : {})
  return {
    id,
    title,
    ...optional("manufacturer"),
    ...optional("mpn"),
    package: fields.packageKind === "file" ? { file: "footprint.yaml" } : fields.packageText.trim(),
    pins: pins.rows,
    ...(Object.keys(suppliers.record).length > 0 ? { suppliers: suppliers.record } : {}),
    ...(datasheet ? { datasheet: { url: datasheet } } : {}),
    replace: fields.replace,
  }
}

/** The result's first line. */
export function createdSummary(result: CreatePartResult): string {
  return `Created ${result.id}: ${result.title}, ${result.pins} pin${result.pins === 1 ? "" : "s"}, footprint ${result.footprint}. Not verified: check it in ${result.verification}.`
}

function packageProblems(fields: NewPartFields): string[] {
  if (fields.packageKind === "file") return []
  const text = fields.packageText.trim()
  if (text === "") return ["Type a footprint string such as soic8, or choose a footprint file."]
  if (text.includes("/")) return [`"${text}" is not a footprint string.`]
  const footprint = generateFootprint(text)
  return "error" in footprint ? [footprint.error] : []
}

function readPins(fields: readonly PinField[]): { rows: PinRow[]; problems: string[] } {
  const used = fields.map((pin, index) => ({ pin, row: index + 1 })).filter(({ pin }) => !isBlank(pin))
  if (used.length === 0) return { rows: [], problems: ["Add the pins: type them in the rows or paste the datasheet's pin table."] }
  const rows: PinRow[] = []
  const problems: string[] = []
  const seen = new Map<string, number>()
  for (const { pin, row } of used) {
    const [number, name, description] = [pin.number.trim(), pin.name.trim(), pin.description.trim()]
    const says = (problem: string) => problems.push(`Pin row ${row}: ${problem}`)
    if (!PIN_NUMBER.test(number)) {
      says(`"${number}" is not a pin number; pins are numbered 1, 2, 3 ….`)
      continue
    }
    const earlier = seen.get(number)
    if (earlier !== undefined) says(`pin ${number} is already in row ${earlier}.`)
    else seen.set(number, row)
    if (name === "") says(`pin ${number} has no name.`)
    else if (!PIN_NAME.test(name)) says(`"${name}" is not a pin name; use letters, digits and _, starting with a letter (e.g. ${suggestedPinName(name)}).`)
    rows.push({ number, name, type: pin.type, ...(description ? { description } : {}) })
  }
  return { rows, problems }
}

function readSuppliers(fields: readonly SupplierField[]): { record: Record<string, string>; problems: string[] } {
  const record: Record<string, string> = {}
  const problems: string[] = []
  for (const field of fields) {
    const [supplier, number] = [field.supplier.trim(), field.number.trim()]
    if (supplier === "" && number === "") continue
    const key = supplier.toLowerCase()
    if (!SUPPLIER.test(key) || number === "" || key in record) {
      const example = key.split(/[^a-z0-9_]/)[0] || "lcsc"
      problems.push(`Supplier "${supplier}": name it with lower-case letters, digits and _ (e.g. ${example}) and give its part number.`)
      continue
    }
    record[key] = number
  }
  return { record, problems }
}
