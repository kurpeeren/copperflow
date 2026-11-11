// Imports one part by its LCSC number: fetches its symbol, footprint and attributes from EasyEDA's public part
// endpoint, converts them and writes parts/<id>/ (part.yaml, footprint.yaml, the component, verification.md and
// source.md). Only on the person's request, one part at a time; nothing is cached. The part is never verified.
// The terms of the data are in docs/licences.md.
import { access } from "node:fs/promises"
import { join } from "node:path"
import { createPart, PARTS_DIR, partDir, validatePartId, type Part } from "../core/library.js"
import { writeFileAtomic } from "../core/fs-utils.js"
import { convertLcscAnswer, lcscNumber, SOURCE_LINKS, SOURCE_NAME, type LcscPart } from "./lcsc-part.js"

/** EasyEDA's endpoint for one part's symbol, footprint and attributes. */
export const lcscEndpoint = (lcsc: string): string => `https://easyeda.com/api/products/${encodeURIComponent(lcsc)}/components?version=6.4.19.5`

/** How long the fetch may take before the importer gives up. */
const FETCH_TIMEOUT_MS = 20_000

/** Said with every import: the source does not grant commercial use outside JLCEDA/EasyEDA. */
export const COMMERCIAL_NOTE =
  "The source grants commercial use only inside JLCEDA/EasyEDA: before using this part in a commercial design or sharing it, draw it from the datasheet or get permission from JLCEDA/EasyEDA (see source.md)."

export interface ImportOptions {
  /** The part id; by default the MPN made into an id. */
  id?: string
  /** Overwrite an existing, unverified part with this id. */
  replace?: boolean
  /** ISO time of the import. */
  now: string
  /** Tests pass a fetch that answers from a recorded document; never the network. */
  fetch?: typeof fetch
}

export interface ImportResult {
  id: string
  lcsc: string
  part: Part
  files: string[]
  pads: number
  /** What the conversion approximated or changed, also in verification.md. */
  notes: string[]
}

/** Imports the part; throws with a message for the person when it cannot, and then writes nothing. */
export async function importLcscPart(root: string, lcscText: string, options: ImportOptions): Promise<ImportResult> {
  const lcsc = lcscNumber(lcscText)
  if (options.id !== undefined) await refuseExisting(root, validatePartId(options.id), options.replace)
  const answer = await fetchAnswer(lcsc, options.fetch ?? fetch)
  const converted = convert(answer, lcsc, options.now.slice(0, 10))
  const id = options.id ?? converted.suggestedId
  await refuseExisting(root, id, options.replace)
  const created = await createPart(root, id, converted.part, {
    replace: options.replace === true,
    footprintFile: converted.footprint,
    now: options.now,
    notes: converted.notes,
  })
  await writeFileAtomic(join(partDir(root, id), "source.md"), sourceText(id, converted, options.now.slice(0, 10)))
  return { id, lcsc, part: created.part, files: [...created.files, `${PARTS_DIR}/${id}/source.md`], pads: converted.footprint.pads.length, notes: converted.notes }
}

/** A few lines saying what was written, for the CLI, the MCP tool and the Studio. */
export function formatImport(result: ImportResult): string {
  const pins = Object.keys(result.part.pins).length
  return [
    `Imported ${result.lcsc} as ${result.id}: ${result.part.title}, ${pins} pin${pins === 1 ? "" : "s"}, ${result.pads} pad${result.pads === 1 ? "" : "s"}.`,
    `Wrote ${result.files.join(", ")}.`,
    ...result.notes.map((note) => `Note: ${note}`),
    `It is NOT verified: check every pin and pad in ${PARTS_DIR}/${result.id}/verification.md against the datasheet.`,
    COMMERCIAL_NOTE,
  ].join("\n")
}

async function refuseExisting(root: string, id: string, replace: boolean | undefined): Promise<void> {
  if (replace) return
  const exists = await access(join(partDir(root, id), "part.yaml")).then(
    () => true,
    () => false,
  )
  if (exists) throw new Error(`Part ${id} already exists; import again with replace (--replace) to overwrite it, or choose another id`)
}

async function fetchAnswer(lcsc: string, get: typeof fetch): Promise<unknown> {
  let response: Response
  try {
    response = await get(lcscEndpoint(lcsc), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (error) {
    throw new Error(`Could not reach easyeda.com to fetch ${lcsc} (${reason(error)}). Importing needs an internet connection; nothing was written.`)
  }
  // EasyEDA answers an unknown part with 404 and a JSON body that says so; the conversion reports it.
  if (!response.ok && response.status !== 404) throw new Error(`easyeda.com answered ${response.status} for ${lcsc}; nothing was written. Try again later.`)
  try {
    return await response.json()
  } catch (error) {
    throw new Error(`easyeda.com's answer for ${lcsc} could not be read (${reason(error)}); nothing was written.`)
  }
}

function convert(answer: unknown, lcsc: string, today: string): LcscPart {
  try {
    return convertLcscAnswer(answer, lcsc, today)
  } catch (error) {
    throw new Error(`Cannot import ${lcsc}: ${(error as Error).message}. Nothing was written.`)
  }
}

function reason(error: unknown): string {
  const cause = (error as { cause?: { code?: string; message?: string } }).cause
  return cause?.code ?? cause?.message ?? (error as Error).message ?? String(error)
}

/** source.md: where the part came from, the source's notice exactly as its documents carried it, and what it allows. */
function sourceText(id: string, converted: LcscPart, today: string): string {
  const quoted = converted.notices.length === 0 ? ["The documents carried no notice."] : converted.notices.flatMap((notice) => [...notice.split(/\r?\n/).map((line) => `> ${line}`.trimEnd()), ""])
  return [
    `# Source of ${id}`,
    "",
    `Imported by copperflow on ${today} from LCSC part ${converted.lcsc}, out of the ${SOURCE_NAME}: ${SOURCE_LINKS.join(" and ")}.`,
    "",
    "The data's own notice, as EasyEDA's documents carry it:",
    "",
    ...quoted,
    "copperflow converted the symbol and footprint into this folder for this project only. " + COMMERCIAL_NOTE.replace(" (see source.md)", ""),
    "Do not remove this file or the origin in part.yaml. copperflow's reading of the terms is in its docs/licences.md.",
    "",
  ].join("\n")
}
