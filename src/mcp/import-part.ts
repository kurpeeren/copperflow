// import_part: a library part fetched by its LCSC number from EasyEDA, converted and written unverified.
import { z } from "zod"
import { formatImport, importLcscPart } from "../library/import-lcsc.js"

export const importPartInput = {
  lcsc: z.string().describe("e.g. C7950"),
  id: z.string().optional().describe("Default from the MPN"),
  replace: z.boolean().optional(),
}

export const IMPORT_PART_DESCRIPTION =
  "Import one part by its LCSC number when the human asks: symbol, footprint and attributes from the JLCEDA/EasyEDA library into parts/<id>/. It is NOT verified: tell the human to check verification.md, and that the import is for personal, non-commercial use only (EasyEDA's terms). Never import in bulk. Needs the internet. Letter-numbered pins (BGA, many USB-C) and bottom pads are refused: use create_part."

/** Imports the part and answers with what was written and what to check. */
export async function importPart(root: string, input: { lcsc: string; id?: string; replace?: boolean }, get?: typeof fetch): Promise<string> {
  const result = await importLcscPart(root, input.lcsc, {
    now: new Date().toISOString(),
    replace: input.replace === true,
    ...(input.id ? { id: input.id } : {}),
    ...(get ? { fetch: get } : {}),
  })
  return [formatImport(result), `Place it with edit_circuit place_part (part "${result.id}").`].join("\n")
}
