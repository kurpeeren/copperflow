// A reference image in the layout file: a photo, a scan or a Gerber layer (kept as an SVG) of an existing board, drawn
// under the PCB to redraw it. One JSON line `{"t":"reference", …}` per image beside the copper; it is never copper and
// never made: the build carries it to the Studio and the renderer only, and no export reads it. Pure text handling.
import type { ReferencePoint } from "../engine/reference-fit.js"

export type { ReferencePoint }

export interface ReferenceRecord {
  t: "reference"
  /** r1, r2, … */
  id: string
  /** The image in the project, under references/: .png, .jpg or .svg. */
  file: string
  /** The file it was made from when that was not an image (a Gerber layer). */
  source?: string
  /** The image's size in pixels. */
  width: number
  height: number
  /** Flipped left to right first: a photo of the bottom side is a mirror image. */
  mirror: boolean
  /** Picked pairs, each a pixel of the image and the board point in mm it belongs on. */
  points: ReferencePoint[]
  /** One pixel in mm, for an image with its own scale (a Gerber's); without points it is drawn at that scale. */
  pixel?: number
  /** 0 (clear) to 1 (solid). */
  opacity: number
  shown: boolean
}

export const REFERENCE_FIELDS = ["t", "id", "file", "source", "width", "height", "mirror", "points", "pixel", "opacity", "shown"] as const
export const REFERENCE_ID = /^r([1-9]\d*)$/
/** How opaque a new reference is drawn. */
export const DEFAULT_OPACITY = 0.5
/** The most points a reference keeps. */
export const MAX_REFERENCE_POINTS = 20
const IMAGE_FILE = /^references\/[^/]+\.(png|jpe?g|svg)$/i

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const isXY = (value: unknown): boolean => isObject(value) && Object.keys(value).length === 2 && Number.isFinite(value.x) && Number.isFinite(value.y)
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0

function pointProblems(points: unknown): string[] {
  if (!Array.isArray(points)) return ["points must be a list"]
  if (points.length > MAX_REFERENCE_POINTS) return [`points may hold at most ${MAX_REFERENCE_POINTS} pairs`]
  const bad = points.findIndex((p) => !isObject(p) || Object.keys(p).length !== 2 || !isXY(p.image) || !isXY(p.board))
  return bad < 0 ? [] : [`points[${bad}] must be {image: {x, y}, board: {x, y}} with finite numbers`]
}

/** The problems with a reference line's fields, none when it is good. */
export function referenceProblems(raw: Record<string, unknown>): string[] {
  const problems = Object.keys(raw)
    .filter((key) => !(REFERENCE_FIELDS as readonly string[]).includes(key))
    .map((key) => `unknown field ${key}`)
  if (typeof raw.file !== "string" || !IMAGE_FILE.test(raw.file)) problems.push("file must be a .png, .jpg or .svg under references/")
  if (raw.source !== undefined && (typeof raw.source !== "string" || raw.source === "")) problems.push("source must be a file name when given")
  if (!positive(raw.width) || !positive(raw.height)) problems.push("width and height must be the image's size in pixels")
  if (raw.mirror !== undefined && typeof raw.mirror !== "boolean") problems.push("mirror must be true or false")
  if (raw.shown !== undefined && typeof raw.shown !== "boolean") problems.push("shown must be true or false")
  if (raw.pixel !== undefined && !positive(raw.pixel)) problems.push("pixel must be a size in mm above 0")
  if (raw.opacity !== undefined && !(typeof raw.opacity === "number" && raw.opacity >= 0 && raw.opacity <= 1)) problems.push("opacity must be from 0 to 1")
  return [...problems, ...pointProblems(raw.points ?? [])]
}

const xy = (p: { x: number; y: number }) => ({ x: p.x, y: p.y })

/** Checks one reference line; returns it in canonical form with the defaults filled in, or its problems. */
export function checkReference(raw: Record<string, unknown>): { record: ReferenceRecord } | { problems: string[]; id?: string } {
  if (typeof raw.id !== "string" || !REFERENCE_ID.test(raw.id)) return { problems: ["id must look like r1"] }
  const problems = referenceProblems(raw)
  if (problems.length > 0) return { problems, id: raw.id }
  const points = (raw.points ?? []) as ReferencePoint[]
  return {
    record: {
      t: "reference",
      id: raw.id,
      file: raw.file as string,
      ...(raw.source === undefined ? {} : { source: raw.source as string }),
      width: raw.width as number,
      height: raw.height as number,
      mirror: raw.mirror === true,
      points: points.map((p) => ({ image: xy(p.image), board: xy(p.board) })),
      ...(raw.pixel === undefined ? {} : { pixel: raw.pixel as number }),
      opacity: (raw.opacity ?? DEFAULT_OPACITY) as number,
      shown: raw.shown !== false,
    },
  }
}

/** One line per reference, fields in a fixed order, a newline after each. */
export function serializeReferences(references: readonly ReferenceRecord[]): string {
  return references
    .map((record) => {
      const source = record as unknown as Record<string, unknown>
      return `${JSON.stringify(Object.fromEntries(REFERENCE_FIELDS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])))}\n`
    })
    .join("")
}

/** The id a new reference gets: one past the highest there. */
export function nextReferenceId(references: readonly ReferenceRecord[]): string {
  const highest = Math.max(0, ...references.map((r) => Number(REFERENCE_ID.exec(r.id)?.[1] ?? 0)))
  return `r${highest + 1}`
}
