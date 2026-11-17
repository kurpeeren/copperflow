// create_part: a library part written from a datasheet, the same as the Studio's Library → New part….
import { z } from "zod"
import { DATASHEET_KEYS, FOOTPRINT_FILE, PartSchema } from "../core/library.js"
import { FootprintFileInputSchema, FootprintFileSchema } from "../engine/footprints/file.js"
import { formatNewPart, writeNewPart } from "../library/new-part.js"

const fields = PartSchema.shape

export const createPartInput = {
  id: z.string().describe("e.g. AP2112K-3.3"),
  title: fields.title,
  description: fields.description,
  manufacturer: fields.manufacturer,
  mpn: fields.mpn.describe("Full orderable number"),
  package: z
    .union([z.string(), z.object({ file: z.literal(FOOTPRINT_FILE) }).strict()])
    .describe('e.g. sot23_5, soic8, or { "file": "footprint.yaml" }'),
  pins: z
    .union([fields.pins, z.string()])
    .describe('e.g. { "1": { "name": "VIN", "type": "power_in" } }, or the pin table as text, "1 VIN power_in" per line'),
  suppliers: fields.suppliers.describe('e.g. { "lcsc": "C51118" }'),
  datasheet: fields.datasheet.describe(`Only ${DATASHEET_KEYS.join(", ")}`),
  model: fields.model.describe('For simulate, e.g. { "kind": "nmos", "pins": { "gate": "G", "source": "S", "drain": "D" }, "figures": { "vth": { "value": 1.45, "source": "p2, Table 1" } } }'),
  footprint_file: FootprintFileInputSchema.optional().describe("Pads in mm, y up, origin at the centre"),
  replace: z.boolean().optional(),
}

export const CREATE_PART_DESCRIPTION =
  "Create a library part from a datasheet you have read: pins by number with names and types, a footprint string (sot23_5, 0402), MPN, suppliers. When no string fits, package { \"file\": \"footprint.yaml\" } with footprint_file pads copied from the datasheet land pattern (never estimated). datasheet takes only url, file and title, e.g. { \"url\": \"https://example.com/ds.pdf\", \"title\": \"TJA1051 datasheet\" }; pin table pages go to attach_datasheet. An existing id is refused unless replace. The part starts NOT verified: tell the human to check verification.md."

type CreatePartArgs = z.infer<z.ZodObject<typeof createPartInput>>

/** Writes the part and answers with what was written and what to check. */
export async function createPartTool(root: string, input: CreatePartArgs): Promise<string> {
  const { footprint_file, replace, ...part } = input
  // The input writes a point as a list of two numbers; the land pattern's own schema makes the pairs of them.
  const footprintFile = footprint_file ? { footprintFile: FootprintFileSchema.parse(footprint_file) } : {}
  const result = await writeNewPart(root, { ...part, ...footprintFile }, { now: new Date().toISOString(), replace: replace === true })
  return [formatNewPart(result), `Use it with place_part (part "${result.id}"). Tell the human it is Unverified until they check verification.md.`].join("\n")
}
