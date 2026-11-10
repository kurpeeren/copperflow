// The whole fabrication set of a built design: the Gerbers, the plated and non-plated drill files, the pick-and-place
// and the bill of materials, as files in `<name>-fab/` and the same files in `<name>-fab.zip` beside it. A design with
// errors is refused, and so is one with a blind or buried via; unrouted connections, parts without a footprint and
// designators left over pads give warnings that name them. The set is pure and deterministic (the only date in it is
// the creation date passed in); writeFabrication puts it on disk.
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { BomLine } from "../../core/bom.js"
import type { CopperLayer } from "../../core/layout-file.js"
import type { Design } from "../design.js"
import { jlcpcbBomCsv } from "./bom-csv.js"
import { silkscreenWarnings } from "./designators.js"
import { drillFiles } from "./excellon.js"
import { gerberFiles } from "./layers.js"
import { designName, fabFileName, fabFolderName, fabZipName, GERBER_LAYERS, OTHER_FILES } from "./names.js"
import { naturalCompare } from "../order.js"
import { pickAndPlaceCsv } from "./pick-and-place.js"
import { zipFiles } from "./zip.js"

export interface FabricationFile {
  file: string
  text: string
}

export interface FabricationSet {
  ok: true
  /** The design's name, from its circuit file. */
  name: string
  /** The folder's and the zip's names, without a directory. */
  folder: string
  zip: string
  /** In the order they are written and zipped: Gerbers, plated and non-plated drills, pick-and-place, BOM. */
  files: FabricationFile[]
  zipData: Uint8Array
  warnings: string[]
}

export type FabricationResult = FabricationSet | { ok: false; errors: string[] }

interface Finding {
  code: string
  severity: string
  message: string
  items: readonly string[]
}

const describe = (finding: Finding) => `${finding.code}: ${finding.message}${finding.items.length > 0 ? ` (${finding.items.join(", ")})` : ""}`

/** Every error of the design: the diagnostics about its code and files, then the design-rule findings. */
function designErrors(design: Design): string[] {
  return [...design.diagnostics, ...design.violations].filter((finding) => finding.severity === "error").map(describe)
}

/** Stack order, top to bottom: a via joins every layer from the first of its layers in this order to the last. */
const STACK: readonly CopperLayer[] = ["top", "inner1", "inner2", "bottom"]

/**
 * An error for each via that does not go from the top to the bottom: the drill files hold only through holes, and a
 * blind or buried via needs a stack-up JLCPCB's standard boards do not have. A via on a layer the board lacks is
 * already an error of the design.
 */
function viaSpanErrors(design: Design): string[] {
  return design.pcb.vias
    .filter((via) => via.missingLayer === undefined)
    .flatMap((via) => {
      const spanned = STACK.filter((layer) => via.layers.includes(layer))
      const [first, last] = [spanned[0], spanned[spanned.length - 1]]
      if (first === "top" && last === "bottom") return []
      return [`blind or buried vias cannot be made as through drills; ${via.id} spans ${first}–${last}`]
    })
}

/** One warning naming every part the pick-and-place leaves out because it has no footprint, or none. */
function footprintWarnings(design: Design): string[] {
  const missing = design.pcb.parts
    .filter((part) => part.footprint === undefined)
    .map((part) => part.component)
    .sort(naturalCompare)
  if (missing.length === 0) return []
  const head = missing.length === 1 ? "1 part has no footprint and is" : `${missing.length} parts have no footprint and are`
  return [`${head} not in the pick-and-place: ${missing.join(", ")}`]
}

/** One warning naming every connection the copper does not join yet, or none. */
function unroutedWarnings(design: Design): string[] {
  const lines = design.pcb.ratsnest
  if (lines.length === 0) return []
  const head = lines.length === 1 ? "1 connection is not routed" : `${lines.length} connections are not routed`
  return [`${head}: ${lines.map((line) => `${line.net}: ${line.from} to ${line.to}`).join(", ")}`]
}

/** The fabrication files of a built design and its BOM lines, or the design's errors when it has any. */
export function fabricationSet(design: Design, bom: readonly BomLine[], created: Date): FabricationResult {
  const errors = [...designErrors(design), ...viaSpanErrors(design)]
  if (errors.length > 0) return { ok: false, errors }
  const name = designName(design.file)
  const files: FabricationFile[] = [
    ...gerberFiles(design.pcb, design.rules.fabrication, name, created),
    ...drillFiles(design.pcb, name, created),
    { file: fabFileName(name, "pick-and-place"), text: pickAndPlaceCsv(design.pcb, design.rules.fabrication) },
    { file: fabFileName(name, "bom"), text: jlcpcbBomCsv(bom) },
  ]
  const zipData = zipFiles(
    files.map(({ file, text }) => ({ name: file, text })),
    created,
  )
  return { ok: true, name, folder: fabFolderName(name), zip: fabZipName(name), files, zipData, warnings: [...unroutedWarnings(design), ...footprintWarnings(design), ...silkscreenWarnings(design.pcb, design.rules.fabrication)] }
}

/**
 * Writes the set into `dir`: the folder with every file, and the zip beside it. Files an earlier export wrote that
 * this one does not (an inner copper layer of a board that now has two) are removed; other files are left alone.
 */
export async function writeFabrication(dir: string, set: FabricationSet): Promise<{ folder: string; zip: string; files: string[] }> {
  const folder = join(dir, set.folder)
  await mkdir(folder, { recursive: true })
  const current = new Set(set.files.map((f) => f.file))
  const known = [...GERBER_LAYERS, ...OTHER_FILES].map((kind) => fabFileName(set.name, kind))
  for (const stale of known.filter((file) => !current.has(file))) await rm(join(folder, stale), { force: true })
  const files: string[] = []
  for (const { file, text } of set.files) {
    const path = join(folder, file)
    await writeFile(path, text, "utf8")
    files.push(path)
  }
  const zip = join(dir, set.zip)
  await writeFile(zip, set.zipData)
  return { folder, zip, files }
}
