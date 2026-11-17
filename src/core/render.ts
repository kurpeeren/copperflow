// A picture of a circuit's board or of one schematic page, for the CLI and the MCP server: builds the design and hands
// it to the Studio's renderer, bundled to dist/render/render.js (studio/src/render/node-render.ts), which draws it with
// the Studio's own drawing code on a canvas from the optional package @napi-rs/canvas. Also writes the picture for the CLI.
import { mkdir, writeFile } from "node:fs/promises"
import { basename, dirname, relative, resolve, sep } from "node:path"
import type { Design } from "../engine/design.js"
import type { DesignDiff } from "../engine/design-diff.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { assertLandsInProject } from "./fabrication.js"
import { resolveCircuit } from "./workspace.js"

/** What to draw; the Studio's renderer defines the same. */
export interface RenderRequest {
  view: "pcb" | "schematic"
  /** The schematic page; the first one when left out. Refused for the PCB. */
  page?: string
  /** Zoom to these parts (their courtyards plus a margin) instead of the whole board or sheet. */
  parts?: string[]
  /** Width of the image in pixels, 320 to 2000; 1024 by default. The height follows the drawing's shape. */
  width?: number
  /** A change marked over the dimmed board, and the words the line ends with (change-render.ts). The PCB only. */
  change?: { diff: DesignDiff; caption: string }
}

/** The picture and one line saying what it shows. */
export interface Rendered {
  png: Uint8Array
  width: number
  height: number
  what: string
  /** The schematic page drawn; none for the PCB. */
  page?: string
}

export interface Renderer {
  renderDesign(design: Design, request: RenderRequest): Promise<Rendered>
}

export interface RenderOptions {
  /** A design that is already built; no engine is used. */
  design?: Design
  /** Builds the design when none is given. Without one, a new engine is started and stopped afterwards. */
  engine?: DesignSource
  /** Loads the renderer; tests pass the source module. Without it the bundled dist/render/render.js is loaded. */
  renderer?: () => Promise<Renderer>
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
  const design = options.design ?? (await buildWith(root, circuit, options.engine))
  try {
    const renderer = await (options.renderer ?? bundledRenderer)()
    return { ...(await renderer.renderDesign(design, request)), file: circuit }
  } catch (error) {
    if (canvasMissing(error)) throw new Error(CANVAS_MISSING)
    throw error
  }
}

/** The one-line answer: `io.circuit.tsx: PCB, whole board 32.3 x 23.6 mm; 1024 x 748 px`. */
export const renderedLine = (rendered: Rendered & { file: string }): string => `${rendered.file}: ${rendered.what}; ${rendered.width} x ${rendered.height} px`

/** `<name>-pcb.png` or `<name>-schematic-<page>.png` beside the circuit, the page made safe for a file name. */
export function defaultPictureName(circuit: string, view: RenderRequest["view"], page: string | undefined): string {
  const name = basename(circuit).replace(/\.(circuit|sheet)\.tsx$/, "")
  const suffix = view === "pcb" ? "pcb" : `schematic-${(page ?? "Main").replace(/[^A-Za-z0-9_-]+/g, "-")}`
  const folder = dirname(circuit)
  return `${folder === "." ? "" : `${folder}/`}${name}-${suffix}.png`
}

/** Draws the picture and writes it into the project (refusing a path outside it); answers the CLI's line. */
export async function writeRender(root: string, file: string, request: RenderRequest, out: string | undefined, options: RenderOptions = {}): Promise<string> {
  if (out !== undefined && !out.toLowerCase().endsWith(".png")) throw new Error(`--out must name a .png file, not ${out}`)
  if (out !== undefined) await assertLandsInProject(root, resolve(root, out))
  const rendered = await renderCircuit(root, file, request, options)
  const target = resolve(root, out ?? defaultPictureName(rendered.file, request.view, rendered.page))
  await assertLandsInProject(root, target)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, rendered.png)
  const shown = relative(resolve(root), target).split(sep).join("/")
  return `Wrote ${shown} (${rendered.width} x ${rendered.height} px): ${rendered.what}`
}
