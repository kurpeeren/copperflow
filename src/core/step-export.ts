// Writes a circuit's board and parts as a STEP file alone (copperflow step): `<name>.step` beside the circuit, or the
// project file given. The design is built, made into solids and written; a design with errors is still written, since
// the file is a look at the shape, not an order. The parts are written as the 3D view draws them, in colour, from the
// Studio's renderer bundle (part-shapes.ts); without it they are boxes, and the answer says why.
import { refuseStreamName } from "./out-name.js"
import { mkdir, writeFile } from "node:fs/promises"
import { basename, dirname, join, relative, sep } from "node:path"
import { designName } from "../engine/fab/names.js"
import { modelLine, stepFileName } from "../engine/solid/limits.js"
import { solidModel } from "../engine/solid/model.js"
import { stepText } from "../engine/solid/step.js"
import { loadPartShapes, type ShapesLoader } from "./part-shapes.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { assertLandsInProject } from "./fabrication.js"
import { inProjectQueue } from "./file-writes.js"
import { resolveCircuit, resolveInRoot } from "./workspace.js"

export interface StepExport {
  /** The file written, relative to the project root with "/" between folders. */
  file: string
  /** True when the design has a board outline. */
  board: boolean
  parts: number
  /** True when the parts are written as their 3D view's shapes, false when they are boxes. */
  shaped: boolean
  /** What the model is not, and whose heights it assumes. */
  model: string
}

/** Builds the circuit and writes its STEP file to `out` (a project path ending in .step) or beside the circuit. */
export function exportStep(root: string, file: string, options: { engine?: DesignSource; out?: string; shapes?: ShapesLoader } = {}): Promise<StepExport> {
  if (options.out !== undefined && !options.out.toLowerCase().endsWith(".step")) throw new Error(`--out takes a file ending in .step (got ${options.out})`)
  if (options.out !== undefined) refuseStreamName(options.out)
  return inProjectQueue(root, async () => {
    const { file: circuit } = await resolveCircuit(root, file)
    const name = designName(circuit)
    const path = resolveInRoot(root, options.out ?? join(dirname(circuit), stepFileName(name)))
    await assertLandsInProject(root, path)
    const design = await buildWith(root, circuit, options.engine)
    const model = solidModel(design)
    const shapes = await loadPartShapes(design, model, options.shapes)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, stepText(model, name, shapes.faces), "utf8")
    const shaped = shapes.faces !== undefined
    return { file: relative(root, path).split(sep).join("/"), board: model.board !== undefined, parts: model.parts.length, shaped, model: modelLine(basename(path), model.parts, shapes) }
  })
}

/** "Wrote led.step: the board as a solid and 2 parts as coloured faces." (or "the board and 2 parts as solids.") and the model's line. */
export function formatStepExport(result: StepExport): string {
  const parts = `${result.parts} ${result.parts === 1 ? "part" : "parts"}`
  const what = result.shaped
    ? `${result.board ? `the board as a solid and ${parts}` : parts} as coloured faces${result.board ? "" : " (no board outline)"}`
    : `${result.board ? `the board and ${parts}` : `${parts} (no board outline)`} as solids`
  return [`Wrote ${result.file}: ${what}.`, result.model].join("\n")
}
