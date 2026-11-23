// POST /api/reference: the Layer panel's reference images. "add" keeps a picked photo, scan or Gerber layer (its bytes
// as base64) under references/; "set" changes points, mirror, opacity or shown; "remove" takes one out. Each is one
// history entry through the core (core/references.ts), as the agent's import_graphic makes them.
import { z } from "zod"
import { addReference, formatReference, MAX_REFERENCE_BYTES, removeReference, setReference } from "../core/references.js"
import { HttpError } from "./http-error.js"

/** The largest request body: a picked image as base64 (a third larger than its bytes), with room for the rest. */
export const MAX_REFERENCE_BODY = Math.ceil((MAX_REFERENCE_BYTES * 4) / 3) + 4096

const file = z.string().min(1).max(500)
const id = z.string().min(1).max(16)
const xy = z.object({ x: z.number().finite(), y: z.number().finite() }).strict()

export const ReferenceBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), file, name: z.string().min(1).max(260), data: z.string().max(MAX_REFERENCE_BODY), mirror: z.boolean().optional() }).strict(),
  z
    .object({
      action: z.literal("set"),
      file,
      id,
      points: z.array(z.object({ image: xy, board: xy }).strict()).max(20).optional(),
      mirror: z.boolean().optional(),
      opacity: z.number().min(0).max(1).optional(),
      shown: z.boolean().optional(),
    })
    .strict(),
  z.object({ action: z.literal("remove"), file, id }).strict(),
])

export type ReferenceRequest = z.infer<typeof ReferenceBody>

/** Does what the request asks; answers the history entry, the reference's id and the answer's first lines. */
export async function referenceRoute(root: string, body: ReferenceRequest): Promise<{ entryId: string; id: string; summary: string }> {
  const meta = { author: "human" as const }
  if (body.action === "add") {
    const bytes = new Uint8Array(Buffer.from(body.data, "base64"))
    if (bytes.length === 0) throw new HttpError(400, `${body.name} is empty`)
    const result = await addReference(root, body.file, { source: { name: body.name, bytes }, ...(body.mirror === undefined ? {} : { mirror: body.mirror }) }, meta)
    return { entryId: result.entry.id, id: result.record.id, summary: formatReference(result)[0] ?? "" }
  }
  if (body.action === "remove") {
    const result = await removeReference(root, body.file, body.id, meta)
    return { entryId: result.entry.id, id: body.id, summary: formatReference(result)[0] ?? "" }
  }
  const { action: _action, file: circuit, id: which, ...changes } = body
  const result = await setReference(root, circuit, which, changes, meta)
  const lines = formatReference(result)
  // With two or more points, how far each point lands is the line worth telling.
  return { entryId: result.entry.id, id: which, summary: (changes.points && changes.points.length >= 2 ? lines[2] : lines[0]) ?? "" }
}
