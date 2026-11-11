// import_part: a library part fetched by its LCSC number from EasyEDA, converted and written unverified.
import { z } from "zod"
import { formatImport, importLcscPart } from "../library/import-lcsc.js"

export const importPartInput = {
  lcsc: z.string().describe("The LCSC part number, e.g. C7950"),
  id: z.string().optional().describe("The part id (folder name); default the MPN made into an id"),
  replace: z.boolean().optional().describe("Overwrite an existing, unverified part with this id"),
}

export const IMPORT_PART_DESCRIPTION =
  "Import a part by its LCSC number when the human asks for it: fetches its symbol, footprint and attributes from EasyEDA (the JLCEDA/EasyEDA Official Library) and writes parts/<id>/ with part.yaml, footprint.yaml, verification.md and source.md. Pin types are passive except supply and ground pins; approximated pads are listed as notes. The part is NOT verified: tell the human to check verification.md, and that the source grants commercial use only inside JLCEDA/EasyEDA. One part per request; never import parts in bulk. Needs the internet; offline it writes nothing."

/** Imports the part and answers with what was written and what to check. */
export async function importPart(root: string, input: { lcsc: string; id?: string; replace?: boolean }, get?: typeof fetch): Promise<string> {
  const result = await importLcscPart(root, input.lcsc, {
    now: new Date().toISOString(),
    replace: input.replace === true,
    ...(input.id ? { id: input.id } : {}),
    ...(get ? { fetch: get } : {}),
  })
  return [formatImport(result), `Use it with place_part (part "${result.id}").`].join("\n")
}
