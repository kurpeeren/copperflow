// Import board: the outline, mounting holes and inner shapes of a DXF or SVG drawing (board-import-svg.ts) written to
// a circuit's board as one history entry (board-shape-edit.ts). The agent's fit_board { drawing }, the CLI's `copperflow board
// --dxf | --svg` and the Studio's File → Import board all call importBoard and show formatBoardImport's lines.
import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { pointInPolygon } from "../engine/checks/geometry.js"
import { boardFromDxf, DxfError, type BoardFromDrawing, type BoardFromDrawingOptions } from "../engine/dxf/index.js"
import { boardFromSvg, SvgBoardError } from "./board-import-svg.js"
import { scanCircuit } from "./analyze.js"
import { boardShapeItems } from "./board-shape-edit.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { EditError } from "./edit-error.js"
import type { Author, HistoryEntry } from "./history.js"
import { editCircuit, loadCircuit, projectPath, resolveInRoot } from "./workspace.js"

export interface ImportBoardOptions {
  /** A DXF or SVG file (by its ".svg" name) inside the project, or a drawing's name and text (the Studio sends the file it picked). */
  dxf: string | { name: string; text: string }
  layer?: string | undefined
  units?: "mm" | "inch" | undefined
  origin?: "centre" | "keep" | undefined
  replace?: boolean | undefined
}

export interface ImportBoardResult {
  entry: HistoryEntry
  /** The drawing's file name, as the answer names it. */
  name: string
  board: BoardFromDrawing
  /** The holes and keepouts the board had before, now replaced. */
  replaced: { holes: number; keepouts: number }
  /** Placed parts with a pad outside the new outline; undefined when the board could not be rebuilt. */
  outside?: string[]
  /** Why the board could not be rebuilt after the write. */
  buildError?: string
}

/** The listed hole positions at most; the rest are counted. */
const MAX_LISTED = 20

async function drawingText(root: string, dxf: ImportBoardOptions["dxf"]): Promise<{ name: string; text: string }> {
  if (typeof dxf !== "string") return dxf
  const path = resolveInRoot(root, dxf)
  try {
    return { name: projectPath(root, dxf), text: await readFile(path, "utf8") }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new EditError("not_found", `There is no file ${dxf} in the project folder`)
    throw error
  }
}

/** Placed parts (not those the engine put down itself) with a pad whose centre is outside the outline. */
async function partsOutside(root: string, file: string, outline: BoardFromDrawing["outline"], engine: DesignSource | undefined): Promise<string[]> {
  const design = await buildWith(root, file, engine)
  return design.pcb.parts
    .filter((part) => !part.autoPlaced && [{ x: part.x, y: part.y }, ...part.pads.map((pad) => ({ x: pad.x, y: pad.y }))].some((p) => !pointInPolygon(p, outline)))
    .map((part) => part.component)
}

/**
 * Reads the drawing and writes its board to `file` as one history entry. Refuses a drawing outside the project, one
 * that gives no clear outline, and a board that has holes or keepouts already unless `replace`.
 */
export async function importBoard(root: string, file: string, options: ImportBoardOptions, meta: { author: Author; engine?: DesignSource }): Promise<ImportBoardResult> {
  const drawing = await drawingText(root, options.dxf)
  const read: BoardFromDrawingOptions = {
    ...(options.layer !== undefined ? { layer: options.layer } : {}),
    ...(options.units !== undefined ? { units: options.units } : {}),
    ...(options.origin !== undefined ? { origin: options.origin } : {}),
  }
  let board: BoardFromDrawing
  try {
    board = /\.svg$/i.test(drawing.name) ? boardFromSvg(drawing.text, read) : boardFromDxf(drawing.text, read)
  } catch (error) {
    if (error instanceof DxfError || error instanceof SvgBoardError) throw new EditError("invalid", `${basename(drawing.name)}: ${error.message}`)
    throw error
  }
  const loaded = await loadCircuit(root, file)
  const replaced = options.replace ? boardShapeItems(loaded.source, scanCircuit(loaded.source)) : { holes: 0, keepouts: 0 }
  const name = basename(drawing.name)
  const edit = { kind: "setBoardShape" as const, outline: board.outline, holes: board.holes, keepouts: board.keepouts, replace: options.replace === true }
  const result = await editCircuit(root, loaded.file, [edit], { author: meta.author, summary: `board outline from ${name}`, ...(meta.engine ? { engine: meta.engine } : {}) })
  const base = { entry: result.entry, name, board, replaced }
  try {
    return { ...base, outside: await partsOutside(root, loaded.file, board.outline, meta.engine) }
  } catch (error) {
    return { ...base, buildError: (error as Error).message }
  }
}

