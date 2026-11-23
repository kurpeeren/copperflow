// import_graphic: a drawing (SVG or DXF) in the project placed on the board as ONE change (core/graphic-import.ts).
// The agent writes the SVG text with its own file tools first; edit_circuit's set_drawing and remove_drawing reach it.
// With layer "reference" it adds, aligns or removes a reference image instead (core/references.ts): a photo, scan or
// Gerber layer drawn under the PCB to redraw an existing board, never made. Its settings come in `reference`, a free
// object checked here, so the tool list stays short; the guide's copper topic shows it.
import { z } from "zod"
import { formatGraphicImport, importGraphic } from "../core/graphic-import.js"
import { addReference, formatReference, removeReference, setReference, type ReferenceChanges } from "../core/references.js"
import type { Ports } from "./copper-tools.js"

export const importGraphicInput = {
  file: z.string(),
  source: z.string().optional(),
  layer: z.enum(["top-silkscreen", "bottom-silkscreen", "top-mask", "bottom-mask", "top", "bottom", "inner1", "inner2", "reference"]),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  scale: z.number().optional(),
  rotation: z.number().optional(),
  fill: z.boolean().optional(),
  name: z.string().optional(),
  net: z.string().optional(),
  reference: z.record(z.string(), z.unknown()).optional(),
}

export const IMPORT_GRAPHIC_DESCRIPTION =
  'Place a drawing (logo, mark) from source, a project .svg/.dxf, on the board as ONE change. Centre x,y and width in mm (else board centre); fill fills closed outlines; net (copper) makes it that net\'s copper. layer reference: a photo or Gerber under the PCB to redraw a board, never exported: guide { topic: "copper" }.'

/** A point as the agent writes it: [pixel x, pixel y, board x, board y]. */
const point = z.tuple([z.number(), z.number(), z.number(), z.number()])
const ReferenceInput = z
  .object({
    id: z.string().optional(),
    points: z.array(point).max(20).optional(),
    mirror: z.boolean().optional(),
    opacity: z.number().min(0).max(1).optional(),
    shown: z.boolean().optional(),
    remove: z.boolean().optional(),
  })
  .strict()

type Input = { file: string; source?: string | undefined; layer: string; reference?: Record<string, unknown> | undefined } & Partial<Record<"x" | "y" | "width" | "scale" | "rotation", number>> & {
    fill?: boolean | undefined
    name?: string | undefined
    net?: string | undefined
  }

const GRAPHIC_ONLY = ["x", "y", "width", "scale", "rotation", "fill", "name", "net"] as const

/** The reference settings, checked; a wrong one is named with what it takes. */
function referenceSettings(input: Input): z.infer<typeof ReferenceInput> {
  const parsed = ReferenceInput.safeParse(input.reference ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`${["reference", ...(issue?.path ?? [])].join(".")}: ${issue?.message ?? "not valid"}; it takes { id?, points?: [[pixel x, pixel y, board x, board y], …], mirror?, opacity? (0 to 1), shown?, remove? }`)
  }
  const graphic = GRAPHIC_ONLY.find((key) => input[key] !== undefined)
  if (graphic !== undefined) throw new Error(`${graphic} is for a drawing; a reference image is placed by reference.points`)
  return parsed.data
}

async function referenceTool(ports: Ports, input: Input): Promise<string> {
  const { id, remove, points, ...rest } = referenceSettings(input)
  const changes: ReferenceChanges = { ...rest, ...(points ? { points: points.map(([px, py, x, y]) => ({ image: { x: px, y: py }, board: { x, y } })) } : {}) }
  const meta = { author: "ai" as const }
  if (id === undefined) {
    if (remove) throw new Error("reference.remove needs reference.id")
    if (input.source === undefined) throw new Error("give source, the image or Gerber file in the project, or reference.id to change one")
    return formatReference(await addReference(ports.root, input.file, { source: input.source, ...changes }, meta)).join("\n")
  }
  if (input.source !== undefined) throw new Error("give source to add an image, or reference.id to change one, not both")
  if (remove) return formatReference(await removeReference(ports.root, input.file, id, meta)).join("\n")
  if (Object.keys(changes).length === 0) throw new Error(`reference ${id}: say what to change (points, mirror, opacity, shown) or remove`)
  return formatReference(await setReference(ports.root, input.file, id, changes, meta)).join("\n")
}

export async function importGraphicTool(ports: Ports, input: Input): Promise<string> {
  try {
    if (input.layer === "reference") return await referenceTool(ports, input)
    if (input.reference !== undefined) throw new Error("reference is for layer reference")
    const { file, source, reference: _reference, ...options } = input
    if (source === undefined) throw new Error("give source, the drawing in the project")
    const result = await importGraphic(ports.root, file, { source, ...options }, { author: "ai", ...(ports.engine ? { engine: ports.engine } : {}) })
    return formatGraphicImport(result).join("\n")
  } catch (error) {
    const reason = (error as Error).message.replace(/\.$/, "").replace(/\. Nothing was written$/, "")
    throw new Error(`import_graphic was refused: ${reason}. Nothing was written.`)
  }
}
