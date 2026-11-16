// create_part: a library part written from a datasheet, the same as the Studio's Library → New part….
import { z } from "zod"
import { DATASHEET_KEYS, FOOTPRINT_FILE, PartSchema } from "../core/library.js"
import { FootprintFileInputSchema, FootprintFileSchema } from "../engine/footprints/file.js"
import { formatNewPart, writeNewPart } from "../library/new-part.js"

const fields = PartSchema.shape

export const createPartInput = {
  id: z.string().describe("Folder name, e.g. AP2112K-3.3"),
  title: fields.title,
  description: fields.description,
  manufacturer: fields.manufacturer,
  mpn: fields.mpn.describe("The full orderable number, e.g. AP2112K-3.3TRG1"),
  package: z
    .union([z.string(), z.object({ file: z.literal(FOOTPRINT_FILE) }).strict()])
    .describe('A copperflow footprint string such as sot23_5, soic8, qfn32_5x5_p0.5 or hc49s; or { "file": "footprint.yaml" } when no string fits'),
  pins: z
    .union([fields.pins, z.string()])
    .describe('Every pin by number: { "1": { "name": "VIN", "type": "power_in" } }, or the datasheet\'s pin table as text, one pin per line ("1 VIN power_in", tab or comma separated too; no type means passive)'),
  suppliers: fields.suppliers.describe('e.g. { "lcsc": "C51118" }'),
  datasheet: fields.datasheet.describe(`Only the keys ${DATASHEET_KEYS.join(", ")} (others are refused), e.g. { "url": "https://example.com/ds.pdf", "title": "TJA1051 datasheet" }`),
  footprint_file: FootprintFileInputSchema.optional().describe('With package { "file": "footprint.yaml" }: every pad in mm (y up, origin at the part centre) from the datasheet land pattern. Without it footprint.yaml is a placeholder the human completes.'),
  replace: z.boolean().optional().describe("Overwrite an existing, unverified part"),
}

export const CREATE_PART_DESCRIPTION =
  "Create a library part from a datasheet you have read: pins by number with names and electrical types, a copperflow footprint string such as sot23_5 or 0402, MPN and supplier numbers. When no footprint string fits the package, set package to { \"file\": \"footprint.yaml\" } and pass footprint_file with every pad transcribed from the datasheet's recommended land pattern (never estimate). Writes parts/<id>/part.yaml, the component and verification.md; an existing id is refused unless replace. datasheet takes only url, file (a PDF in the part folder) and title, e.g. { \"url\": \"https://example.com/ds.pdf\", \"title\": \"TJA1051 datasheet\" }; the pages of the pin table go to attach_datasheet. The part starts NOT verified (Unverified in the Studio); tell the human to check verification.md."

type CreatePartArgs = z.infer<z.ZodObject<typeof createPartInput>>

/** Writes the part and answers with what was written and what to check. */
export async function createPartTool(root: string, input: CreatePartArgs): Promise<string> {
  const { footprint_file, replace, ...part } = input
  // The input writes a point as a list of two numbers; the land pattern's own schema makes the pairs of them.
  const footprintFile = footprint_file ? { footprintFile: FootprintFileSchema.parse(footprint_file) } : {}
  const result = await writeNewPart(root, { ...part, ...footprintFile }, { now: new Date().toISOString(), replace: replace === true })
  return [formatNewPart(result), `Use it with place_part (part "${result.id}"). Tell the human it is Unverified until they check verification.md.`].join("\n")
}
