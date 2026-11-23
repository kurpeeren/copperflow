// Reference images: a photo or scan (PNG or JPEG) of either side of an existing board, or a Gerber copper or silkscreen
// layer, kept in the project's references/ folder and drawn under the PCB to redraw that board. Each is a line in the
// circuit's layout file (layout-references.ts), written as one history entry; points picked on it (a pixel and the
// board point it belongs on) scale, turn and straighten it (engine/reference-fit.ts). Never made: no Gerber, drill,
// BOM, pick-and-place or 3D file reads it. The agent's import_graphic (layer "reference") and the Studio's Layer panel
// call addReference, setReference and removeReference, and show formatReference.
import { lstat, mkdir, readFile, realpath, rm } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import { fitReference, type BoardFrame, type ReferenceFit, type ReferencePoint } from "../engine/reference-fit.js"
import { GerberError, gerberToSvg, isGerberName } from "../engine/fab/gerber-svg.js"
import { EditError } from "./edit-error.js"
import { inProjectQueue, isInside, readIfThere, writeNew, writeWithHistory } from "./file-writes.js"
import { writeFileAtomic } from "./fs-utils.js"
import type { Author, HistoryEntry } from "./history.js"
import { imageSize } from "./image-size.js"
import { EMPTY_LAYOUT, layoutPathFor, readLayoutText, serializeLayout, type LayoutDoc } from "./layout-file.js"
import { checkReference, DEFAULT_OPACITY, MAX_REFERENCE_POINTS, nextReferenceId, type ReferenceRecord } from "./layout-references.js"
import { loadCircuit, projectPath, resolveCircuit, resolveInRoot, resolveLayoutFile } from "./workspace.js"

/** The largest image or Gerber file taken, in bytes. */
export const MAX_REFERENCE_BYTES = 8 * 1024 * 1024
const MAX_RENAMES = 100
export const REFERENCE_FOLDER = "references"

/** What a reference's look and place may be changed to. */
export interface ReferenceChanges {
  mirror?: boolean | undefined
  points?: ReferencePoint[] | undefined
  opacity?: number | undefined
  shown?: boolean | undefined
}

export interface AddReferenceOptions extends ReferenceChanges {
  /** A file inside the project, or a file's name and bytes (the Studio sends the file a person picked). */
  source: string | { name: string; bytes: Uint8Array }
}

export interface ReferenceResult {
  entry: HistoryEntry
  record: ReferenceRecord
  /** Where it lies now, and how well it meets its points. */
  fit: ReferenceFit
  /** What a Gerber layer had that is not drawn. */
  skipped: string[]
  /** "add", "change" or "remove". */
  action: "add" | "change" | "remove"
}

interface Meta {
  author: Author
}

/** The real path of a project file, refused when it is missing, not a file, too large or (through a link) outside the project. */
async function readSource(root: string, source: string): Promise<{ name: string; bytes: Uint8Array }> {
  const path = resolveInRoot(root, source)
  const found = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new EditError("not_found", `There is no file ${source} in the project folder; copy the image there first`)
    throw error
  })
  const real = await realpath(path)
  if (!isInside(await realpath(resolve(root)), real)) throw new EditError("invalid", `${source} leads outside the project folder; copy the image into the project`)
  const target = found.isSymbolicLink() ? await lstat(real) : found
  if (!target.isFile()) throw new EditError("invalid", `${source} is not a file; give the path of a .png, .jpg or Gerber file`)
  if (target.size > MAX_REFERENCE_BYTES) throw new EditError("invalid", `${source} is larger than ${MAX_REFERENCE_BYTES / 1024 / 1024} MB; make it smaller`)
  return { name: projectPath(root, source), bytes: new Uint8Array(await readFile(real)) }
}

