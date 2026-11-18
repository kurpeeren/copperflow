// Writes a circuit's board and parts as a GLB file (copperflow glb, export_model): `<name>.glb` beside the circuit, or
// the project file given. The model is the scene render's view "3d" draws, made by the Studio's renderer bundled to
// dist/render/render.js; a design with errors is still written, since the file is a look at the board, not an order.
import { refuseStreamName } from "./out-name.js"
import { mkdir, writeFile } from "node:fs/promises"
import { basename, dirname, join, relative, sep } from "node:path"
import type { Design } from "../engine/design.js"
import { designName } from "../engine/fab/names.js"
import type { LookRequest } from "../engine/fab/picture/looks.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { assertLandsInProject } from "./fabrication.js"
import { inProjectQueue } from "./file-writes.js"
import { resolveCircuit, resolveInRoot } from "./workspace.js"

/** What is used of the renderer's bundle: the design as a GLB file and the words for it. */
export interface Modeller {
  modelGlb(design: Design, request: { look?: LookRequest }): { glb: Uint8Array; what: string; parts: number }
}

export interface GlbExport {
  /** The file written, relative to the project root with "/" between folders. */
  file: string
  bytes: number
  /** What the model shows and is not. */
  what: string
}

export interface GlbOptions {
  engine?: DesignSource
  /** A project path ending in .glb; `<name>.glb` beside the circuit when left out. */
  out?: string
  /** The board's mask, print and finish. */
  look?: LookRequest
  /** Loads the renderer; tests pass the source module. Without it the bundled dist/render/render.js is loaded. */
  renderer?: () => Promise<Modeller>
}

/** The bundle sits beside dist/core: dist/render/render.js. Its path is built at run time, so tsc leaves it alone. */
const bundledModeller = (): Promise<Modeller> => import(new URL("../render/render.js", import.meta.url).href) as Promise<Modeller>

/** Builds the circuit and writes its GLB file to `out` or beside the circuit. */
export function exportGlb(root: string, file: string, options: GlbOptions = {}): Promise<GlbExport> {
  if (options.out !== undefined && !options.out.toLowerCase().endsWith(".glb")) throw new Error(`--out takes a file ending in .glb (got ${options.out})`)
  if (options.out !== undefined) refuseStreamName(options.out)
  return inProjectQueue(root, async () => {
    const { file: circuit } = await resolveCircuit(root, file)
    const path = resolveInRoot(root, options.out ?? join(dirname(circuit), `${designName(circuit)}.glb`))
    await assertLandsInProject(root, path)
    const design = await buildWith(root, circuit, options.engine)
    const modeller = await (options.renderer ?? bundledModeller)()
    const model = modeller.modelGlb(design, options.look ? { look: options.look } : {})
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, model.glb)
    return { file: relative(root, path).split(sep).join("/"), bytes: model.glb.length, what: model.what }
  })
}

/** "Wrote led.glb (212 kB): the board as made (green mask, ENIG) and 2 parts as simple shapes, ..." and what opens it. */
export function formatGlbExport(result: GlbExport): string {
  return [`Wrote ${result.file} (${Math.max(1, Math.round(result.bytes / 1000))} kB): ${result.what}`, `${basename(result.file)} is a glTF 2.0 file: a 3D viewer, a 3D editor or a web page opens it and turns it.`].join("\n")
}
