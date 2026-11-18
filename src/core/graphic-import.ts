// Import a drawing: an SVG or DXF file placed on the board as a `<boardgraphic>`. The file is kept in the project's
// graphics/ folder (copied there when it is elsewhere in the project, or written there when the Studio sends the file
// a person picked), then the element is written as one history entry. The agent's import_graphic, the CLI's
// `copperflow graphic` and the Studio's File → Import a drawing all call importGraphic and show formatGraphicImport.
import { lstat, mkdir, readFile, realpath, rm } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import { GRAPHIC_FILE, graphicLayerProblem, leftOut, graphicScaleProblem, graphicWidthProblem, MAX_GRAPHIC_SIZE } from "../engine/board-graphic.js"
import { graphicKind, parseGraphic, type GraphicShapes } from "../engine/graphics/index.js"
import { newBoardItemId } from "./board-items.js"
import { EditError } from "./edit-error.js"
import { applyEdits } from "./edit.js"
import { isInside } from "./file-writes.js"
import { writeFileAtomic } from "./fs-utils.js"
import type { Author, HistoryEntry } from "./history.js"
import type { DesignSource as BuildSource } from "./design-source.js"
import { editCircuit, loadCircuit, projectPath, resolveInRoot } from "./workspace.js"

export interface ImportGraphicOptions {
  /** A drawing inside the project, or a drawing's name and text (the Studio sends the file it picked). */
  source: string | { name: string; text: string }
  layer: string
  /** The centre in mm; the board's centre when left out. */
  x?: number | undefined
  y?: number | undefined
  width?: number | undefined
  scale?: number | undefined
  rotation?: number | undefined
  fill?: boolean | undefined
  name?: string | undefined
}

export interface ImportGraphicResult {
  entry: HistoryEntry
  id: string
  /** The drawing's path in the project, under graphics/. */
  file: string
  layer: string
  at: { x: number; y: number }
  size: { width: number; height: number }
  skipped: string[]
}

/** The most numbered names tried for a file whose name is taken by a different drawing. */
const MAX_RENAMES = 100

/** The largest drawing file read, in bytes. */
export const MAX_GRAPHIC_FILE_BYTES = 4 * 1024 * 1024

/** The real path of a project file, refused when it is missing, not a plain file, too large, or (through a link) outside the project. */
async function realSource(root: string, source: string): Promise<string> {
  const path = resolveInRoot(root, source)
  const missing = () => new EditError("not_found", `There is no file ${source} in the project folder; write the drawing there first`)
  const found = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw missing()
    throw error
  })
  const real = await realpath(path)
  if (!isInside(await realpath(resolve(root)), real)) throw new EditError("invalid", `${source} leads outside the project folder; copy the drawing into the project`)
  const target = found.isSymbolicLink() ? await lstat(real) : found
  if (!target.isFile()) throw new EditError("invalid", `${source} is not a file; give the path of an .svg or .dxf file`)
  if (target.size > MAX_GRAPHIC_FILE_BYTES) throw new EditError("invalid", `${source} is larger than ${MAX_GRAPHIC_FILE_BYTES / 1024 / 1024} MB; simplify the drawing`)
  return real
}

async function sourceText(root: string, source: ImportGraphicOptions["source"]): Promise<{ name: string; text: string; inProject?: string }> {
  if (typeof source !== "string") return source
  const inProject = projectPath(root, source)
  return { name: inProject, text: await readFile(await realSource(root, source), "utf8"), inProject }
}

const readIfThere = (path: string) => readFile(path, "utf8").catch(() => undefined)

/** Where the drawing is kept: where it is when already in graphics/, else graphics/<its name>, numbered when that holds another drawing. */
async function keptAt(root: string, drawing: { name: string; text: string; inProject?: string }): Promise<string> {
  if (drawing.inProject !== undefined && GRAPHIC_FILE.test(drawing.inProject)) return drawing.inProject
  const clean = basename(drawing.name.replaceAll("\\", "/")).replace(/[^A-Za-z0-9._ -]/g, "-")
  const dot = clean.lastIndexOf(".")
  const [stem, ext] = [clean.slice(0, dot) || "drawing", clean.slice(dot).toLowerCase()]
  for (let n = 1; n <= MAX_RENAMES; n++) {
    const candidate = `graphics/${stem}${n === 1 ? "" : `-${n}`}${ext}`
    const there = await readIfThere(resolveInRoot(root, candidate))
    if (there === undefined || there === drawing.text) return candidate
  }
  throw new EditError("invalid", `graphics/ already holds ${MAX_RENAMES} drawings named ${stem}; rename the file`)
}

