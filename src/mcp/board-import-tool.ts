// fit_board { drawing }: the board's outline, mounting holes and inner shapes from a DXF or SVG drawing in the project folder, as ONE
// change by the agent (core/board-import.ts); or, for a KiCad board (.kicad_pcb), a whole new circuit (library/kicad).
import { formatBoardImport, importBoard } from "../core/index.js"
import type { Ports } from "./copper-tools.js"
import { formatKicadImport, importKicad } from "../library/kicad/import.js"

export async function importBoardTool(ports: Ports, input: { file: string; dxf: string; layer?: string | undefined; units?: "mm" | "inch" | undefined; origin?: "centre" | "keep" | undefined; replace?: boolean | undefined }): Promise<string> {
  try {
    if (/\.kicad_pcb$/i.test(input.dxf)) return await kicadTool(ports, input)
    const { file, ...options } = input
    const result = await importBoard(ports.root, file, options, { author: "ai", ...(ports.engine ? { engine: ports.engine } : {}) })
    return formatBoardImport(result).join("\n")
  } catch (error) {
    const reason = (error as Error).message.replace(/\.$/, "")
    throw new Error(`fit_board { drawing } was refused: ${reason}. Nothing was written.`)
  }
}

async function kicadTool(ports: Ports, input: { file: string; dxf: string; layer?: string | undefined; units?: string | undefined; origin?: "centre" | "keep" | undefined; replace?: boolean | undefined }): Promise<string> {
  if (input.layer !== undefined || input.units !== undefined) throw new Error("dxfLayer and units are for a DXF drawing; a KiCad board's outline is its Edge.Cuts layer, in mm")
  const options = { kicad: input.dxf, file: input.file, ...(input.replace ? { replace: true } : {}), ...(input.origin ? { origin: input.origin } : {}) }
  const result = await importKicad(ports.root, options, { author: "ai", inProject: true, ...(ports.engine ? { engine: ports.engine } : {}) })
  return formatKicadImport(result).join("\n")
}
