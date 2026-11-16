// import_board: the board's outline, mounting holes and inner shapes from a DXF drawing in the project folder, as ONE
// change by the agent (core/board-import.ts).
import { z } from "zod"
import { formatBoardImport, importBoard } from "../core/index.js"
import type { Ports } from "./copper-tools.js"

export const importBoardInput = {
  file: z.string().describe("Circuit file, e.g. index.circuit.tsx"),
  dxf: z.string().describe("The ASCII DXF drawing, a path inside the project folder, e.g. enclosure.dxf"),
  layer: z.string().optional().describe("Only this layer's shapes may make the outline"),
  units: z.enum(["mm", "inch"]).optional().describe("Overrides the drawing's own units"),
  origin: z.enum(["centre", "keep"]).optional().describe('"centre" (default) centres the outline on the origin; "keep" leaves it as drawn'),
  replace: z.boolean().optional().describe("Replace the board's holes and keepouts; without it a board that has some is refused"),
}

export const IMPORT_BOARD_DESCRIPTION =
  "Set the board from a mechanical DXF drawing as ONE change: the largest closed shape is the outline, circles inside it are mounting holes, other closed shapes inside it become keepouts (not cut out). Placed parts are not moved; the answer lists those now outside. Then render to look."

export async function importBoardTool(ports: Ports, input: { file: string; dxf: string; layer?: string | undefined; units?: "mm" | "inch" | undefined; origin?: "centre" | "keep" | undefined; replace?: boolean | undefined }): Promise<string> {
  try {
    const { file, ...options } = input
    const result = await importBoard(ports.root, file, options, { author: "ai", ...(ports.engine ? { engine: ports.engine } : {}) })
    return formatBoardImport(result).join("\n")
  } catch (error) {
    const reason = (error as Error).message.replace(/\.$/, "")
    throw new Error(`import_board was refused: ${reason}. Nothing was written.`)
  }
}
