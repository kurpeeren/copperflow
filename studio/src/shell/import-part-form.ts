// Library → Import by LCSC number…: what the dialog reads from its fields, and the lines it shows for the result.
// Pure; plain TypeScript with .js imports, so the tests can run it.

/** What the dialog asks the server: the LCSC number, the part id (empty for the MPN) and whether to replace. */
export interface ImportPartRequest {
  lcsc: string
  id?: string
  replace: boolean
}

/** The server's answer for an import. */
export interface ImportPartResult {
  id: string
  lcsc: string
  title: string
  pins: number
  pads: number
  files: string[]
  /** What the conversion approximated or changed; also in verification.md. */
  notes: string[]
  /** What the source's terms allow. */
  terms: string
}

export const LCSC_HINT = "Type the LCSC part number, e.g. C7950. The part is fetched from EasyEDA, so this needs the internet."

/** The request for the fields as typed, or what is wrong with them. */
export function readImportRequest(lcscText: string, idText: string, replace: boolean): ImportPartRequest | { message: string } {
  const lcsc = lcscText.trim().toUpperCase()
  if (lcsc === "") return { message: LCSC_HINT }
  if (!/^C[1-9][0-9]{0,9}$/.test(lcsc)) return { message: `"${lcscText.trim()}" is not an LCSC part number: it looks like C7950 (C and digits).` }
  const id = idText.trim()
  return { lcsc, replace, ...(id ? { id } : {}) }
}

/** The result's first line. */
export function importSummary(result: ImportPartResult): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
  return `Imported ${result.lcsc} as ${result.id}: ${result.title}, ${plural(result.pins, "pin")}, ${plural(result.pads, "pad")}.`
}

/** What the person does next: the part is not verified until they check it. */
export function verifyHint(result: ImportPartResult): string {
  return `Not verified: check every pin and pad in parts/${result.id}/verification.md against the datasheet before verifying it.`
}

/** The Library's line for where a part came from: "Imported from LCSC C7950 on 2026-11-11". */
export function originLabel(origin: string | undefined): string | undefined {
  if (!origin) return undefined
  const lcsc = /^lcsc (C\d+), imported (\S+)$/.exec(origin)
  return lcsc ? `Imported from LCSC ${lcsc[1]} on ${lcsc[2]}` : origin
}
