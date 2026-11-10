// Writes a circuit's fabrication files (Gerbers, drills, pick-and-place, BOM and their zip) for the CLI, the MCP
// server and the Studio: builds the design, takes its BOM from the parts library, and puts `<name>-fab/` and
// `<name>-fab.zip` beside the circuit or into a folder of the project. A design with errors writes nothing.
import { dirname, relative, resolve, sep } from "node:path"
import type { Design } from "../engine/design.js"
import { fabricationSet, writeFabrication } from "../engine/fab/export.js"
import { buildBom } from "./bom.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { resolveCircuit, resolveInRoot } from "./workspace.js"

export interface FabricationOptions {
  /** A design that is already built; no engine is used. */
  design?: Design
  /** Builds the design when none is given. Without one, a new engine is started and stopped afterwards. */
  engine?: DesignSource
  /** The project folder to write into; the circuit's own folder when left out. */
  outDir?: string
  /** The creation date written into the files; now when left out. */
  created?: Date
}

/** What an export wrote, every path relative to the project root with "/" between folders; or why it wrote nothing. */
export type FabricationExport =
  | { written: true; folder: string; zip: string; files: string[]; warnings: string[] }
  | { written: false; errors: string[] }

/** A folder of the project, the root itself included (resolveInRoot accepts only what is inside it). */
function projectFolder(root: string, folder: string): string {
  return resolve(root, folder) === resolve(root) ? resolve(root) : resolveInRoot(root, folder)
}

/** Builds the circuit and writes its fabrication files, unless the design has errors. */
export async function exportFabrication(root: string, file: string, options: FabricationOptions = {}): Promise<FabricationExport> {
  const { file: circuit } = await resolveCircuit(root, file)
  const outDir = projectFolder(root, options.outDir ?? dirname(circuit))
  const design = options.design ?? (await buildWith(root, circuit, options.engine))
  const bom = await buildBom(root, circuit, { design })
  const set = fabricationSet(design, bom, options.created ?? new Date())
  if (!set.ok) return { written: false, errors: set.errors }
  const written = await writeFabrication(outDir, set)
  const inProject = (path: string) => relative(root, path).split(sep).join("/")
  return { written: true, folder: inProject(written.folder), zip: inProject(written.zip), files: written.files.map((path) => path.split(sep).pop() ?? path), warnings: set.warnings }
}

/** The zip's own name, which is what a person uploads. */
const zipName = (zip: string) => zip.split("/").pop() ?? zip

/**
 * The export as text: the folder and zip, the files (one per line, or on one line when `compact`), each warning, and
 * the next step, a person uploading the zip; or each error and that nothing was written.
 */
export function formatFabrication(result: FabricationExport, options: { compact?: boolean } = {}): string {
  if (!result.written) return ["Refused: no fabrication files were written. Fix these errors first:", ...result.errors.map((error) => `  ${error}`)].join("\n")
  const files = options.compact ? [result.files.join(", ")] : result.files.map((name) => `  ${name}`)
  return [
    `Wrote ${result.files.length} files to ${result.folder}/ and ${result.zip}:`,
    ...files,
    ...result.warnings.map((warning) => `Warning: ${warning}`),
    `Next, a person should upload ${zipName(result.zip)} to JLCPCB.`,
  ].join("\n")
}
