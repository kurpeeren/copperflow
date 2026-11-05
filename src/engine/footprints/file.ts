import { parse } from "yaml"
import { z } from "zod"
import type { Point } from "../model.js"
import type { Footprint, Pad } from "./types.js"

/** Free space the courtyard keeps around the pads when the file draws none, in mm. */
export const DEFAULT_COURTYARD_EXCESS = 0.25

const length = z.number().finite()
const size = z.number().finite().positive()
const point = z.tuple([length, length])

const PadEntrySchema = z
  .object({
    number: z.string().regex(/^[1-9][0-9]*$/, "pad numbers are pin numbers: digits, starting at 1"),
    shape: z.enum(["rect", "roundrect", "circle", "oval"]),
    x: length,
    y: length,
    width: size,
    height: size,
    rotation: length.optional(),
    layers: z.enum(["top", "through"]).optional(),
    drill: z.union([size, z.object({ width: size, height: size }).strict()]).optional(),
  })
  .strict()

/** The land pattern as a person writes it in footprint.yaml: pads in mm, y up, origin at the part centre. */
export const FootprintFileSchema = z
  .object({
    pads: z.array(PadEntrySchema).min(1),
    courtyard: z.array(point).min(3).optional(),
    silkscreen: z.array(z.array(point).min(2)).optional(),
    body: z.array(point).min(3).optional(),
  })
  .strict()

export type FootprintFile = z.infer<typeof FootprintFileSchema>

interface PinList {
  pins: Readonly<Record<string, { name: string; type: string }>>
}

/**
 * The footprint a footprint.yaml describes, or an error that names the file and, for pad
 * problems, the pad. Which pins the part has is checked separately, with `pinErrors`.
 */
export function footprintFromFile(path: string, text: string): Footprint | { error: string } {
  const failure = (reason: string) => ({ error: `${path}: ${reason}` })
  let data: unknown
  try {
    data = parse(text)
  } catch (error) {
    return failure(`not valid YAML (${(error as Error).message.split("\n")[0]})`)
  }
  const parsed = FootprintFileSchema.safeParse(padNumbersAsText(data))
  if (!parsed.success) return failure(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "))
  const problems = padErrors(parsed.data)
  if (problems.length > 0) return failure(problems.join("; "))
  return buildFootprint(path, parsed.data)
}

/** Problems with single pads: a hole belongs to through pads only, and every through pad needs one. */
export function padErrors(file: FootprintFile): string[] {
  const problems: string[] = []
  for (const [index, pad] of file.pads.entries()) {
    const label = `pad ${pad.number} (entry ${index + 1})`
    const through = pad.layers === "through"
    if (through && pad.drill === undefined) problems.push(`${label} is a through pad and needs a drill`)
    if (!through && pad.drill !== undefined) problems.push(`${label} is a top pad and must not have a drill`)
  }
  return problems
}

/**
 * Problems between the pads and the part's pins: a pad must belong to a pin, and every pin
 * except no_connect needs a pad. Several pads may share a number.
 */
export function pinErrors(file: { pads: readonly { number: string }[] }, part: PinList): string[] {
  const padNumbers = new Set(file.pads.map((pad) => pad.number))
  const unknown = [...padNumbers].filter((number) => !(number in part.pins))
  const missing = Object.entries(part.pins).filter(([number, pin]) => pin.type !== "no_connect" && !padNumbers.has(number))
  return [
    ...unknown.map((number) => `pad ${number} is not a pin in part.yaml`),
    ...missing.map(([number, pin]) => `pin ${number} (${pin.name}) has no pad`),
  ]
}

function buildFootprint(path: string, file: FootprintFile): Footprint {
  const pads = file.pads.map(toPad)
  const toPoint = ([x, y]: [number, number]): Point => ({ x, y })
  const closed = (points: Point[]) => [...points, ...(points[0] ? [points[0]] : [])]
  return {
    name: path,
    pads,
    courtyard: file.courtyard ? file.courtyard.map(toPoint) : paddedBounds(pads, DEFAULT_COURTYARD_EXCESS),
    silkscreen: (file.silkscreen ?? []).map((line) => line.map(toPoint)),
    fabrication: file.body ? [closed(file.body.map(toPoint))] : [],
    origin: `copperflow footprint file ${path}`,
  }
}

function toPad(entry: FootprintFile["pads"][number]): Pad {
  const drill = typeof entry.drill === "number" ? { width: entry.drill, height: entry.drill } : entry.drill
  return {
    number: entry.number,
    shape: entry.shape,
    x: entry.x,
    y: entry.y,
    width: entry.width,
    height: entry.height,
    rotation: entry.rotation ?? 0,
    layers: entry.layers ?? "top",
    ...(drill ? { drill: { ...drill } } : {}),
  }
}

/** A rectangle around every pad, counter-clockwise from the lower left, `excess` mm larger on each side. */
function paddedBounds(pads: readonly Pad[], excess: number): Point[] {
  const boxes = pads.map((pad) => {
    const angle = (pad.rotation * Math.PI) / 180
    const halfX = (Math.abs(pad.width * Math.cos(angle)) + Math.abs(pad.height * Math.sin(angle))) / 2
    const halfY = (Math.abs(pad.width * Math.sin(angle)) + Math.abs(pad.height * Math.cos(angle))) / 2
    return { minX: pad.x - halfX, maxX: pad.x + halfX, minY: pad.y - halfY, maxY: pad.y + halfY }
  })
  const minX = Math.min(...boxes.map((b) => b.minX)) - excess
  const maxX = Math.max(...boxes.map((b) => b.maxX)) + excess
  const minY = Math.min(...boxes.map((b) => b.minY)) - excess
  const maxY = Math.max(...boxes.map((b) => b.maxY)) + excess
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]
}

/** People write `number: 1` in YAML; pad numbers are text, so a whole number becomes its digits. */
function padNumbersAsText(data: unknown): unknown {
  if (data === null || typeof data !== "object" || !Array.isArray((data as { pads?: unknown }).pads)) return data
  const pads = (data as { pads: unknown[] }).pads.map((pad) =>
    pad !== null && typeof pad === "object" && Number.isInteger((pad as { number?: unknown }).number)
      ? { ...pad, number: String((pad as { number: number }).number) }
      : pad,
  )
  return { ...data, pads }
}
