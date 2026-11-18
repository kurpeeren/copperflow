// set_part_fields: a library part's supplier numbers, MPN, manufacturer and description changed without touching its
// pins or footprint, through the core's createPart as one write (as attach_datasheet does). A verified part is
// refused: its verification covers every field, so any change would void what a person checked.
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { parse } from "yaml"
import { createPart, FOOTPRINT_FILE, isPartVerified, partDir, PARTS_DIR, readPart, type Part } from "../core/library.js"
import { FootprintFileSchema } from "../engine/footprints/file.js"
import { keptNotes } from "./attach-datasheet.js"

/** The fields this changes; null removes one. Suppliers merge by name, a null supplier removes that one. */
export interface PartFields {
  suppliers?: Readonly<Record<string, string | null>> | undefined
  mpn?: string | null | undefined
  manufacturer?: string | null | undefined
  description?: string | null | undefined
}

const TEXT_FIELDS = ["mpn", "manufacturer", "description"] as const

/** The part with the fields applied; the verification is left out (the part is written unverified). */
export function withFields(current: Part, fields: PartFields): { part: Part; changes: string[] } {
  const { verified: _verified, ...rest } = current
  let part: Part = rest
  const changes: string[] = []
  for (const key of TEXT_FIELDS) {
    // An empty text is no value: it removes the field, as null does.
    const value = fields[key] === "" ? null : fields[key]
    if (value === undefined || value === (current[key] ?? null)) continue
    const { [key]: _old, ...without } = part
    part = value === null ? (without as Part) : { ...part, [key]: value }
    changes.push(value === null ? `${key} removed` : `${key} ${JSON.stringify(value)}`)
  }
  const suppliers = Object.entries(fields.suppliers ?? {}).filter(([name, value]) => value !== (current.suppliers?.[name] ?? null))
  if (suppliers.length > 0) {
    const merged = Object.fromEntries(Object.entries({ ...current.suppliers, ...Object.fromEntries(suppliers) }).filter(([, value]) => value !== null)) as Record<string, string>
    const { suppliers: _old, ...without } = part
    part = Object.keys(merged).length === 0 ? (without as Part) : { ...part, suppliers: merged }
    changes.push(...suppliers.map(([name, value]) => (value === null ? `supplier ${name} removed` : `${name} ${value}`)))
  }
  return { part, changes }
}

/** Writes the fields to the part; refuses a verified part and a call that changes nothing. */
export async function setPartFields(root: string, id: string, fields: PartFields, now: string): Promise<{ changes: string[]; files: string[] }> {
  const current = await readPart(root, id).catch((error: NodeJS.ErrnoException) => {
    throw error.code === "ENOENT" ? new Error(`No library part ${id}; list_parts shows them`) : error
  })
  if (await isPartVerified(root, id, current)) {
    throw new Error(`Part ${id} is verified by ${current.verified?.by}; changing any field would void that, so only the human can change it (in the Studio's Library, or by asking them)`)
  }
  const { part, changes } = withFields(current, fields)
  if (changes.length === 0) throw new Error(`Part ${id} already has those values; nothing was written`)
  const dir = partDir(root, id)
  const footprintFile = part.footprint === FOOTPRINT_FILE ? FootprintFileSchema.parse(parse(await readFile(join(dir, FOOTPRINT_FILE), "utf8"))) : undefined
  const notes = await keptNotes(join(dir, "verification.md"))
  const written = await createPart(root, id, part, { replace: true, now, notes, ...(footprintFile ? { footprintFile } : {}) })
  return { changes, files: written.files }
}

/** The answer: what changed, what was written and that the part stays to be checked. */
export function formatPartFields(id: string, result: { changes: string[]; files: string[] }): string {
  return [`Changed ${id}: ${result.changes.join(", ")}.`, `Wrote ${result.files.join(", ")}.`, `It stays NOT verified; the human checks ${PARTS_DIR}/${id}/verification.md.`].join("\n")
}
