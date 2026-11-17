// Writes a circuit's fabrication files (Gerbers, drills, pick-and-place, BOM and their zip) for the CLI, the MCP
// server and the Studio: builds the design, takes its BOM from the parts library, and puts `<name>-fab/` and
// `<name>-fab.zip` beside the circuit or into a folder of the project. A design with errors writes nothing.
import { lstat, realpath } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import type { Design } from "../engine/design.js"
import { fabricationSet, withPictures, writeFabrication, type FabricationSet } from "../engine/fab/export.js"
import { fabFileName, uploadStep } from "../engine/fab/names.js"
import { exportPictures, type CanvasLoader } from "../engine/fab/picture/png.js"
import { buildBom } from "./bom.js"
import { formatOrderReport } from "./order-report.js"
import { checkCounts, checkDesign } from "./check.js"
import { checksLine, type CheckCounts } from "./checks-line.js"

export { checksLine, type CheckCounts }
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
  /** Loads the canvas package the board's pictures are encoded with; tests pass one that fails. */
  canvas?: CanvasLoader
}

/** The set with the pictures of the board as made, or a warning that says they were left out and how to get them. */
async function pictured(set: FabricationSet, design: Design, created: Date, canvas: CanvasLoader | undefined): Promise<FabricationSet> {
  const pictures = await exportPictures(design, canvas)
  if (pictures !== undefined) return withPictures(set, pictures, created)
  const names = `${fabFileName(set.name, "top")}, ${fabFileName(set.name, "bottom")}`
  const missing = `The board pictures (${names}) were left out: drawing them needs the optional package @napi-rs/canvas (npm install -g @napi-rs/canvas), then export again.`
  return { ...set, warnings: [...set.warnings, missing] }
}

/** What an export wrote, every path relative to the project root with "/" between folders; or why it wrote nothing. */
export type FabricationExport =
  | { written: true; folder: string; zip: string; files: string[]; warnings: string[]; checks: CheckCounts; order?: string; model?: string }
  | { written: false; errors: string[]; order?: string }

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
export async function assertLandsInProject(root: string, path: string): Promise<void> {
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
    const created = options.created ?? new Date()
    const plain = fabricationSet(design, bom, created)
    const order = formatOrderReport(design, bom, { short: true })
    if (!plain.ok) return { written: false, errors: plain.errors, order }
    const set = await pictured(plain, design, created, options.canvas)
    for (const path of [join(outDir, set.folder), join(outDir, set.zip), ...[...set.files, ...(set.pictures ?? [])].map((f) => join(outDir, set.folder, f.file))]) await assertLandsInProject(root, path)
    const written = await writeFabrication(outDir, set).catch((error: unknown) => {
      throw writeError(root, error)
    })
    const inProject = (path: string) => relative(root, path).split(sep).join("/")
    const checks = checkCounts(checkDesign(design))
    return { written: true, folder: inProject(written.folder), zip: inProject(written.zip), files: written.files.map((path) => path.split(sep).pop() ?? path), warnings: set.warnings, checks, order, model: set.model }
  })
}


/** The order report's short form, when the export carries one. */
const orderLines = (result: FabricationExport): string[] => (result.order === undefined ? [] : [result.order])

/**
 * The export as text: the folder and zip, the files (one per line, or on one line when `compact`), what the STEP model
 * is not, each warning, and
 * the next step, a person uploading the zip for the board and the CSVs for assembly; or each error and that nothing was
 * written; then the order report's two verdicts.
 */
export function formatFabrication(result: FabricationExport, options: { compact?: boolean } = {}): string {
  if (!result.written) return ["Refused: no fabrication files were written. Fix these errors first:", ...result.errors.map((error) => `  ${error}`), ...orderLines(result)].join("\n")
  const files = options.compact ? [result.files.join(", ")] : result.files.map((name) => `  ${name}`)
  return [
    `Wrote ${result.files.length} files to ${result.folder}/ and ${result.zip}:`,
    ...files,
    ...(result.model === undefined ? [] : [result.model]),
    ...result.warnings.map((warning) => `Warning: ${warning}`),
    checksLine(result.checks),
    `Next, a person should ${uploadStep(result.zip, result.folder, result.files)}.`,
    ...orderLines(result),
  ].join("\n")
}