/** Refuses what the build would leave out, before anything is written. */
function checkOptions(options: ImportGraphicOptions, shapes: GraphicShapes): number {
  const problem =
    graphicLayerProblem(options.layer) ??
    (options.width !== undefined && options.scale !== undefined ? "give width or scale, not both" : undefined) ??
    (options.width === undefined ? undefined : graphicWidthProblem(options.width)) ??
    (options.scale === undefined ? undefined : graphicScaleProblem(options.scale))
  if (problem) throw new EditError("invalid", `${problem}. Nothing was written.`)
  const scale = options.scale ?? (options.width === undefined ? 1 : options.width / shapes.width)
  if (Math.max(shapes.width, shapes.height) * scale > MAX_GRAPHIC_SIZE) {
    throw new EditError("invalid", `At this size the drawing is ${(shapes.width * scale).toFixed(1)} x ${(shapes.height * scale).toFixed(1)} mm, larger than ${MAX_GRAPHIC_SIZE} mm; give a width. Nothing was written.`)
  }
  return scale
}

/** Writes the drawing to graphics/ when it is not there yet; true when this call created it. */
async function keepFile(root: string, kept: string, text: string): Promise<boolean> {
  const path = resolveInRoot(root, kept)
  if ((await readIfThere(path)) !== undefined) return false
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, text)
  return true
}

/** Reads the drawing, keeps it in graphics/ and writes the `<boardgraphic>` placing it, as one history entry. */
export async function importGraphic(root: string, file: string, options: ImportGraphicOptions, meta: { author: Author; engine?: BuildSource }): Promise<ImportGraphicResult> {
  const drawing = await sourceText(root, options.source)
  const kind = graphicKind(drawing.name)
  if (!kind) throw new EditError("invalid", `${basename(drawing.name)} is not a drawing: give an .svg or .dxf file`)
  const shapes = parseGraphic(drawing.text, kind)
  if ("error" in shapes) throw new EditError("invalid", `${basename(drawing.name)}: ${shapes.error}. Nothing was written.`)
  if (shapes.fills.length === 0 && shapes.strokes.length === 0) throw new EditError("invalid", `${basename(drawing.name)}: the drawing has nothing to draw${leftOut(shapes.skipped)}. Nothing was written.`)
  const scale = checkOptions(options, shapes)
  const loaded = await loadCircuit(root, file)
  const box = loaded.model.boardBox
  const at = { x: options.x ?? (box ? (box.minX + box.maxX) / 2 : 0), y: options.y ?? (box ? (box.minY + box.maxY) / 2 : 0) }
  const kept = await keptAt(root, drawing)
  const id = newBoardItemId(loaded.model.boardItems ?? [], "boardgraphic")
  const edit = {
    kind: "addBoardGraphic" as const,
    file: kept,
    layer: options.layer,
    ...at,
    ...(options.width === undefined ? {} : { width: options.width }),
    ...(options.scale === undefined ? {} : { scale: options.scale }),
    ...(options.rotation === undefined ? {} : { rotation: options.rotation }),
    ...(options.fill === undefined ? {} : { fill: options.fill }),
    ...(options.name === undefined ? {} : { name: options.name }),
  }
  // Every refusal the edit itself makes (a centre off the board, a bad prop) comes before the drawing is copied.
  const locked = new Set(loaded.annotations.locks.map((lock) => lock.part))
  try {
    applyEdits(loaded.source, [edit], locked)
  } catch (error) {
    throw new EditError("invalid", `${(error as Error).message.replace(/\.$/, "")}. Nothing was written.`)
  }
  const created = await keepFile(root, kept, drawing.text)
  const result = await editCircuit(root, loaded.file, [edit], { author: meta.author, summary: `add ${id} from ${kept} on the ${options.layer}`, ...(meta.engine ? { engine: meta.engine } : {}) }).catch(async (error: unknown) => {
    if (created) await rm(resolveInRoot(root, kept), { force: true })
    throw error
  })
  return { entry: result.entry, id, file: kept, layer: options.layer, at, size: { width: shapes.width * scale, height: shapes.height * scale }, skipped: shapes.skipped }
}

const mm = (n: number) => String(Math.round(n * 1e3) / 1e3)

/** The answer's lines: what was placed, where and how large, and what the reader left out. */
export function formatGraphicImport(result: ImportGraphicResult): string[] {
  const lines = [
    `Change ${result.entry.id}: ${result.id} from ${result.file} on the ${result.layer}, ${mm(result.size.width)} x ${mm(result.size.height)} mm, centred at (${mm(result.at.x)}, ${mm(result.at.y)})`,
  ]
  lines.push(result.skipped.length === 0 ? "Nothing in the file was left out." : `Left out of the file: ${result.skipped.join("; ")}`)
  lines.push(`The drawing is kept as ${result.file}; it stays there if the change is undone.`)
  if (["top", "bottom", "inner1", "inner2"].includes(result.layer)) {
    lines.push("On copper it belongs to no net: every net keeps clear of it. Its lines are checked against the minimum track width; thin parts of its filled shapes are not.")
  }
  lines.push("Colour is not read: every filled shape is ink (or an opening); white details over black come out solid unless drawn as holes in one path.")
  lines.push(`Move, resize or remove it with edit_circuit set_drawing / remove_drawing { "id": "${result.id}" }.`)
  return lines
}
