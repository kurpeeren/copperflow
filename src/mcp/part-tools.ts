// The library part tools beside create_part: list_parts { id } (part.yaml, its footprint's pads under the pins, and the
// verification checklist) and set_part_fields (supplier numbers, MPN, manufacturer, description of an existing part).
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import YAML from "yaml"
import { z } from "zod"
import { FOOTPRINT_FILE, partDir, PARTS_DIR, readPart, type Part } from "../core/library.js"
import { padLines } from "../core/pad-lines.js"
import { generateFootprint } from "../engine/footprints/index.js"
import { footprintFromFile } from "../engine/footprints/file.js"
import { formatPartFields, setPartFields } from "../library/part-fields.js"

const text = z.string().nullable().optional()

export const setPartFieldsInput = {
  id: z.string(),
  suppliers: z.record(z.string(), z.string().nullable()).optional().describe('e.g. { "lcsc": "C6186" }; null removes one'),
  mpn: text,
  manufacturer: text,
  description: text,
}

export const SET_PART_FIELDS_DESCRIPTION =
  "Set a library part's suppliers, mpn, manufacturer or description; pins and footprint stay. null removes one. A verified part is refused."

type SetPartFieldsArgs = { id: string; suppliers?: Record<string, string | null> | undefined; mpn?: string | null | undefined; manufacturer?: string | null | undefined; description?: string | null | undefined }

export async function setPartFieldsTool(root: string, input: SetPartFieldsArgs): Promise<string> {
  const { id, ...fields } = input
  return formatPartFields(id, await setPartFields(root, id, fields, new Date().toISOString()))
}

/** The pads of the part's footprint, each with the pin name of its number, or why they cannot be shown. */
async function partPadLines(root: string, id: string, part: Part): Promise<string[]> {
  const fromFile = part.footprint === FOOTPRINT_FILE
  const path = `${PARTS_DIR}/${id}/${FOOTPRINT_FILE}`
  const footprint = fromFile ? footprintFromFile(path, await readFile(join(partDir(root, id), FOOTPRINT_FILE), "utf8")) : generateFootprint(part.footprint)
  if ("error" in footprint) return [`--- pads: the footprint cannot be made: ${footprint.error} ---`]
  return [`--- pads of ${fromFile ? path : part.footprint}: number, centre, size (mm), hole, pin ---`, ...padLines(footprint.pads, (number) => part.pins[number]?.name)]
}

/** list_parts { id }: part.yaml, the pads under the pins, then verification.md. */
export async function partInfo(root: string, id: string): Promise<string> {
  const part = await readPart(root, id)
  const checklist = await readFile(join(partDir(root, id), "verification.md"), "utf8").catch(() => "(no verification.md)")
  return [YAML.stringify(part).trimEnd(), ...(await partPadLines(root, id, part)), "--- verification.md ---", checklist].join("\n")
}
