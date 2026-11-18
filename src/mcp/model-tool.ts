// The export_model tool: the board and its parts as one 3D model file, a STEP file for mechanical CAD or a GLB file
// for a 3D viewer. Unlike export_fabrication it writes a design that still has errors: the file is a look at the
// board's shape, not an order.
import { z } from "zod"
import type { DesignSource } from "../core/design-source.js"
import { exportGlb, formatGlbExport, type Modeller } from "../core/model-export.js"
import { exportStep, formatStepExport } from "../core/step-export.js"
import type { LookRequest } from "../engine/fab/picture/looks.js"

export const EXPORT_MODEL_DESCRIPTION =
  'Write the board and its parts as one 3D model file beside the circuit: a STEP file for mechanical CAD (parts as boxes) or a GLB file a 3D viewer turns (the board as made). An unfinished design is written too.'

export const exportModelInput = {
  file: z.string().describe("Circuit file"),
  format: z.enum(["step", "glb"]),
  out: z.string().optional().describe("Project file, e.g. cad/board.step"),
  // The names are render's; a wrong one is refused with the list, which costs the tool list nothing.
  look: z.object({ mask: z.string(), silk: z.string(), finish: z.string() }).partial().optional().describe("glb only, as render's"),
}

export interface ModelPorts {
  root: string
  engine?: DesignSource
  renderer?: () => Promise<Modeller>
}

type ModelInput = { file: string; format: "step" | "glb"; out?: string | undefined; look?: Record<string, string | undefined> | undefined }

/** Writes the file and answers the lines the CLI's step and glb commands print. */
export async function exportModelTool(ports: ModelPorts, input: ModelInput): Promise<string> {
  if (input.out !== undefined && !input.out.toLowerCase().endsWith(`.${input.format}`)) throw new Error(`out takes a file ending in .${input.format} (got ${input.out})`)
  const options = { ...(ports.engine ? { engine: ports.engine } : {}), ...(input.out !== undefined ? { out: input.out } : {}) }
  if (input.format === "step") {
    if (Object.values(input.look ?? {}).some((value) => value !== undefined)) throw new Error("look is for format glb: a STEP file has no colours of the board as made")
    return formatStepExport(await exportStep(ports.root, input.file, options))
  }
  return formatGlbExport(await exportGlb(ports.root, input.file, { ...options, ...(input.look !== undefined ? { look: input.look as LookRequest } : {}), ...(ports.renderer ? { renderer: ports.renderer } : {}) }))
}
