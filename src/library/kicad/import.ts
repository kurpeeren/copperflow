// Imports a KiCad board (.kicad_pcb) as a new circuit: the circuit file, its layout file and its library parts in ONE
// history entry, whose undo takes them all back. Then the circuit is built and checked, and every pad's net in the
// built design is compared with the file's. The CLI's `copperflow import kicad` and the agent's import_board call it.
import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { checkDesign, checkCounts, type CheckResult } from "../../core/check.js"
import { buildWith, type DesignSource } from "../../core/design-source.js"
import { EditError } from "../../core/edit-error.js"
import { readIfThere } from "../../core/file-writes.js"
import type { Author, FileChange, HistoryEntry } from "../../core/history.js"
import { layoutPathFor } from "../../core/layout-file.js"
import { PARTS_DIR } from "../../core/library.js"
import { createCircuitFile, isInside, projectPath, resolveInRoot } from "../../core/workspace.js"
import type { Design } from "../../engine/design.js"
import { KicadError, readKicadBoard, type KicadBoard } from "./read.js"
import { netPins, planImport, type Library, type LibraryPart, type PlannedImport } from "./write.js"

/** The largest board file read: a large real board is a few MB. */
export const MAX_FILE_BYTES = 32 * 1024 * 1024
/** The most footprints read: far beyond a board copperflow is built for, and the build stays quick. */
export const MAX_PARTS = 2000
/** The most tracks and vias read. */
export const MAX_COPPER = 100_000

export interface KicadImportOptions {
  /** The board file: inside the project for the agent; for a person, any path they give. */
  kicad: string
  /** The circuit file to write; by default the board file's name, in the project's top folder. */
  file?: string
  /** The circuit's name instead of `file`: name.circuit.tsx. */
  name?: string
  replace?: boolean
  origin?: "centre" | "keep"
}

export interface KicadImportResult {
  entry: HistoryEntry
  file: string
  source: string
  board: KicadBoard
  plan: PlannedImport
  parts: LibraryPart[]
  /** File net name to the circuit's name. */
  netNames: Record<string, string>
  check?: CheckResult
  buildError?: string
  /** Pads whose net (or place) in the built design is not the file's: errors of the import. */
  padErrors: string[]
  pads: number
}

/** The circuit file for the options: the given file, `<name>.circuit.tsx`, or the board file's name. */
function circuitFile(root: string, options: KicadImportOptions): string {
  if (options.file !== undefined) return projectPath(root, options.file)
  const name = options.name ?? basename(options.kicad).replace(/\.kicad_pcb$/i, "")
  const clean = name.replace(/\.circuit\.tsx$/, "").replace(/[^A-Za-z0-9_-]/g, "_") || "board"
  return projectPath(root, `${clean}.circuit.tsx`)
}

/** The board file's text: refused outside the project when only the project is given, when missing, and when too large. */
async function boardText(root: string, kicad: string, inProject: boolean): Promise<string> {
  const path = resolve(root, kicad)
  if (inProject) {
    const outside = new EditError("invalid", `${kicad} is outside the project folder`)
    try {
      resolveInRoot(root, kicad)
    } catch {
      throw outside
    }
    const real = await realpath(path).catch(() => path)
    if (!isInside(await realpath(resolve(root)), real)) throw outside
  }
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new EditError("not_found", `There is no file ${kicad}`)
    throw error
  })
  if (info.size > MAX_FILE_BYTES) {
    throw new EditError("invalid", `${basename(kicad)} is ${Math.round(info.size / (1024 * 1024))} MB; copperflow reads KiCad boards of up to ${MAX_FILE_BYTES / (1024 * 1024)} MB`)
  }
  return readFile(path, "utf8")
}

function readBoard(text: string, name: string, origin: KicadImportOptions["origin"]): KicadBoard {
  let board: KicadBoard
  try {
    board = readKicadBoard(text, origin ? { origin } : {})
  } catch (error) {
    if (error instanceof KicadError) throw new EditError("invalid", `${name}: ${error.message}`)
    throw error
  }
  if (board.parts.length > MAX_PARTS) throw new EditError("invalid", `${name} has ${board.parts.length} footprints; copperflow imports boards of up to ${MAX_PARTS}`)
  if (board.tracks.length + board.vias.length > MAX_COPPER) throw new EditError("invalid", `${name} has ${board.tracks.length + board.vias.length} tracks and vias; copperflow imports boards of up to ${MAX_COPPER}`)
  return board
}

/** The project's library parts with their files' texts. */
async function readLibrary(root: string): Promise<Library> {
  const library = new Map<string, Map<string, string>>()
  const dir = join(root, PARTS_DIR)
  const ids = await readdir(dir).catch(() => [] as string[])
  for (const id of ids) {
    const names = await readdir(join(dir, id)).catch(() => [] as string[])
    const files = new Map<string, string>()
    for (const name of names) {
      const text = await readIfThere(join(dir, id, name)).catch(() => undefined)
      if (text !== undefined) files.set(name, text)
    }
    library.set(id, files)
  }
  return library
}