/** The image to keep: the file itself for a PNG, JPEG or SVG, or the SVG drawn from a Gerber layer. */
function imageOf(name: string, bytes: Uint8Array): { bytes: Uint8Array; ext: string; width: number; height: number; pixel?: number; source?: string; skipped: string[] } {
  if (bytes.length > MAX_REFERENCE_BYTES) throw new EditError("invalid", `${basename(name)} is larger than ${MAX_REFERENCE_BYTES / 1024 / 1024} MB; make it smaller`)
  const size = imageSize(bytes)
  if (size) return { bytes, ext: size.kind === "jpeg" ? ".jpg" : `.${size.kind}`, width: size.width, height: size.height, skipped: [] }
  const text = new TextDecoder().decode(bytes)
  if (!isGerberName(name) && !text.includes("%FS")) throw new EditError("invalid", `${basename(name)} is not a reference image: give a .png or .jpg photo or scan, or a Gerber layer`)
  try {
    const picture = gerberToSvg(text)
    return { bytes: new TextEncoder().encode(picture.svg), ext: ".svg", width: picture.width, height: picture.height, pixel: picture.pixel, source: basename(name), skipped: picture.skipped }
  } catch (error) {
    if (error instanceof GerberError) throw new EditError("invalid", `${basename(name)}: ${error.message}`)
    throw error
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

/** references/<name><ext>, numbered when that holds a different image. */
async function keptAt(root: string, name: string, ext: string, bytes: Uint8Array): Promise<string> {
  const clean = basename(name.replaceAll("\\", "/")).replace(/[^A-Za-z0-9._ -]/g, "-")
  const stem = clean.replace(/\.[^.]*$/, "") || "reference"
  for (let n = 1; n <= MAX_RENAMES; n++) {
    const candidate = `${REFERENCE_FOLDER}/${stem}${n === 1 ? "" : `-${n}`}${ext}`
    const there = await readFile(resolveInRoot(root, candidate)).catch(() => undefined)
    if (there === undefined || sameBytes(new Uint8Array(there), bytes)) return candidate
  }
  throw new EditError("invalid", `${REFERENCE_FOLDER}/ already holds ${MAX_RENAMES} images named ${stem}; rename the file`)
}

/** Refuses a change no record could take. */
function checkChanges(changes: ReferenceChanges): void {
  if (changes.opacity !== undefined && !(changes.opacity >= 0 && changes.opacity <= 1)) throw new EditError("invalid", "opacity is from 0 (clear) to 1 (solid)")
  if (changes.points !== undefined && changes.points.length > MAX_REFERENCE_POINTS) throw new EditError("invalid", `give at most ${MAX_REFERENCE_POINTS} points`)
  const bad = changes.points?.findIndex((p) => ![p.image.x, p.image.y, p.board.x, p.board.y].every(Number.isFinite)) ?? -1
  if (bad >= 0) throw new EditError("invalid", `points[${bad}] needs finite numbers`)
}

/** The record with the changes made, checked as the file would read it. */
function changed(record: ReferenceRecord, changes: ReferenceChanges): ReferenceRecord {
  const { mirror, points, opacity, shown } = changes
  const defined = Object.fromEntries(Object.entries({ mirror, points, opacity, shown }).filter(([, value]) => value !== undefined))
  const result = checkReference({ ...record, ...defined })
  if ("problems" in result) throw new EditError("invalid", `${record.id}: ${result.problems.join("; ")}`)
  return result.record
}

/** The board's centre and width, which place an image that has no points yet. */
async function boardFrame(root: string, file: string): Promise<BoardFrame | undefined> {
  const box = (await loadCircuit(root, file)).model.boardBox
  return box ? { centre: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, width: box.maxX - box.minX } : undefined
}

/** Writes the layout file with `edit` applied to its references, as one history entry; the edit answers the record it made or changed. */
async function writeReferences(
  root: string,
  file: string,
  summary: (doc: LayoutDoc) => string,
  edit: (references: readonly ReferenceRecord[]) => { references: ReferenceRecord[]; record: ReferenceRecord },
  meta: Meta,
): Promise<{ entry: HistoryEntry; record: ReferenceRecord }> {
  const circuit = await resolveCircuit(root, file)
  const layout = await resolveLayoutFile(root, layoutPathFor(circuit.file))
  return inProjectQueue(root, async () => {
    const source = await readIfThere(layout.path)
    const before = source === undefined ? EMPTY_LAYOUT : readLayoutText(source, layout.file)
    const { references, record } = edit(before.references ?? [])
    const after: LayoutDoc = { next: before.next, records: before.records, ...(references.length > 0 ? { references } : {}) }
    const text = serializeLayout(after)
    if (text === (source ?? "")) throw new EditError("invalid", "The change made no change")
    const data = { author: meta.author, summary: summary(after) }
    const entry = source === undefined ? await writeNew(root, layout.path, text, data) : await writeWithHistory(root, { ...layout, source }, text, { ...data, file: layout.file, before: source, after: text })
    return { entry, record }
  })
}

const find = (references: readonly ReferenceRecord[], id: string): ReferenceRecord => {
  const record = references.find((r) => r.id === id)
  if (!record) throw new EditError("not_found", `There is no reference image ${id}${references.length > 0 ? `; there are ${references.map((r) => r.id).join(", ")}` : ""}`)
  return record
}

/** Keeps the image under references/ and writes its line, as one history entry. */
export async function addReference(root: string, file: string, options: AddReferenceOptions, meta: Meta): Promise<ReferenceResult> {
  checkChanges(options)
  const given = typeof options.source === "string" ? await readSource(root, options.source) : options.source
  const image = imageOf(given.name, given.bytes)
  const kept = await keptAt(root, image.source ?? given.name, image.ext, image.bytes)
  const path = resolveInRoot(root, kept)
  const created = (await readFile(path).catch(() => undefined)) === undefined
  if (created) {
    await mkdir(dirname(path), { recursive: true })
    await writeFileAtomic(path, image.bytes)
  }
  try {
    const { entry, record } = await writeReferences(
      root,
      file,
      () => `add reference image ${kept}`,
      (references) => {
        const fresh = changed(
          { t: "reference", id: nextReferenceId(references), file: kept, ...(image.source ? { source: image.source } : {}), width: image.width, height: image.height, mirror: false, points: [], ...(image.pixel ? { pixel: image.pixel } : {}), opacity: DEFAULT_OPACITY, shown: true },
          options,
        )
        return { references: [...references, fresh], record: fresh }
      },
      meta,
    )
    return { entry, record, fit: fitReference(record, await boardFrame(root, file)), skipped: image.skipped, action: "add" }
  } catch (error) {
    if (created) await rm(path, { force: true })
    throw error
  }
}

/** Changes a reference's points, mirror, opacity or shown, as one history entry. */
export async function setReference(root: string, file: string, id: string, changes: ReferenceChanges, meta: Meta): Promise<ReferenceResult> {
  checkChanges(changes)
  const { entry, record } = await writeReferences(
    root,
    file,
    () => `change reference image ${id}`,
    (references) => {
      const next = changed(find(references, id), changes)
      return { references: references.map((r) => (r.id === id ? next : r)), record: next }
    },
    meta,
  )
  return { entry, record, fit: fitReference(record, await boardFrame(root, file)), skipped: [], action: "change" }
}

/** Takes a reference's line out, as one history entry; its image stays in references/ so an undo brings it back. */
export async function removeReference(root: string, file: string, id: string, meta: Meta): Promise<ReferenceResult> {
  const { entry, record } = await writeReferences(
    root,
    file,
    () => `remove reference image ${id}`,
    (references) => {
      const gone = find(references, id)
      return { references: references.filter((r) => r.id !== id), record: gone }
    },
    meta,
  )
  return { entry, record, fit: fitReference(record, await boardFrame(root, file)), skipped: [], action: "remove" }
}

const mm = (n: number) => String(Math.round(n * 100) / 100)

const FIT_WORDS: Record<ReferenceFit["kind"], string> = {
  placed: "placed at a set scale (pick two or more points to scale and turn it)",
  similar: "scaled, turned and moved onto the points",
  perspective: "fitted to the points in perspective, which takes out a photo's slant",
}

/** The answer's lines: what was done, the image's size, the fit and how far each point is off. */
export function formatReference(result: ReferenceResult): string[] {
  const { record, fit } = result
  const what = `reference image ${record.id} (${record.file}${record.source ? `, drawn from ${record.source}` : ""}, ${record.width} x ${record.height} px)`
  if (result.action === "remove") return [`Change ${result.entry.id}: removed ${what}. The image stays in ${REFERENCE_FOLDER}/; undo brings the reference back.`]
  const lines = [`Change ${result.entry.id}: ${result.action === "add" ? "added" : "changed"} ${what}${record.mirror ? ", mirrored" : ""}, ${Math.round(record.opacity * 100)}% opaque${record.shown ? "" : ", hidden"}.`]
  const points = record.points.length
  lines.push(`${points === 0 ? "No points" : `${points} point${points === 1 ? "" : "s"}`}: ${FIT_WORDS[fit.kind]}.${fit.note ? ` ${fit.note[0]?.toUpperCase()}${fit.note.slice(1)}.` : ""}`)
  if (points >= 2) lines.push(`Each point lands this far from its board point: ${fit.residuals.map((r, i) => `#${i + 1} ${mm(r)} mm`).join(", ")}.`)
  if (result.skipped.length > 0) lines.push(`Not drawn from the Gerber layer: ${result.skipped.join("; ")}.`)
  lines.push("It is drawn under the PCB only, never in Gerbers, drill files, BOM, pick-and-place or 3D. See it with render { reference: true }.")
  return lines
}
