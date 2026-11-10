// Writes a circuit's fabrication files (Gerbers, drills, pick-and-place, BOM and their zip) for the CLI, the MCP
// server and the Studio: builds the design, takes its BOM from the parts library, and puts `<name>-fab/` and
// `<name>-fab.zip` beside the circuit or into a folder of the project. A design with errors writes nothing.
import { lstat, realpath } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import type { Design } from "../engine/design.js"
import { fabricationSet, writeFabrication } from "../engine/fab/export.js"
import { buildBom } from "./bom.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { inProjectQueue, isInside } from "./file-writes.js"
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

const exists = (path: string) => lstat(path).then(
  () => true,
  () => false,
)

/**
 * Refuses a path that would land outside the project once links are followed: its nearest existing part (the path
 * itself when it exists, even as a link) must resolve inside the project root or be the root. A link that leads
 * nowhere counts as outside, since writing through it would create its target.
 */
async function assertLandsInProject(root: string, path: string): Promise<void> {
  const realRoot = await realpath(resolve(root))
  let existing = path
  while (!(await exists(existing)) && dirname(existing) !== existing) existing = dirname(existing)
  const real = await realpath(existing).catch(() => undefined)
  if (real === undefined || (real !== realRoot && !isInside(realRoot, real))) {
    throw new Error(`${relative(resolve(root), path).split(sep).join("/") || "."} is outside the project root`)
  }
}

/** File system errors of the write in plain words, naming the path in the project; other errors as they are. */
function writeError(root: string, error: unknown): Error {
  const { code, path } = error as NodeJS.ErrnoException
  const where = path === undefined ? "a fabrication file" : relative(resolve(root), path).split(sep).join("/")
  switch (code) {
    case "EEXIST":
    case "ENOTDIR":
      return new Error(`Cannot write the fabrication files: ${where} is in the way (a file where a folder goes); move or rename it`)
    case "EISDIR":
      return new Error(`Cannot write the fabrication files: ${where} is a folder where a file goes; move or rename it`)
    case "EACCES":
    case "EPERM":
    case "EBUSY":
      return new Error(`Cannot write the fabrication files: ${where} cannot be written (read-only, or open in another program)`)
    default:
      return error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * Builds the circuit and writes its fabrication files, unless the design has errors. Runs in the project's write
 * queue, so it never reads or writes between the steps of another change to the project.
 */
export function exportFabrication(root: string, file: string, options: FabricationOptions = {}): Promise<FabricationExport> {
  return inProjectQueue(root, async () => {
    const { file: circuit } = await resolveCircuit(root, file)
    const outDir = projectFolder(root, options.outDir ?? dirname(circuit))
    await assertLandsInProject(root, outDir)
    const design = options.design ?? (await buildWith(root, circuit, options.engine))
    const bom = await buildBom(root, circuit, { design })
    const set = fabricationSet(design, bom, options.created ?? new Date())
    if (!set.ok) return { written: false, errors: set.errors }
    for (const path of [join(outDir, set.folder), join(outDir, set.zip), ...set.files.map((f) => join(outDir, set.folder, f.file))]) await assertLandsInProject(root, path)
    const written = await writeFabrication(outDir, set).catch((error: unknown) => {
      throw writeError(root, error)
    })
    const inProject = (path: string) => relative(root, path).split(sep).join("/")
    return { written: true, folder: inProject(written.folder), zip: inProject(written.zip), files: written.files.map((path) => path.split(sep).pop() ?? path), warnings: set.warnings }
  })
}

/** A path's last part: the zip's own name is what a person uploads. */
const baseName = (path: string) => path.split("/").pop() ?? path

/** The written file whose name ends in `suffix`, e.g. "-bom.csv". */
const fileEnding = (files: readonly string[], suffix: string, fallback: string) => files.find((name) => name.endsWith(suffix)) ?? fallback

/**
 * The next step: the Gerber zip goes to JLCPCB's PCB order, the BOM and pick-and-place CSVs to its assembly step. Both
 * CSVs are in the folder, and the zip keeps them too.
 */
function nextStep(result: Extract<FabricationExport, { written: true }>): string {
  const bom = fileEnding(result.files, "-bom.csv", "the BOM")
  const placement = fileEnding(result.files, "-pick-and-place.csv", "the pick-and-place file")
  return `Next, a person should upload ${baseName(result.zip)} to JLCPCB's PCB order, and ${bom} and ${placement} from ${result.folder}/ at its assembly step (the zip holds them too).`
}

/**
 * The export as text: the folder and zip, the files (one per line, or on one line when `compact`), each warning, and
 * the next step, a person uploading the zip for the board and the CSVs for assembly; or each error and that nothing was
 * written.
 */
export function formatFabrication(result: FabricationExport, options: { compact?: boolean } = {}): string {
  if (!result.written) return ["Refused: no fabrication files were written. Fix these errors first:", ...result.errors.map((error) => `  ${error}`)].join("\n")
  const files = options.compact ? [result.files.join(", ")] : result.files.map((name) => `  ${name}`)
  return [
    `Wrote ${result.files.length} files to ${result.folder}/ and ${result.zip}:`,
    ...files,
    ...result.warnings.map((warning) => `Warning: ${warning}`),
    nextStep(result),
  ].join("\n")
}
