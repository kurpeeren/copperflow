// A library part written from a datasheet by a person (Library → New part…) or the agent (create_part): part.yaml with
// origin "written", the component and verification.md, through the core's createPart. Never verified.
import { access, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { createPart, FOOTPRINT_FILE, PARTS_DIR, partDir, validatePartId, type Part } from "../core/library.js"
import { generateFootprint } from "../engine/footprints/index.js"
import { pinErrors, type FootprintFile } from "../engine/footprints/file.js"
import { parsePinTable, type PinRow } from "./pin-table.js"

/** A footprint string such as "soic8" or "qfn32_5x5_p0.5", or the part's own footprint.yaml. */
export type PackageChoice = string | { file: typeof FOOTPRINT_FILE }

export interface NewPartInput {
  id: string
  title: string
  description?: string
  manufacturer?: string
  mpn?: string
  package: PackageChoice
  /** Rows, part.yaml's record, or a table pasted from the datasheet (see pin-table.ts). */
  pins: readonly PinRow[] | Part["pins"] | string
  suppliers?: Record<string, string>
  datasheet?: { url?: string; file?: string }
  /** With package { file }: the pads transcribed from the datasheet. Without them footprint.yaml is a placeholder. */
  footprintFile?: FootprintFile
}

export interface NewPartResult {
  id: string
  part: Part
  files: string[]
  /** What the person still has to do, also in verification.md. */
  notes: string[]
  /** The checklist's path in the project. */
  verification: string
  /** verification.md as written. */
  checklist: string
}

/** Spacing of the placeholder footprint's pads, in mm: one pad per pin in a row, 0.1 inch apart. */
const STUB_PITCH = 2.54
const STUB_PAD = { width: 1.2, height: 1.8 }

export const PLACEHOLDER_NOTE =
  'footprint.yaml is a placeholder (one pad per pin in a row, 2.54 mm apart): draw every pad from the datasheet\'s recommended land pattern, then delete "placeholder: true". Until then the checks report an error for each use of the part on the board, fabrication files are not written and the part cannot be verified; the schematic works.'

/** Writes the part; throws with one message for the person when it cannot, and then writes nothing. */
export async function writeNewPart(root: string, input: NewPartInput, options: { now: string; replace?: boolean }): Promise<NewPartResult> {
  const id = validatePartId(input.id)
  const pins = pinsOf(input.pins)
  const fromFile = typeof input.package !== "string"
  if (input.footprintFile && !fromFile) throw new Error(`Footprint pads are given only with package { file: "${FOOTPRINT_FILE}" }`)
  if (!fromFile) checkPackage(input.package as string, pins)
  const footprintFile = fromFile ? (input.footprintFile ?? stubFootprint(pins)) : undefined
  const notes = fromFile && !input.footprintFile ? [PLACEHOLDER_NOTE] : []
  const part = {
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    ...(input.manufacturer ? { manufacturer: input.manufacturer } : {}),
    ...(input.mpn ? { mpn: input.mpn } : {}),
    origin: `written ${options.now.slice(0, 10)}`,
    footprint: fromFile ? FOOTPRINT_FILE : input.package,
    pins,
    ...(input.suppliers && Object.keys(input.suppliers).length > 0 ? { suppliers: input.suppliers } : {}),
    ...(input.datasheet && (input.datasheet.url || input.datasheet.file) ? { datasheet: input.datasheet } : {}),
  }
  const dir = partDir(root, id)
  const existed = await access(dir).then(
    () => true,
    () => false,
  )
  try {
    const created = await createPart(root, id, part, { replace: options.replace === true, now: options.now, notes, ...(footprintFile ? { footprintFile } : {}) })
    const checklist = await readFile(join(dir, "verification.md"), "utf8")
    return { id, part: created.part, files: created.files, notes, verification: `${PARTS_DIR}/${id}/verification.md`, checklist }
  } catch (error) {
    // createPart checks everything before it writes; a folder this call made is removed when a write fails.
    if (!existed) await rm(dir, { recursive: true, force: true })
    throw error
  }
}

/** A few lines saying what was written, for create_part and the Studio. */
export function formatNewPart(result: NewPartResult): string {
  const pins = Object.keys(result.part.pins).length
  return [
    `Created ${result.id}: ${result.part.title}, ${pins} pin${pins === 1 ? "" : "s"}, footprint ${result.part.footprint}.`,
    `Wrote ${result.files.join(", ")}.`,
    ...result.notes.map((note) => `Note: ${note}`),
    `It is NOT verified: check every pin and the footprint in ${result.verification} against the datasheet.`,
  ].join("\n")
}

/** A footprint.yaml with one pad per pin in a row, centred, for the person to replace with the land pattern. */
export function stubFootprint(pins: Part["pins"]): FootprintFile {
  const numbers = Object.keys(pins).sort((a, b) => Number(a) - Number(b))
  const offset = ((numbers.length - 1) * STUB_PITCH) / 2
  return {
    placeholder: true,
    pads: numbers.map((number, index) => ({ number, shape: "rect" as const, x: round(index * STUB_PITCH - offset), y: 0, ...STUB_PAD })),
  }
}

/** The pins as part.yaml's record, in number order; a pasted table with problems is refused with every line's. */
function pinsOf(pins: NewPartInput["pins"]): Part["pins"] {
  const rows = typeof pins === "string" ? tableRows(pins) : Array.isArray(pins) ? (pins as readonly PinRow[]) : undefined
  const record = rows ? recordOf(rows) : (pins as Part["pins"])
  if (Object.keys(record).length === 0) throw new Error("The part has no pins: give at least one, by number with a name and a type")
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => Number(a) - Number(b)))
}

function recordOf(rows: readonly PinRow[]): Part["pins"] {
  const record: Part["pins"] = {}
  for (const { number, ...pin } of rows) {
    if (record[number]) throw new Error(`Pin ${number} is given twice`)
    record[number] = pin
  }
  return record
}

function tableRows(text: string): PinRow[] {
  const table = parsePinTable(text)
  if (table.errors.length > 0) throw new Error(`The pin table has problems: ${table.errors.map((error) => error.message).join("; ")}`)
  return table.pins
}

/** Throws unless copperflow can make the footprint string and its pads are the part's pins. */
function checkPackage(text: string, pins: Part["pins"]): void {
  if (text === FOOTPRINT_FILE) throw new Error(`Package "${text}" is not a footprint string: for the part's own footprint file pass package { "file": "${FOOTPRINT_FILE}" }`)
  const footprint = generateFootprint(text)
  if ("error" in footprint) throw new Error(`Package "${text}": ${footprint.error}`)
  const problems = pinErrors(footprint, { pins })
  if (problems.length > 0) throw new Error(`Package "${text}" does not fit the pins: ${problems.join("; ")}`)
}

const round = (value: number) => Math.round(value * 1000) / 1000