/** The other files of the change: the layout file and every new part file. */
async function otherFiles(root: string, file: string, plan: PlannedImport): Promise<FileChange[]> {
  const layoutFile = layoutPathFor(file)
  const before = await readIfThere(resolveInRoot(root, layoutFile))
  const layout: FileChange[] = before === undefined ? (plan.layout === "" ? [] : [{ file: layoutFile, before: "", after: plan.layout, absent: "before" }]) : before === plan.layout ? [] : [{ file: layoutFile, before, after: plan.layout }]
  const parts = plan.parts.flatMap((part) => part.files.map((f): FileChange => ({ file: f.file, before: "", after: f.text, absent: "before" })))
  return [...layout, ...parts]
}

/**
 * Every pad of the file in the built design: at its place, on the net it had. A named net must carry its name; pads
 * that shared a net without a name share one net; a pad on no net in the file is on no net with other pads.
 */
export function padErrors(board: KicadBoard, plan: PlannedImport, design: Design): { errors: string[]; pads: number } {
  const errors: string[] = []
  const built = design.pcb.parts.flatMap((part) => part.pads)
  const nets = new Map((design.circuit?.nets ?? []).map((net) => [net.id, net]))
  const shared = new Map<string, string | undefined>()
  let pads = 0
  board.parts.forEach((part, i) => {
    const name = plan.names[i] as string
    part.pads.forEach((pad, p) => {
      pads++
      const label = `${name}.${pad.number || `pin${plan.pins[i]?.padPins[p]}`}`
      const found = built.find((one) => one.component === name && Math.hypot(one.x - pad.world.x, one.y - pad.world.y) < 0.001)
      if (!found) {
        errors.push(`${label} is not at (${pad.world.x}, ${pad.world.y}) in the built design`)
        return
      }
      const net = found.net === undefined ? undefined : nets.get(found.net)
      const now = net === undefined ? "none" : (net.names[0] ?? "a connection without a name")
      const named = pad.net === undefined ? undefined : plan.nets.names.get(pad.net)
      if (named !== undefined) {
        if (!net?.names.includes(named)) errors.push(`${label} had ${pad.net} in the file and has ${now} in the built design`)
      } else if (pad.net !== undefined && plan.nets.unnamed.has(pad.net)) {
        if (found.net === undefined) errors.push(`${label} had ${pad.net} in the file and has none in the built design`)
        else if (shared.has(pad.net) && shared.get(pad.net) !== found.net) errors.push(`${label} had ${pad.net} in the file and has another net than its other pads in the built design`)
        else shared.set(pad.net, found.net)
      } else if (net !== undefined && net.pins.length > 1) {
        errors.push(`${label} had no net in the file and has ${now} in the built design`)
      }
    })
  })
  const owners = new Map<string, string>()
  for (const [fileNet, id] of shared) {
    const other = id === undefined ? undefined : owners.get(id)
    if (other !== undefined) errors.push(`${other} and ${fileNet} are one net in the built design`)
    if (id !== undefined) owners.set(id, fileNet)
  }
  return { errors, pads }
}

/** Builds, checks and compares the pads; a build that fails is reported, not thrown: the circuit is written either way. */
async function checkAfter(root: string, file: string, board: KicadBoard, plan: PlannedImport, engine: DesignSource | undefined) {
  try {
    const design = await buildWith(root, file, engine)
    const compared = padErrors(board, plan, design)
    return { check: checkDesign(design), padErrors: compared.errors, pads: compared.pads }
  } catch (error) {
    return { buildError: (error as Error).message, padErrors: [], pads: 0 }
  }
}

