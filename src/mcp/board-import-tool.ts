// import_board: the board's outline, mounting holes and inner shapes from a DXF drawing in the project folder, as ONE
// change by the agent (core/board-import.ts); or, for a KiCad board (.kicad_pcb), a whole new circuit (library/kicad).
import { z } from "zod"
import { formatBoardImport, importBoard } from "../core/index.js"
import type { Ports } from "./copper-tools.js"
import { formatKicadImport, importKicad } from "../library/kicad/import.js"

export const importBoardInput = {
  file: z.string().describe("Circuit file, e.g. index.circuit.tsx; for a KiCad board, the new one"),
  dxf: z.string().describe("The ASCII DXF drawing or KiCad board, a path inside the project folder, e.g. enclosure.dxf or old.kicad_pcb"),
  layer: z.string().optional().describe("Only this layer's shapes may make the outline"),
  units: z.enum(["mm", "inch"]).optional().describe("Overrides the drawing's own units"),
  origin: z.enum(["centre", "keep"]).optional().describe('"centre" (default) centres the outline on the origin; "keep" leaves it as drawn'),
  replace: z.boolean().optional().describe("Replace the board's holes and keepouts; without it a board that has some is refused"),
}

export const IMPORT_BOARD_DESCRIPTION =
  "Set the board from a DXF drawing as ONE change: the largest closed shape is the outline, circles in it mounting holes, other shapes keepouts. Parts are not moved; the answer lists those now outside. A .kicad_pcb instead makes file a new circuit (outline, parts, nets, copper); the answer lists what did not come over."

export async function importBoardTool(ports: Ports, input: { file: string; dxf: string; layer?: string | undefined; units?: "mm" | "inch" | undefined; origin?: "centre" | "keep" | undefined; replace?: boolean | undefined }): Promise<string> {
  try {
    if (/\.kicad_pcb$/i.test(input.dxf)) return await kicadTool(ports, input)
    const { file, ...options } = input
    const result = await importBoard(ports.root, file, options, { author: "ai", ...(ports.engine ? { engine: ports.engine } : {}) })
    return formatBoardImport(result).join("\n")
  } catch (error) {
    const reason = (error as Error).message.replace(/\.$/, "")
    throw new Error(`import_board was refused: ${reason}. Nothing was written.`)
  }
}

async function kicadTool(ports: Ports, input: { file: string; dxf: string; layer?: string | undefined; units?: string | undefined; origin?: "centre" | "keep" | undefined; replace?: boolean | undefined }): Promise<string> {
  if (input.layer !== undefined || input.units !== undefined) throw new Error("layer and units are for a DXF drawing; a KiCad board's outline is its Edge.Cuts layer, in mm")
  const options = { kicad: input.dxf, file: input.file, ...(input.replace ? { replace: true } : {}), ...(input.origin ? { origin: input.origin } : {}) }
  const result = await importKicad(ports.root, options, { author: "ai", inProject: true, ...(ports.engine ? { engine: ports.engine } : {}) })
  return formatKicadImport(result).join("\n")
}
