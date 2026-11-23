// A picture of a circuit's board or of one schematic page, for the CLI and the MCP server: builds the design and hands
// it to the Studio's renderer, bundled to dist/render/render.js (studio/src/render/node-render.ts), which draws it with
// the Studio's own drawing code on a canvas from the optional package @napi-rs/canvas; the board as made (view "board")
// is drawn from the fabrication layers instead (src/engine/fab/picture). Also writes the picture for the CLI.
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, relative, resolve, sep } from "node:path"
import type { Design } from "../engine/design.js"
import type { DesignDiff } from "../engine/design-diff.js"
import { renderBoardView } from "../engine/fab/picture/board-view.js"
import type { Side } from "../engine/fab/picture/board-picture.js"
import type { LookRequest } from "../engine/fab/picture/looks.js"
import type { CanvasLoader } from "../engine/fab/picture/png.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { assertLandsInProject } from "./fabrication.js"
import type { Modeller } from "./model-export.js"
import type { ReferenceRecord } from "./layout-references.js"
import { resolveCircuit, resolveInRoot } from "./workspace.js"

/** What to draw; the Studio's renderer defines the same. */
export interface RenderRequest {
  /** "board": the bare board as made, from the fabrication layers. */
  view: "pcb" | "schematic" | "board" | "3d"
  /** The board view's side; refused for the others. */
  side?: Side
  /** The look of the board and 3d views; refused for the others. */
  look?: LookRequest
  /** View 3d's angle: top, bottom, front or iso (the default). */
  angle?: "top" | "bottom" | "front" | "iso"
  /** The schematic page; the first one when left out. Refused for the PCB. */
  page?: string
  /** Zoom to these parts (their courtyards plus a margin) instead of the whole board or sheet. */
  parts?: string[]
  /** Width of the image in pixels, 320 to 2000 (4000 for the board); 1024 by default. The height follows the drawing's shape. */
  width?: number
  /** A change marked over the dimmed board, and the words the line ends with (change-render.ts). The PCB only. */
  change?: { diff: DesignDiff; caption: string }
  /** Draw the shown reference images under the PCB (references.ts). The PCB only. */
  reference?: boolean
}

/** What the renderer is handed for the reference images: each with its file's bytes. */
export type Underlay = { record: ReferenceRecord; bytes: Uint8Array }[]

/** The picture and one line saying what it shows. */
export interface Rendered {
  png: Uint8Array
  width: number
  height: number
  what: string
  /** The schematic page drawn; none for the PCB. */
  page?: string
  /** What the line names in place of the file: the design's name for the board view. */
  label?: string
}

export interface Renderer extends Modeller {
  renderDesign(design: Design, request: Omit<RenderRequest, "reference"> & { underlay?: Underlay }): Promise<Rendered>
}

export interface RenderOptions {
  /** A design that is already built; no engine is used. */
  design?: Design
  /** Builds the design when none is given. Without one, a new engine is started and stopped afterwards. */
  engine?: DesignSource
  /** Loads the renderer; tests pass the source module. Without it the bundled dist/render/render.js is loaded. */
  renderer?: () => Promise<Renderer>
  /** Loads the canvas package for the board view; tests pass one that fails. */
  canvas?: CanvasLoader
}

export const CANVAS_MISSING =
  "Rendering needs the optional package @napi-rs/canvas, which is not installed here. Install it (npm install -g @napi-rs/canvas) and try again."

/** The bundle sits beside dist/core: dist/render/render.js. Its path is built at run time, so tsc leaves it alone. */
const bundledRenderer = (): Promise<Renderer> => import(new URL("../render/render.js", import.meta.url).href) as Promise<Renderer>

/** Whether the error is the canvas package (or its native binary for this platform) not being found. */
function canvasMissing(error: unknown): boolean {
  const { code, message } = error as { code?: unknown; message?: unknown }
  const text = typeof message === "string" ? message : ""
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return text.includes("@napi-rs/canvas")
  return /native binding/i.test(text) && text.includes("@napi-rs/canvas")
}

