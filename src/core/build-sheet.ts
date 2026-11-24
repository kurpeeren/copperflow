// export { as: "build" }: a perfboard's or stripboard's build sheet beside the circuit, `<name>-build.md` with the
// parts' holes, the cut list, the link list and the solder runs, and the two sides as built in `<name>-build-top.png`
// and `<name>-build-bottom.png` (left out, and said, when the optional canvas package is missing).
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, posix, resolve } from "node:path"
import { designName } from "../engine/fab/names.js"
import { canvasMissing, encodePng, loadCanvas, type CanvasLoader } from "../engine/fab/picture/png.js"
import { buildSheet } from "../engine/proto/build-sheet.js"
import { protoPicture, protoScale } from "../engine/proto/picture.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { assertLandsInProject } from "./fabrication.js"
import { resolveCircuit } from "./workspace.js"

/** The pictures' width in pixels. */
const PICTURE_WIDTH = 1600

export interface BuildSheetOptions {
  engine?: DesignSource
  canvas?: CanvasLoader
}

/** Writes the build sheet and its pictures; answers the files written, project-relative, and a note when pictures are missing. */
export async function exportBuildSheet(root: string, file: string, options: BuildSheetOptions = {}): Promise<{ files: string[]; note?: string }> {
  const circuit = await resolveCircuit(root, file)
  const design = await buildWith(root, circuit.file, options.engine)
  const grid = design.pcb.board?.proto
  if (!grid) throw new Error('as "build" is for a perfboard or stripboard; make the board one with fit_board { kind }')
  const name = designName(circuit.file)
  const folder = posix.dirname(circuit.file)
  const local = (base: string) => (folder === "." ? base : `${folder}/${base}`)
  const pictures = { top: `${name}-build-top.png`, bottom: `${name}-build-bottom.png` }
  const pngs: { file: string; png: Uint8Array }[] = []
  let note: string | undefined
  try {
    const pxPerMm = protoScale(design.pcb, PICTURE_WIDTH)
    for (const side of ["top", "bottom"] as const) pngs.push({ file: pictures[side], png: await encodePng(protoPicture(design.pcb, side, pxPerMm), options.canvas ?? loadCanvas) })
  } catch (error) {
    if (!canvasMissing(error)) throw error
    note = "The pictures were left out: drawing them needs the optional package @napi-rs/canvas."
  }
  const sheet = buildSheet({ name, grid, circuit: design.circuit, layout: design.pcb, ...(pngs.length === 2 ? { pictures } : {}) })
  const writes = [{ file: `${name}-build.md`, bytes: new TextEncoder().encode(sheet) }, ...pngs.map((one) => ({ file: one.file, bytes: one.png }))]
  for (const one of writes) {
    const target = resolve(root, local(one.file))
    await assertLandsInProject(root, target)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, one.bytes)
  }
  return { files: writes.map((one) => local(one.file)), ...(note ? { note } : {}) }
}
