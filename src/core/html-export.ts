// Writes a circuit's design as one web page (copperflow html, export { as: "html" }): every schematic page, the board, the 3D
// view and the bill of materials, with the fabrication files, the 3D models and the BOM inside it as downloads.
// `<name>.html` beside the circuit, or the project file given. A design with errors is still written, since the page
// is a look at the design, not an order; it then carries no fabrication files and says why.
import { refuseStreamName } from "./out-name.js"
import { mkdir } from "node:fs/promises"
import { writeFileAtomic } from "./fs-utils.js"
import { dirname, join, relative, sep } from "node:path"
import type { Design } from "../engine/design.js"
import { fabricationSet, withPictures } from "../engine/fab/export.js"
import { designName } from "../engine/fab/names.js"
import { exportPictures, type CanvasLoader } from "../engine/fab/picture/png.js"
import { resolveLook, type LookRequest } from "../engine/fab/picture/looks.js"
import { MAIN_PAGE } from "../engine/model.js"
import { solidModel } from "../engine/solid/model.js"
import { stepText } from "../engine/solid/step.js"
import type { PartShapes } from "../engine/solid/step-faces.js"
import { VERSION } from "../version.js"
import { buildBom, formatBomCsv, type BomLine } from "./bom.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { assertLandsInProject } from "./fabrication.js"
import { inProjectQueue } from "./file-writes.js"
import { htmlPage, type PageData, type PageDownload, type PagePicture } from "./html-page.js"
import { orderReportLines } from "./order-report.js"
import { loadPartShapes } from "./part-shapes.js"
import { renderCircuit, type RenderRequest, type Renderer } from "./render.js"
import { resolveCircuit, resolveInRoot } from "./workspace.js"

/** Picture widths in pixels: wide enough to read on a laptop and to print. */
export const SHEET_WIDTH = 1600
export const MODEL_WIDTH = 1200
const ANGLES = ["iso", "top", "bottom"] as const
/** The tab each 3D view gets on the page. */
const ANGLE_TITLES: Readonly<Record<(typeof ANGLES)[number], string>> = { iso: "From an angle", top: "From above", bottom: "From below" }
/** How many of the export's reasons the page names when it carries no fabrication files. */
const REASONS_SHOWN = 3
const REPORT_PREFIXES = ["Board:", "Ready for ", "Not verified:"]

export interface HtmlOptions {
  engine?: DesignSource
  /** A project path ending in .html; `<name>.html` beside the circuit when left out. */
  out?: string
  look?: LookRequest
  /** The day the page names and the fabrication files carry; the same date gives the same bytes. Now when left out. */
  date?: Date
  /** Loads the renderer; tests pass the source module. Without it the bundled dist/render/render.js is loaded. */
  renderer?: () => Promise<Renderer>
  canvas?: CanvasLoader
  /** Draws every picture of the page this many pixels wide instead of the full sizes; tests pass a small one. */
  pictureWidth?: number
}

export interface HtmlExport {
  /** The file written, relative to the project root with "/" between folders. */
  file: string
  bytes: number
  /** What the page holds, in one line. */
  what: string
  /** The sizes of the embedded parts, in bytes. */
  split: { pictures: number; zip: number; glb: number; step: number }
}

type Draw = (request: RenderRequest) => Promise<PagePicture>

function drawer(root: string, circuit: string, design: Design, options: HtmlOptions): Draw {
  const renderOptions = { design, ...(options.renderer ? { renderer: options.renderer } : {}), ...(options.canvas ? { canvas: options.canvas } : {}) }
  return async (request) => {
    const rendered = await renderCircuit(root, circuit, options.pictureWidth === undefined ? request : { ...request, width: options.pictureWidth }, renderOptions)
    return { png: rendered.png, width: rendered.width, height: rendered.height, alt: rendered.what }
  }
}

const pageNames = (design: Design): string[] => {
  const pages = design.schematic.pages?.map((page) => page.name) ?? []
  return pages.length > 0 ? pages : [MAIN_PAGE]
}

async function pictures(draw: Draw, design: Design, look: LookRequest) {
  const schematic = []
  for (const page of pageNames(design)) schematic.push({ page, picture: await draw({ view: "schematic", page, width: SHEET_WIDTH }) })
  const board = [
    { ...(await draw({ view: "pcb", width: SHEET_WIDTH })), title: "PCB view" },
    { ...(await draw({ view: "board", side: "top", look, width: SHEET_WIDTH })), title: "Top, as made" },
    { ...(await draw({ view: "board", side: "bottom", look, width: SHEET_WIDTH })), title: "Bottom, as made" },
  ]
  const threeD = []
  for (const angle of ANGLES) threeD.push({ ...(await draw({ view: "3d", angle, look, width: MODEL_WIDTH })), title: ANGLE_TITLES[angle] })
  return { schematic, board, threeD }
}

/** The fabrication zip as `copperflow export` makes it, built in memory; or why the export refuses the design. */
async function fabricationZip(design: Design, bom: BomLine[], date: Date, canvas: CanvasLoader | undefined, shapes: PartShapes): Promise<{ zip: PageDownload } | { missing: string }> {
  const set = fabricationSet(design, bom, date, shapes)
  if (!set.ok) {
    const more = set.errors.length > REASONS_SHOWN ? ` and ${set.errors.length - REASONS_SHOWN} more` : ""
    return { missing: `the export refuses this design until its errors are fixed: ${set.errors.slice(0, REASONS_SHOWN).join("; ")}${more}.` }
  }
  const boardPictures = await exportPictures(design, canvas)
  const full = boardPictures === undefined ? set : withPictures(set, boardPictures, date)
  const contents = `Gerbers, drills, pick-and-place, BOM, STEP${boardPictures === undefined ? "" : ", board pictures"}`
  return { zip: { name: set.zip, mime: "application/zip", label: `Download the fabrication files (${contents})`, bytes: full.zipData } }
}