/** Builds the circuit and draws the requested view of it; the canvas package missing is said in plain words. */
export async function renderCircuit(root: string, file: string, request: RenderRequest, options: RenderOptions = {}): Promise<Rendered & { file: string }> {
  const { file: circuit } = await resolveCircuit(root, file)
  if (request.view === "3d" && request.side !== undefined) throw new Error("side is for view board only; view 3d takes angle")
  if (request.view !== "3d" && request.angle !== undefined) throw new Error("angle is for view 3d only")
  if (request.view !== "board" && request.view !== "3d" && (request.side !== undefined || request.look !== undefined)) throw new Error("side and look are for view board only")
  if (request.reference && request.view !== "pcb") throw new Error("reference is for view pcb only: the reference images lie under the PCB")
  const design = options.design ?? (await buildWith(root, circuit, options.engine))
  try {
    const { reference, ...drawn } = request
    if (drawn.view === "board") return { ...(await renderBoardView(design, drawn, options.canvas)), file: circuit }
    const underlay = reference ? await underlayOf(root, design) : undefined
    const renderer = await (options.renderer ?? bundledRenderer)()
    const rendered = await renderer.renderDesign(design, underlay ? { ...drawn, underlay: underlay.images } : drawn)
    return { ...rendered, ...(underlay ? { what: `${rendered.what}; ${underlay.words}` } : {}), file: circuit }
  } catch (error) {
    if (canvasMissing(error)) throw new Error(CANVAS_MISSING)
    throw error
  }
}

/** The shown reference images with their bytes, and the words saying what lies under the board. */
async function underlayOf(root: string, design: Design): Promise<{ images: Underlay; words: string }> {
  const shown = (design.references ?? []).filter((r) => r.shown)
  if (shown.length === 0) return { images: [], words: (design.references ?? []).length === 0 ? "no reference image (add one with import_graphic, layer reference)" : "every reference image is hidden" }
  const images: Underlay = []
  const missing: string[] = []
  for (const record of shown) {
    const bytes = await readFile(resolveInRoot(root, record.file)).catch(() => undefined)
    if (bytes) images.push({ record, bytes: new Uint8Array(bytes) })
    else missing.push(`${record.id}'s ${record.file} is missing`)
  }
  const drawn = images.map((i) => `${i.record.id} (${i.record.points.length} point${i.record.points.length === 1 ? "" : "s"})`)
  return { images, words: [drawn.length > 0 ? `under it reference ${drawn.join(", ")}` : "", ...missing].filter((w) => w !== "").join("; ") }
}

/** The one-line answer: `io.circuit.tsx: PCB, whole board 32.3 x 23.6 mm; 1024 x 748 px`. */
export const renderedLine = (rendered: Rendered & { file: string }): string => `${rendered.label ?? rendered.file}: ${rendered.what}; ${rendered.width} x ${rendered.height} px`

/** `<name>-pcb.png`, `<name>-board-<side>.png` or `<name>-schematic-<page>.png` beside the circuit, the page made safe for a file name. */
export function defaultPictureName(circuit: string, view: RenderRequest["view"], page: string | undefined, side: Side = "top", angle = "iso"): string {
  const name = basename(circuit).replace(/\.(circuit|sheet)\.tsx$/, "")
  const suffix = view === "pcb" ? "pcb" : view === "board" ? `board-${side}` : view === "3d" ? `3d-${angle}` : `schematic-${(page ?? "Main").replace(/[^A-Za-z0-9_-]+/g, "-")}`
  const folder = dirname(circuit)
  return `${folder === "." ? "" : `${folder}/`}${name}-${suffix}.png`
}

/** Draws the picture and writes it into the project (refusing a path outside it); answers the CLI's line. */
export async function writeRender(root: string, file: string, request: RenderRequest, out: string | undefined, options: RenderOptions = {}): Promise<string> {
  if (out !== undefined && !out.toLowerCase().endsWith(".png")) throw new Error(`--out must name a .png file, not ${out}`)
  if (out !== undefined) await assertLandsInProject(root, resolve(root, out))
  const rendered = await renderCircuit(root, file, request, options)
  const target = resolve(root, out ?? defaultPictureName(rendered.file, request.view, rendered.page, request.side, request.angle))
  await assertLandsInProject(root, target)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, rendered.png)
  const shown = relative(resolve(root), target).split(sep).join("/")
  return `Wrote ${shown} (${rendered.width} x ${rendered.height} px): ${rendered.what}`
}
