// Writes a circuit's board as an EasyEDA Standard PCB document (copperflow easyeda, export as "easyeda"):
// `<name>-easyeda.json` beside the circuit, or the project file given, which EasyEDA Standard opens as an editable PCB.
// A design with errors is still written: the file hands the board on to be worked on, it is not an order.
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative, sep } from "node:path"
import { easyedaExport, easyedaText, type EasyedaCounts } from "../engine/fab/easyeda.js"
import { readEasyeda } from "../engine/fab/easyeda-read.js"
import { designName } from "../engine/fab/names.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { assertLandsInProject } from "./fabrication.js"
import { inProjectQueue } from "./file-writes.js"
import { refuseStreamName } from "./out-name.js"
import { resolveCircuit, resolveInRoot } from "./workspace.js"

export interface EasyedaFileExport {
  /** The file written, relative to the project root with "/" between folders. */
  file: string
  counts: EasyedaCounts
  /** What the document leaves out, one line per kind. */
  left: string[]
}

/** The document's file name for the design `name`. */
export const easyedaFileName = (name: string): string => `${name}-easyeda.json`

/** Builds the circuit and writes its EasyEDA document to `out` (a project path ending in .json) or beside the circuit. */
export function exportEasyeda(root: string, file: string, options: { engine?: DesignSource; out?: string } = {}): Promise<EasyedaFileExport> {
  if (options.out !== undefined && !options.out.toLowerCase().endsWith(".json")) throw new Error(`--out takes a file ending in .json (got ${options.out})`)
  if (options.out !== undefined) refuseStreamName(options.out)
  return inProjectQueue(root, async () => {
    const { file: circuit } = await resolveCircuit(root, file)
    const path = resolveInRoot(root, options.out ?? join(dirname(circuit), easyedaFileName(designName(circuit))))
    await assertLandsInProject(root, path)
    await refuseOverwriting(root, path)
    const design = await buildWith(root, circuit, options.engine)
    const { document, counts, left } = easyedaExport(design)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, easyedaText(document), "utf8")
    return { file: relative(root, path).split(sep).join("/"), counts, left }
  })
}

/**
 * Refuses to write over a file that is there and is not an EasyEDA PCB document: `out` ends in .json, as the project's
 * own files (a layout file, package.json) do, and an export must never replace one of them.
 */
async function refuseOverwriting(root: string, path: string): Promise<void> {
  const text = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (text === undefined) return
  try {
    readEasyeda(text)
  } catch {
    throw new Error(`${relative(root, path).split(sep).join("/")} is there and is not an EasyEDA PCB document; name another file to write`)
  }
}

const many = (count: number, one: string, more = `${one}s`) => `${count} ${count === 1 ? one : more}`

/** "Wrote led-easyeda.json for EasyEDA Standard: 2 parts, 4 pads, …", what it leaves out, and how to open it. */
export function formatEasyedaExport(result: EasyedaFileExport): string {
  const c = result.counts
  const held = [many(c.parts, "part"), many(c.pads, "pad"), many(c.tracks, "track"), many(c.vias, "via"), many(c.holes, "hole"), many(c.pours, "copper area"), many(c.texts, "board text"), many(c.nets, "net")]
  return [
    `Wrote ${result.file} for EasyEDA Standard: ${held.join(", ")}.`,
    ...result.left.map((line) => `Left out: ${line}.`),
    "Open it in EasyEDA Standard with File > Open > EasyEDA...; rebuild the copper areas there (Shift+B) to fill them.",
  ].join("\n")
}
