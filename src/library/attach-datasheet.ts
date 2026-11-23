// set_part_fields { datasheet }: records where a part's pin table came from (the datasheet's link, title and pages) in part.yaml and
// in verification.md, through the core's createPart as one write. The link is only recorded, never fetched.
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { createPart, partDir, PARTS_DIR, readPart, type Part } from "../core/library.js"
import { FootprintFileSchema } from "../engine/footprints/file.js"
import { parse } from "yaml"
import { FOOTPRINT_FILE } from "../core/library.js"

export interface AttachDatasheetInput {
  part: string
  url: string
  title?: string
  pages?: string
}

export interface AttachDatasheetResult {
  id: string
  part: Part
  files: string[]
  /** The checklist item that names the source. */
  item: string
}

const NOTES_HEADING = "## Notes"

/** The link as recorded: http(s) only, so nothing else (file:, data:, javascript:) ever lands in a part. */
export function datasheetUrl(text: string): string {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error("The datasheet link must be a full http(s) URL, e.g. https://www.example.com/part.pdf")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The datasheet link must be an http(s) URL")
  return url.href
}

/** Records the datasheet on a part; refuses a verified part, since that would void what a person checked. */
export async function attachDatasheet(root: string, input: AttachDatasheetInput, now: string): Promise<AttachDatasheetResult> {
  const url = datasheetUrl(input.url)
  const current = await readPart(root, input.part)
  const dir = partDir(root, input.part)
  const { datasheet_pages: _pages, verified: _verified, ...rest } = current
  const part: Part = {
    ...rest,
    datasheet: { ...(current.datasheet?.file ? { file: current.datasheet.file } : {}), url, title: input.title?.trim() || url },
    ...(input.pages?.trim() ? { datasheet_pages: input.pages.trim() } : {}),
  }
  const footprintFile = part.footprint === FOOTPRINT_FILE ? FootprintFileSchema.parse(parse(await readFile(join(dir, FOOTPRINT_FILE), "utf8"))) : undefined
  const notes = await keptNotes(join(dir, "verification.md"))
  // createPart refuses a verified part and checks every field again before it writes anything.
  const written = await createPart(root, input.part, part, { replace: true, now, notes, ...(footprintFile ? { footprintFile } : {}) })
  const pages = part.datasheet_pages === undefined ? "" : `, page(s) ${part.datasheet_pages}`
  return { id: input.part, part: written.part, files: written.files, item: `Pins from ${part.datasheet?.title}${pages}: compare each pin` }
}

/** The notes the checklist already carries (what an import approximated, a placeholder footprint), kept on a rewrite. */
export async function keptNotes(path: string): Promise<string[]> {
  const text = await readFile(path, "utf8").catch(() => "")
  const start = text.indexOf(`\n${NOTES_HEADING}\n`)
  if (start < 0) return []
  return text
    .slice(start + NOTES_HEADING.length + 2)
    .split("\n")
    .map((line) => /^- \[[ x]\] (.+)$/.exec(line)?.[1])
    .filter((note): note is string => note !== undefined)
}

/** A few lines for the agent: what was recorded and what the person checks. */
export function formatAttach(result: AttachDatasheetResult): string {
  return [
    `Attached the datasheet to ${result.id}: ${result.part.datasheet?.url}${result.part.datasheet_pages ? ` (pages ${result.part.datasheet_pages})` : ""}.`,
    `Wrote ${result.files.join(", ")}.`,
    `verification.md now asks: ${result.item}. The part stays NOT verified until the human checks it (${PARTS_DIR}/${result.id}/verification.md).`,
  ].join("\n")
}
