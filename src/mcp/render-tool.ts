// The render tool: a PNG of the board or of one schematic page, drawn by the Studio's own code, or of the bare board as
// made (mask, finish, print, holes) drawn from the fabrication layers; and one line saying what it shows.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import type { DesignSource } from "../core/design-source.js"
import { changeRequest } from "../core/change-render.js"
import { renderCircuit, renderedLine, type Renderer } from "../core/render.js"
import { FINISH_NAMES, MASK_NAMES, SILK_NAMES, type LookRequest } from "../engine/fab/picture/looks.js"

export const RENDER_DESCRIPTION =
  "A PNG of the board or one schematic page, as the person sees it; view board: the bare board as made. Look after autoplace and after autoroute, before asking the person."

export const renderInput = {
  file: z.string().describe("Circuit file"),
  view: z.enum(["pcb", "schematic", "board"]).optional().describe('Default "pcb"'),
  page: z.string().optional(),
  parts: z.array(z.string()).min(1).max(50).optional().describe('Zoom to these, e.g. ["U1"]'),
  width: z.number().int().min(320).max(4000).optional().describe("Pixels; default 1024"),
  side: z.enum(["top", "bottom"]).optional(),
  look: z
    .object({ mask: z.enum(MASK_NAMES as [string, ...string[]]), silk: z.enum(SILK_NAMES as [string, ...string[]]), finish: z.enum(FINISH_NAMES as [string, ...string[]]), background: z.string() })
    .partial()
    .optional(),
  change: z.string().optional().describe("Mark what this change did"),
  since: z.string().optional().describe("Mark all after it"),
}

export interface RenderPorts {
  root: string
  engine?: DesignSource
  renderer?: () => Promise<Renderer>
}

type RenderInput = { file: string; view?: "pcb" | "schematic" | "board" | undefined; side?: "top" | "bottom" | undefined; look?: Record<string, string | undefined> | undefined; page?: string | undefined; parts?: string[] | undefined; width?: number | undefined; change?: string | undefined; since?: string | undefined }

/** The image and its line, or the refusal as an error answer. */
export async function renderTool(ports: RenderPorts, input: RenderInput): Promise<CallToolResult> {
  try {
    const request = {
      view: input.view ?? "pcb",
      ...(input.page !== undefined ? { page: input.page } : {}),
      ...(input.parts !== undefined ? { parts: input.parts } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.side !== undefined ? { side: input.side } : {}),
      ...(input.look !== undefined ? { look: input.look as LookRequest } : {}),
    } as const
    const options = { ...(ports.engine ? { engine: ports.engine } : {}), ...(ports.renderer ? { renderer: ports.renderer } : {}) }
    const marked = await changeRequest(ports.root, input.file, request, input, ports.engine)
    const rendered = marked
      ? await renderCircuit(ports.root, input.file, marked.request, { ...options, design: marked.design })
      : await renderCircuit(ports.root, input.file, request, options)
    return {
      content: [
        { type: "image", data: Buffer.from(rendered.png).toString("base64"), mimeType: "image/png" },
        { type: "text", text: renderedLine(rendered) },
      ],
    }
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: (error as Error).message }] }
  }
}
