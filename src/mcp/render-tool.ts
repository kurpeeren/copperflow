// The render tool: a PNG of the board or of one schematic page, drawn by the Studio's own code, or of the bare board as
// made (mask, finish, print, holes) drawn from the fabrication layers; and one line saying what it shows.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { randomBytes } from "node:crypto"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname, relative, sep } from "node:path"
import { z } from "zod"
import type { DesignSource } from "../core/design-source.js"
import { changeRequest } from "../core/change-render.js"
import { assertLandsInProject } from "../core/fabrication.js"
import { inProjectQueue } from "../core/file-writes.js"
import { refuseStreamName } from "../core/html-export.js"
import { resolveInRoot } from "../core/workspace.js"
import { renderCircuit, renderedLine, type Renderer } from "../core/render.js"
import { FINISH_NAMES, MASK_NAMES, SILK_NAMES, type LookRequest } from "../engine/fab/picture/looks.js"
import { stepsAroundBuild } from "./build-steps.js"
import { QUIET, type Reporter } from "./tool-activity.js"

export const RENDER_DESCRIPTION =
  "A PNG of the board or a schematic page as the person sees it; board: the bare board as made; 3d: parts as simple shapes. Look after autoplace and autoroute."

export const renderInput = {
  file: z.string().describe("Circuit file"),
  view: z.enum(["pcb", "schematic", "board", "3d"]).optional().describe('Default "pcb"'),
  page: z.string().optional(),
  parts: z.array(z.string()).min(1).max(50).optional().describe("Zoom to these"),
  width: z.number().int().min(320).max(4000).optional().describe("Pixels; default 1024"),
  side: z.enum(["top", "bottom"]).optional(),
  angle: z.enum(["top", "bottom", "front", "iso"]).optional(),
  look: z
    .object({ mask: z.enum(MASK_NAMES as [string, ...string[]]), silk: z.enum(SILK_NAMES as [string, ...string[]]), finish: z.enum(FINISH_NAMES as [string, ...string[]]), background: z.string() })
    .partial()
    .optional(),
  change: z.string().optional().describe("Mark this change"),
  reference: z.boolean().optional().describe("Reference images under the PCB"),
  since: z.string().optional().describe("Mark all after it"),
  out: z.string().optional().describe("Also write it, e.g. pics/top.png"),
}

export interface RenderPorts {
  root: string
  engine?: DesignSource
  renderer?: () => Promise<Renderer>
  /** Hears the steps of a 3D view, the slow one: the build, then the drawing. */
  report?: Reporter
}

type RenderInput = { reference?: boolean | undefined; file: string; view?: "pcb" | "schematic" | "board" | "3d" | undefined; side?: "top" | "bottom" | undefined; angle?: "top" | "bottom" | "front" | "iso" | undefined; look?: Record<string, string | undefined> | undefined; page?: string | undefined; parts?: string[] | undefined; width?: number | undefined; change?: string | undefined; since?: string | undefined; out?: string | undefined }

/** The image and its line, or the refusal as an error answer. */
export async function renderTool(ports: RenderPorts, input: RenderInput): Promise<CallToolResult> {
  try {
    if (input.out !== undefined && !input.out.toLowerCase().endsWith(".png")) throw new Error(`out takes a project file ending in .png (got ${input.out}); nothing was drawn`)
    if (input.out !== undefined) refuseStreamName(input.out)
    if (input.out !== undefined) await assertLandsInProject(ports.root, resolveInRoot(ports.root, input.out))
    const request = {
      view: input.view ?? "pcb",
      ...(input.page !== undefined ? { page: input.page } : {}),
      ...(input.parts !== undefined ? { parts: input.parts } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.side !== undefined ? { side: input.side } : {}),
      ...(input.angle !== undefined ? { angle: input.angle } : {}),
      ...(input.look !== undefined ? { look: input.look as LookRequest } : {}),
      ...(input.reference ? { reference: true } : {}),
    } as const
    const engine = request.view === "3d" ? stepsAroundBuild(ports.engine, ports.report ?? QUIET, "Drawing the 3D view") : ports.engine
    const options = { ...(engine ? { engine } : {}), ...(ports.renderer ? { renderer: ports.renderer } : {}) }
    const marked = await changeRequest(ports.root, input.file, request, input, engine)
    const rendered = marked
      ? await renderCircuit(ports.root, input.file, marked.request, { ...options, design: marked.design })
      : await renderCircuit(ports.root, input.file, request, options)
    const written = input.out === undefined ? [] : [`Wrote ${await writePicture(ports.root, input.out, rendered.png)}`]
    return {
      content: [
        { type: "image", data: Buffer.from(rendered.png).toString("base64"), mimeType: "image/png" },
        { type: "text", text: [renderedLine(rendered), ...written].join("\n") },
      ],
    }
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: (error as Error).message }] }
  }
}

/** Writes the picture to a project path (folders made as needed) and answers that path; refuses one outside the project. */
function writePicture(root: string, out: string, png: Uint8Array): Promise<string> {
  return inProjectQueue(root, async () => {
    const path = resolveInRoot(root, out)
    await assertLandsInProject(root, path)
    await mkdir(dirname(path), { recursive: true })
    // Through a temporary file and a rename, as writeFileAtomic does for text: no reader sees half a picture.
    const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
    await writeFile(temp, png)
    await rename(temp, path).catch(async (error: unknown) => {
      await rm(temp, { force: true })
      throw error
    })
    return relative(root, path).split(sep).join("/")
  })
}
