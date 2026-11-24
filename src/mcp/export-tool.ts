// export: the files the design is handed on as, one kind per call. Each kind is what a tool of its own wrote before the
// tool fold (export_fabrication, export_model, export_html, export_package), through the same handler.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { exportPackage } from "../core/index.js"
import type { DesignSource } from "../core/design-source.js"
import type { Renderer } from "../core/render.js"
import { exportBuildSheet } from "../core/build-sheet.js"
import { exportFabricationTool } from "./fabrication-tool.js"
import { exportHtmlTool } from "./html-tool.js"
import { exportModelTool } from "./model-tool.js"
import type { Reporter } from "./tool-activity.js"

export const EXPORT_KINDS = ["fabrication", "step", "glb", "html", "package", "build"] as const
type Kind = (typeof EXPORT_KINDS)[number]

export const exportInput = {
  file: z.string().describe("Circuit file"),
  as: z.enum(EXPORT_KINDS),
  out: z.string().optional().describe("fabrication: a project folder, e.g. fab; step, glb, html: a project file, e.g. cad/board.step"),
  // The names are render's; a wrong one is refused with the list, which costs the tool list nothing.
  look: z.object({ mask: z.string(), silk: z.string(), finish: z.string() }).partial().optional().describe("glb, html; as render's"),
}

export const EXPORT_DESCRIPTION =
  'Write files from the design. as "fabrication": the JLCPCB files to <name>-fab/ and a zip (Gerbers, drills, pick-and-place and BOM CSVs, pictures of the board as made, a STEP model); call it after a clean check_circuit: a design with errors is refused. "step" or "glb": one 3D model beside the circuit, STEP for mechanical CAD (parts as the 3D view draws them, in colour), GLB for a 3D viewer (the board as made); an unfinished design is written too. "html": one offline page to hand to a person (schematic, board, 3D, BOM, files inside). "package": a folder for whoever orders and checks the parts (BOM, local datasheets, each library part\'s verification status). "build": a perfboard or stripboard build sheet (holes, cut and link lists, pictures).'

export interface ExportPorts {
  root: string
  engine?: DesignSource
  renderer?: () => Promise<Renderer>
  report: Reporter
}

interface ExportInput {
  file: string
  as: Kind
  out?: string | undefined
  look?: Record<string, string | undefined> | undefined
}

const text = (value: string): CallToolResult => ({ content: [{ type: "text", text: value }] })
const refusal = (error: unknown): CallToolResult => ({ isError: true, content: [{ type: "text", text: (error as Error).message }] })

/** Writes the kind asked for; a refused design or argument is an error answer. */
export async function exportTool(ports: ExportPorts, input: ExportInput): Promise<CallToolResult> {
  const { root, report } = ports
  const engine = ports.engine ? { engine: ports.engine } : {}
  const renderer = ports.renderer ? { renderer: ports.renderer } : {}
  try {
    if (input.as === "fabrication" || input.as === "package") refuseLook(input)
    if (input.as === "fabrication") return await exportFabricationTool({ root, ...engine, ...renderer, report }, { file: input.file, ...(input.out ? { out: input.out } : {}) })
    if (input.as === "package") {
      if (input.out !== undefined) throw new Error('out is not taken by as "package": the folder is named after the circuit')
      const result = await exportPackage(root, input.file, engine)
      return text(`Wrote ${result.files.length} files to ${result.outDir}:\n${result.files.join("\n")}`)
    }
    if (input.as === "build") {
      refuseLook(input)
      if (input.out !== undefined) throw new Error('out is not taken by as "build": the sheet is written beside the circuit')
      const result = await exportBuildSheet(root, input.file, engine)
      return text([`Wrote ${result.files.join(", ")}`, ...(result.note ? [result.note] : [])].join("\n"))
    }
    if (input.as === "html") return text(await exportHtmlTool({ root, ...engine, ...renderer, report }, input))
    return text(await exportModelTool({ root, ...engine, ...renderer }, { ...input, format: input.as }))
  } catch (error) {
    return refusal(error)
  }
}

function refuseLook(input: ExportInput): void {
  if (input.look !== undefined) throw new Error(`look is for as "glb" or "html"; as "${input.as}" draws the board as made`)
}