const mm = (n: number) => String(Math.round(n * 1e4) / 1e4)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const UNIT_WORDS = { mm: "mm", cm: "cm", m: "m", inch: "inches" } as const

function unitsWords(units: BoardFromDrawing["units"]): string {
  const name = UNIT_WORDS[units.name]
  if (units.from === "assumed") return "drawing in mm, assumed as the file names no units"
  return units.from === "asked" ? `drawing read in ${name} as asked` : `drawing in ${name}`
}

/** "4 holes: 3.2 mm at (-37, -23), (37, -23); 2.5 mm at (0, 0)", up to MAX_LISTED positions. */
function holesLine(holes: BoardFromDrawing["holes"]): string {
  const byDiameter = new Map<number, string[]>()
  let listed = 0
  for (const hole of holes) {
    if (listed === MAX_LISTED) break
    byDiameter.set(hole.diameter, [...(byDiameter.get(hole.diameter) ?? []), `(${mm(hole.x)}, ${mm(hole.y)})`])
    listed++
  }
  const groups = [...byDiameter].map(([diameter, at]) => `${mm(diameter)} mm at ${at.join(", ")}`).join("; ")
  const more = holes.length > listed ? ` … and ${holes.length - listed} more` : ""
  return `${plural(holes.length, "hole")}: ${groups}${more}`
}

/** The answer's lines: what the board now is, its holes and inner shapes, what was replaced, not used, or now off the board. */
export function formatBoardImport(result: ImportBoardResult): string[] {
  const { board } = result
  const where = board.offset.x === 0 && board.offset.y === 0 ? "not moved" : `moved by ${mm(board.offset.x)}, ${mm(board.offset.y)}`
  const lines = [`Change ${result.entry.id}: board outline from ${result.name}: ${board.outline.length} corners, ${mm(board.width)} x ${mm(board.height)} mm (${unitsWords(board.units)}, ${where})`]
  if (board.holes.length > 0) lines.push(holesLine(board.holes))
  if (board.keepouts.length > 0) {
    const ids = board.keepouts.map((_, i) => `keepout:${i + 1}`).join(", ")
    lines.push(`${plural(board.keepouts.length, "inner shape")} kept clear as ${ids} (not cut out of the board)`)
  }
  const { holes, keepouts } = result.replaced
  if (holes + keepouts > 0) lines.push(`Replaced the board's ${[holes > 0 ? plural(holes, "hole") : "", keepouts > 0 ? plural(keepouts, "keepout") : ""].filter((w) => w !== "").join(" and ")}.`)
  if (board.notUsed.length > 0) lines.push(`Not used: ${board.notUsed.join(", ")}`)
  if (result.outside && result.outside.length > 0) {
    const count = result.outside.length
    lines.push(`${plural(count, "placed part")} ${count === 1 ? "is" : "are"} now outside the outline: ${result.outside.join(", ")}; move ${count === 1 ? "it" : "them"} inside`)
  }
  if (result.buildError) lines.push(`The board was written, but it could not be rebuilt: ${result.buildError}`)
  return lines
}