/** Reads the board and writes it into the project as one change; refuses, writing nothing, what it cannot import. */
export async function importKicad(root: string, options: KicadImportOptions, meta: { author: Author; engine?: DesignSource; inProject?: boolean }): Promise<KicadImportResult> {
  const source = basename(options.kicad)
  const file = circuitFile(root, options)
  if (!options.replace && (await readIfThere(resolveInRoot(root, file))) !== undefined) {
    throw new EditError("invalid", `${file} already exists; pass replace to overwrite it, or choose another name`)
  }
  const board = readBoard(await boardText(root, options.kicad, meta.inProject === true), source, options.origin)
  const plan = planImport(board, { source, file, library: await readLibrary(root), author: meta.author })
  const written = plan.parts.filter((part) => part.written).length
  board.left.add("unnamedPours", board.pours.filter((pour) => !plan.nets.names.has(pour.net)).length)
  const entry = await createCircuitFile(root, file, plan.circuit, {
    author: meta.author,
    summary: `import ${file} from ${source} (${board.parts.length} parts, ${written} new library parts)`,
    ...(options.replace ? { replace: true } : {}),
    also: await otherFiles(root, file, plan),
  })
  const after = await checkAfter(root, entry.file, board, plan, meta.engine)
  return { entry, file: entry.file, source, board, plan, parts: plan.parts, netNames: Object.fromEntries(plan.nets.names), ...after }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const mm = (n: number) => String(Math.round(n * 1e4) / 1e4)

/** "Board: 50 x 40 mm, moved by …; 1 hole: 3.2 mm at (-21, -16) (H1 became a hole)" */
function boardLine(result: KicadImportResult): string {
  const { board, holeOnly } = result.board
  const where = board.offset.x === 0 && board.offset.y === 0 ? "not moved" : `moved by ${mm(board.offset.x)}, ${mm(board.offset.y)}`
  const holes = board.holes.length === 0 ? "" : `; ${plural(board.holes.length, "hole")}: ${board.holes.slice(0, 20).map((h) => `${mm(h.diameter)} mm at (${mm(h.x)}, ${mm(h.y)})`).join(", ")}${board.holes.length > 20 ? ` … and ${board.holes.length - 20} more` : ""}`
  const became = holeOnly.length === 0 ? "" : ` (${holeOnly.join(", ")} became ${holeOnly.length === 1 ? "a hole" : "holes"})`
  const keepouts = board.keepouts.length === 0 ? "" : `; ${plural(board.keepouts.length, "shape")} kept clear as keepouts`
  return `Board: ${mm(board.width)} x ${mm(board.height)} mm, ${where}${holes}${became}${keepouts}`
}

function netsLine(result: KicadImportResult): string {
  const { nets } = result.plan
  const single = nets.single.size === 0 ? "" : ` (${nets.single.size} with a single pad ${nets.single.size === 1 ? "needs" : "need"} no connection)`
  return `Nets: ${nets.names.size} named and ${nets.unnamed.size} without a name, of ${result.board.held.nets} in the file${single}`
}

function copperLine(result: KicadImportResult): string {
  const { held, tracks, vias, pours } = result.board
  const kinds = [held.segments > 0 ? plural(held.segments, "segment") : "", held.arcs > 0 ? `${plural(held.arcs, "arc")} as ${held.arcPieces} straight pieces within 0.01 mm` : ""].filter((w) => w !== "")
  const written = pours.filter((pour) => result.plan.nets.names.has(pour.net)).length
  return `Tracks: ${tracks.length} of ${held.segments + held.arcs}${kinds.length > 0 ? ` (${kinds.join("; ")})` : ""}; vias: ${vias.length} of ${held.vias}; pours: ${written} from ${plural(held.zones, "zone")}`
}

function renamedLine(result: KicadImportResult): string[] {
  const parts = result.board.parts.flatMap((part, i) => (part.ref !== result.plan.names[i] ? [`${part.ref || "(none)"} as ${result.plan.names[i]}`] : []))
  const nets = Object.entries(result.netNames).filter(([from, to]) => from !== to).map(([from, to]) => `${from} as ${to}`)
  return [...(parts.length > 0 ? [`Renamed designators: ${parts.join(", ")}`] : []), ...(nets.length > 0 ? [`Renamed nets: ${nets.join(", ")}`] : [])]
}

function checkLines(result: KicadImportResult): string[] {
  if (result.buildError) return [`Check: the circuit was written, but it could not be built: ${result.buildError}`]
  const counts = checkCounts(result.check as CheckResult)
  const check = `Check: ${plural(counts.errors, "error")}, ${plural(counts.warnings, "warning")} (copperflow check ${result.file} lists them)`
  const pads = result.padErrors.length === 0 ? [`Pads: all ${result.pads} copper pads have the net they had in the file`] : [`Import errors, ${result.padErrors.length} pads differ from the file: ${result.padErrors.slice(0, 20).join("; ")}`]
  return [check, ...pads]
}

/** The answer's lines: what was written against what the file held, the check, and what did not come over. */
export function formatKicadImport(result: KicadImportResult): string[] {
  const written = result.parts.filter((part) => part.written).length
  const reused = result.parts.length - written
  const others = [result.plan.layout === "" ? "" : "its layout file", `${plural(written, "new library part")}${reused > 0 ? ` (${reused} already in the library)` : ""}`].filter((w) => w !== "")
  const left = result.board.left.lines()
  return [
    `Change ${result.entry.id}: imported ${result.source} (KiCad file version ${result.board.version}) as ${result.file}, ${others.join(" and ")}`,
    boardLine(result),
    `Parts: ${result.board.parts.length} of ${result.board.held.footprints} footprints, as ${plural(result.parts.length, "library part")}`,
    `Library parts: ${result.parts.slice(0, 30).map((part) => `${part.id} (${part.used.join(" ")})`).join(", ")}${result.parts.length > 30 ? ` … and ${result.parts.length - 30} more` : ""}`,
    netsLine(result),
    copperLine(result),
    ...renamedLine(result),
    ...checkLines(result),
    ...(left.length === 0 ? ["Not carried over: nothing"] : ["Not carried over:", ...left.map((line) => `- ${line}`)]),
    "The parts are NOT verified: they came from the file. Compare every pad with its datasheet (parts/<id>/verification.md).",
  ]
}
