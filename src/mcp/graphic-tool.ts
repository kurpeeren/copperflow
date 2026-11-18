// import_graphic: a drawing (SVG or DXF) in the project placed on the board as ONE change (core/graphic-import.ts).
// The agent writes the SVG text with its own file tools first; edit_circuit's set_drawing and remove_drawing reach it.
import { z } from "zod"
import { formatGraphicImport, importGraphic } from "../core/graphic-import.js"
import type { Ports } from "./copper-tools.js"

export const importGraphicInput = {
  file: z.string(),
  source: z.string(),
  layer: z.enum(["top-silkscreen", "bottom-silkscreen", "top-mask", "bottom-mask", "top", "bottom", "inner1", "inner2"]),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  scale: z.number().optional(),
  rotation: z.number().optional(),
  fill: z.boolean().optional(),
  name: z.string().optional(),
  net: z.string().optional(),
}

export const IMPORT_GRAPHIC_DESCRIPTION =
  "Place a drawing (logo, mark) from source, a project .svg/.dxf, on the board as ONE change; kept in graphics/. Centre x,y and width in mm (else board centre); width keeps aspect; fill fills closed outlines; net (copper) makes it that net's copper. Answers id, size, omissions."

type Input = { file: string; source: string; layer: string } & Partial<Record<"x" | "y" | "width" | "scale" | "rotation", number>> & { fill?: boolean | undefined; name?: string | undefined; net?: string | undefined }

export async function importGraphicTool(ports: Ports, input: Input): Promise<string> {
  try {
    const { file, ...options } = input
    const result = await importGraphic(ports.root, file, options, { author: "ai", ...(ports.engine ? { engine: ports.engine } : {}) })
    return formatGraphicImport(result).join("\n")
  } catch (error) {
    const reason = (error as Error).message.replace(/\.$/, "").replace(/\. Nothing was written$/, "")
    throw new Error(`import_graphic was refused: ${reason}. Nothing was written.`)
  }
}
