// What the Verify screen reads and writes: the part with the pads the build uses, ticks in verification.md, the
// refusal of Mark verified while items are open, and the part's own datasheet PDF. Only the Studio's routes call
// these: no agent tool ticks an item or marks a part. The Studio never fetches a remote address here.
import { readFile, realpath, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { checklistContent, checklistItems, openItems, ticksCurrent, withoutTicks, withTicks } from "../core/checklist-text.js"
import { isInside } from "../core/file-writes.js"
import { writeFileAtomic } from "../core/fs-utils.js"
import { contentHash, DATASHEET_FILE, FOOTPRINT_FILE, isVerified, PARTS_DIR, partDir, placeholderRefusal, readFootprintText, readPart, type Part } from "../core/library.js"
import { footprintFromFile } from "../engine/footprints/file.js"
import { generateFootprint } from "../engine/footprints/index.js"
import type { Footprint } from "../engine/footprints/types.js"
import { HttpError } from "./http-error.js"

const CHECKLIST = "verification.md"
/** A datasheet PDF larger than this is not served. */
const MAX_PDF_BYTES = 64 * 1024 * 1024

export interface PartScreen {
  id: string
  part: Part
  checklist: string
  /** The content hash of part.yaml and footprint.yaml now; ticks count for it only. */
  hash: string
  verified: boolean
  footprint?: Footprint
  footprintError?: string
  /** Why the part cannot be verified while its footprint.yaml is a placeholder. */
  placeholder?: string
}

/** The part as the Verify screen shows it: the same pads the build uses (footprint.yaml, else the generated footprint). */
export async function partScreen(root: string, id: string): Promise<PartScreen> {
  const part = await readPart(root, id)
  const footprintText = await readFootprintText(root, id, part)
  const checklist = await readFile(join(partDir(root, id), CHECKLIST), "utf8").catch(() => "")
  const drawn = footprintText === undefined ? generateFootprint(part.footprint) : footprintFromFile(`${PARTS_DIR}/${id}/${FOOTPRINT_FILE}`, footprintText)
  return {
    id,
    part,
    checklist,
    hash: contentHash(part, footprintText),
    verified: isVerified(part, footprintText),
    ...("error" in drawn ? { footprintError: drawn.error } : { footprint: drawn }),
    ...(!("error" in drawn) && drawn.placeholder ? { placeholder: placeholderRefusal(id) } : {}),
  }
}

export interface TickRequest {
  id: string
  items: string[]
  ticked: boolean
  /** The text of verification.md the page showed; another text is refused. */
  shown: string
}

/**
 * Ticks (or unticks) items of verification.md by their text. Answers `changed` with the file's text when it is not
 * the text the page showed. Ticks made before the part changed are cleared first, so they never count for new content.
 */
export async function tickChecklist(root: string, request: TickRequest): Promise<{ checklist: string } | { changed: string }> {
  const { id } = request
  const path = join(partDir(root, id), CHECKLIST)
  const text = await readChecklist(path, id)
  if (text !== request.shown) return { changed: text }
  const part = await readPart(root, id)
  const footprintText = await readFootprintText(root, id, part)
  if (isVerified(part, footprintText)) throw new HttpError(400, `Part ${id} is verified; its checklist is closed`)
  if (checklistContent(text) === undefined) {
    throw new HttpError(400, `${PARTS_DIR}/${id}/${CHECKLIST} has no "Content:" line, so a tick cannot be tied to the part; write the part again to get a new checklist`)
  }
  const hash = contentHash(part, footprintText)
  const base = ticksCurrent(text, hash) ? text : withoutTicks(text, hash)
  const next = withTicks(base, request.items, request.ticked)
  if ("missing" in next) throw new HttpError(400, `${CHECKLIST} has no item "${(next.missing[0] ?? "").slice(0, 200)}"`)
  await writeFileAtomic(path, next.text)
  return { checklist: next.text }
}

/** Why the Studio may not mark the part verified yet (items open for its content now), or undefined when all are ticked. */
export async function checklistRefusal(root: string, id: string): Promise<string | undefined> {
  const text = await readChecklist(join(partDir(root, id), CHECKLIST), id)
  const part = await readPart(root, id)
  const open = openItems(text, contentHash(part, await readFootprintText(root, id, part)))
  if (open.length === 0) return undefined
  const all = checklistItems(text).length
  return `${open.length} of ${all} item${all === 1 ? "" : "s"} of ${CHECKLIST} ${open.length === 1 ? "is" : "are"} not ticked for the part as it is now; tick each one on the Verify screen first`
}

async function readChecklist(path: string, id: string): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, `${PARTS_DIR}/${id}/${CHECKLIST} is missing`)
    throw error
  }
}

/**
 * The part's own datasheet PDF: only the file named in part.yaml, a real file in the part's real folder (a link
 * that leads out is refused), and only when it starts as a PDF does.
 */
export async function datasheetPdf(root: string, id: string, file: string): Promise<{ name: string; bytes: Buffer }> {
  const part = await readPart(root, id)
  const recorded = part.datasheet?.file
  if (recorded === undefined) throw new HttpError(404, `Part ${id} records no datasheet file`)
  if (file !== recorded) throw new HttpError(404, `"${file.slice(0, 100)}" is not the datasheet file recorded for part ${id}`)
  const shown = `${PARTS_DIR}/${id}/${recorded}`
  if (!DATASHEET_FILE.test(recorded) || recorded.includes("..")) throw new HttpError(400, `${shown} is not a PDF file name`)
  const folder = await realpath(partDir(root, id))
  // The part's own folder must be in the project too: a parts/<id> that is a link out is not served from.
  if (!isInside(await realpath(root), folder)) throw new HttpError(403, `${PARTS_DIR}/${id} leads out of the project`)
  const target = await realpath(join(folder, recorded)).catch(() => undefined)
  if (target === undefined) throw new HttpError(404, `${shown} is not there`)
  if (dirname(target) !== folder) throw new HttpError(403, `${shown} leads out of the part's folder`)
  const info = await stat(target)
  if (!info.isFile()) throw new HttpError(404, `${shown} is not a file`)
  if (info.size > MAX_PDF_BYTES) throw new HttpError(413, `${shown} is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB`)
  const bytes = await readFile(target)
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new HttpError(415, `${shown} is not a PDF`)
  return { name: recorded, bytes }
}