async function downloads(design: Design, bom: BomLine[], options: HtmlOptions & { date: Date }) {
  const name = designName(design.file)
  const renderer = await (options.renderer ?? bundledRenderer)()
  const solids = solidModel(design)
  const shapes = await loadPartShapes(design, solids, () => Promise.resolve(renderer))
  const fab = await fabricationZip(design, bom, options.date, options.canvas, shapes)
  const glb = renderer.modelGlb(design, options.look ? { look: options.look } : {}).glb
  const step = new TextEncoder().encode(stepText(solids, name, shapes.faces))
  const files: PageDownload[] = [
    ...("zip" in fab ? [fab.zip] : []),
    { name: `${name}.glb`, mime: "model/gltf-binary", label: "Download the 3D model (GLB)", bytes: glb },
    { name: `${name}.step`, mime: "model/step", label: `Download the 3D model for CAD (STEP, ${shapes.faces ? "parts in colour as the 3D view draws them" : "parts as boxes"})`, bytes: step },
    { name: `${name}-bom.csv`, mime: "text/csv", label: "Download the bill of materials (CSV)", bytes: new TextEncoder().encode(formatBomCsv(bom)) },
  ]
  return { files, ...("missing" in fab ? { missing: fab.missing } : {}), ...(shapes.missing !== undefined ? { stepMissing: shapes.missing } : {}), sizes: { zip: "zip" in fab ? fab.zip.bytes.length : 0, glb: glb.length, step: step.length } }
}

/** The bundle sits beside dist/core: dist/render/render.js. Its path is built at run time, so tsc leaves it alone. */
const bundledRenderer = (): Promise<Renderer> => import(new URL("../render/render.js", import.meta.url).href) as Promise<Renderer>

/** Everything the page shows, gathered from one build. */
async function gather(root: string, circuit: string, design: Design, options: HtmlOptions & { date: Date }) {
  const look = options.look ?? {}
  resolveLook(look)
  const bom = await buildBom(root, circuit, { design })
  const drawn = await pictures(drawer(root, circuit, design, options), design, look)
  const files = await downloads(design, bom, options)
  const data: PageData = {
    name: designName(circuit),
    version: VERSION,
    date: options.date.toISOString().slice(0, 10),
    report: orderReportLines(design, bom).filter((line) => REPORT_PREFIXES.some((prefix) => line.startsWith(prefix))),
    ...drawn,
    bom,
    downloads: files.files,
    ...(files.missing !== undefined ? { fabricationMissing: files.missing } : {}),
  }
  const pictureBytes = [...drawn.schematic.map((s) => s.picture), ...drawn.board, ...drawn.threeD].reduce((sum, p) => sum + p.png.length, 0)
  return { data, split: { pictures: pictureBytes, ...files.sizes }, ...(files.stepMissing !== undefined ? { stepMissing: files.stepMissing } : {}) }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

function whatLine(data: PageData, stepMissing: string | undefined): string {
  const files = data.downloads.map((file) => file.name).join(", ")
  const fab = data.fabricationMissing === undefined ? "" : "; no fabrication files: the design has errors"
  const step = stepMissing === undefined ? "" : `; the STEP model's parts are boxes, since their 3D shapes could not be loaded (${stepMissing})`
  return `the design as one page: ${plural(data.schematic.length, "schematic page")}, the board (PCB view, top and bottom as made), 3D from ${ANGLES.length} angles, the BOM (${plural(data.bom.length, "line")}); files inside: ${files}${fab}${step}`
}

export { refuseStreamName } from "./out-name.js"

/** Builds the circuit and writes its web page to `out` or beside the circuit. */
export function exportHtml(root: string, file: string, options: HtmlOptions = {}): Promise<HtmlExport> {
  if (options.out !== undefined && !options.out.toLowerCase().endsWith(".html")) throw new Error(`--out takes a file ending in .html (got ${options.out})`)
  if (options.out !== undefined) refuseStreamName(options.out)
  return inProjectQueue(root, async () => {
    const { file: circuit } = await resolveCircuit(root, file)
    const path = resolveInRoot(root, options.out ?? join(dirname(circuit), `${designName(circuit)}.html`))
    await assertLandsInProject(root, path)
    const design = await buildWith(root, circuit, options.engine)
    const { data, split, stepMissing } = await gather(root, circuit, design, { ...options, date: options.date ?? new Date() })
    const text = htmlPage(data)
    await mkdir(dirname(path), { recursive: true })
    await writeFileAtomic(path, text)
    return { file: relative(root, path).split(sep).join("/"), bytes: Buffer.byteLength(text, "utf8"), what: whatLine(data, stepMissing), split }
  })
}

/** The badge a person may paste into their own repository's README; offered in the answer, never added to their files. */
const README_BADGE = "[![Made with copperflow](https://img.shields.io/badge/made%20with-copperflow-c8702a)](https://copperflow.kurpeeren.com)"

/** "Wrote io-8.html (2100 kB): the design as one page: ..." and what opens it. */
export function formatHtmlExport(result: HtmlExport): string {
  return [
    `Wrote ${result.file} (${Math.max(1, Math.round(result.bytes / 1000))} kB): ${result.what}`,
    "Any web browser opens it from disk, with no network; it is a look at the design and its files, not an editor.",
    `To credit copperflow in a README: ${README_BADGE}`,
  ].join("\n")
}
