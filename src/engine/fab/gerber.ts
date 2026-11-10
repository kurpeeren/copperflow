// The Gerber X2 file writer: header and file attributes, apertures (C, R, O and a RoundRect macro), flashes, draws and
// regions (dark, or clear to cut holes), in millimetres with 4.6 coordinates. Pure: it takes shapes in mm and a creation date, and returns the text,
// the same bytes for the same input. copperflow's own code, written from the Gerber format specification.
import type { Point } from "../model.js"
import { VERSION } from "../../version.js"

export type Aperture =
  | { shape: "circle"; diameter: number }
  | { shape: "rect"; width: number; height: number }
  | { shape: "obround"; width: number; height: number }
  /** A rectangle with rounded corners, turned `rotation` degrees counter-clockwise about its centre. */
  | { shape: "roundrect"; width: number; height: number; radius: number; rotation: number }

/** `function` is the X2 aperture function, e.g. "SMDPad,CuDef", "ViaPad", "Conductor" or "Profile". */
export type GerberObject =
  | { kind: "flash"; at: Point; aperture: Aperture; function?: string }
  /** A line through the points drawn with a round aperture of `width`; a single point is flashed. */
  | { kind: "draw"; points: Point[]; width: number; function?: string }
  /** A filled polygon; the last corner joins the first. A `clear` region removes what was drawn before it under it. */
  | { kind: "region"; points: Point[]; function?: string; polarity?: "clear" }

export interface GerberLayer {
  /** The X2 file function, e.g. "Copper,L1,Top", "Soldermask,Bot" or "Profile,NP". */
  fileFunction: string
  /** Negative for solder mask (the openings are drawn), positive for everything else. */
  polarity: "Positive" | "Negative"
  objects: GerberObject[]
}

/** Six decimals: coordinates and sizes are whole nanometres. */
const DECIMALS = 6
const SCALE = 10 ** DECIMALS
/** The first aperture number; D00 to D09 are reserved. */
const FIRST_APERTURE = 10

/**
 * The rounded rectangle: $1 corner radius, $2 to $9 the centres of the four corner circles (x then y), already turned
 * about the pad's centre. The body is the polygon through those centres, each side widened by a line of the corners'
 * diameter, and a circle in each corner. Turning is done here, not by the primitives' rotation parameter, which
 * older readers do not know for circles.
 */
const ROUNDRECT_MACRO = [
  "%AMRoundRect*",
  "0 Rounded rectangle: $1 corner radius and $2 to $9 the corner centres*",
  "4,1,4,$2,$3,$4,$5,$6,$7,$8,$9,$2,$3,0*",
  "20,1,$1x2,$2,$3,$4,$5,0*",
  "20,1,$1x2,$4,$5,$6,$7,0*",
  "20,1,$1x2,$6,$7,$8,$9,0*",
  "20,1,$1x2,$8,$9,$2,$3,0*",
  "1,1,$1x2,$2,$3*",
  "1,1,$1x2,$4,$5*",
  "1,1,$1x2,$6,$7*",
  "1,1,$1x2,$8,$9*%",
]

/** The corner circles' centres of a rounded rectangle, turned `rotation` degrees counter-clockwise: x, y in turn. */
function roundRectCorners(width: number, height: number, radius: number, rotation: number): number[] {
  const radians = (rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)]
  const [a, b] = [width / 2 - radius, height / 2 - radius]
  const corners = [
    [-a, -b],
    [a, -b],
    [a, b],
    [-a, b],
  ] as const
  return corners.flatMap(([x, y]) => [x * cos - y * sin, x * sin + y * cos])
}

/** A coordinate in the 4.6 format, leading zeros left out: 1.25 mm is "1250000". */
const coordinate = (mm: number): string => String(Math.round(mm * SCALE) + 0)

/** A size or macro value with six decimals: 0.25 mm is "0.250000". */
const decimal = (mm: number): string => ((Math.round(mm * SCALE) + 0) / SCALE).toFixed(DECIMALS)

const at = (p: Point): string => `X${coordinate(p.x)}Y${coordinate(p.y)}`

function apertureTemplate(aperture: Aperture): string {
  switch (aperture.shape) {
    case "circle":
      return `C,${decimal(aperture.diameter)}`
    case "rect":
      return `R,${decimal(aperture.width)}X${decimal(aperture.height)}`
    case "obround":
      return `O,${decimal(aperture.width)}X${decimal(aperture.height)}`
    case "roundrect":
      return `RoundRect,${[aperture.radius, ...roundRectCorners(aperture.width, aperture.height, aperture.radius, aperture.rotation)].map(decimal).join("X")}`
  }
}

/** Each distinct aperture and function, numbered from D10 in the order first used. */
class Apertures {
  private readonly codes = new Map<string, number>()
  readonly lines: string[] = []
  usesRoundRect = false

  code(aperture: Aperture, fn: string | undefined): number {
    const template = apertureTemplate(aperture)
    const key = `${fn ?? ""}|${template}`
    const known = this.codes.get(key)
    if (known !== undefined) return known
    const code = FIRST_APERTURE + this.codes.size
    this.codes.set(key, code)
    if (aperture.shape === "roundrect") this.usesRoundRect = true
    if (fn !== undefined) this.lines.push(`%TA.AperFunction,${fn}*%`)
    this.lines.push(`%ADD${code}${template}*%`)
    if (fn !== undefined) this.lines.push("%TD*%")
    return code
  }
}

/** The body: aperture selections, flashes, draws and regions in the order given, the load polarity switched as needed. */
function body(objects: readonly GerberObject[], apertures: Apertures): string[] {
  const lines: string[] = []
  let current: number | undefined
  let clear = false
  const polarity = (object: GerberObject) => {
    const wanted = object.kind === "region" && object.polarity === "clear"
    if (wanted !== clear) lines.push(wanted ? "%LPC*%" : "%LPD*%")
    clear = wanted
  }
  const select = (aperture: Aperture, fn: string | undefined) => {
    const code = apertures.code(aperture, fn)
    if (code !== current) lines.push(`D${code}*`)
    current = code
  }
  for (const object of objects) {
    polarity(object)
    if (object.kind === "region") {
      const [first, ...rest] = object.points
      if (first === undefined) continue
      if (object.function !== undefined) lines.push(`%TA.AperFunction,${object.function}*%`)
      lines.push("G36*", `${at(first)}D02*`, ...rest.map((p) => `${at(p)}D01*`), `${at(first)}D01*`, "G37*")
      if (object.function !== undefined) lines.push("%TD*%")
      continue
    }
    if (object.kind === "flash") {
      select(object.aperture, object.function)
      lines.push(`${at(object.at)}D03*`)
      continue
    }
    const [first, ...rest] = object.points
    if (first === undefined) continue
    select({ shape: "circle", diameter: object.width }, object.function)
    lines.push(rest.length === 0 ? `${at(first)}D03*` : `${at(first)}D02*`, ...rest.map((p) => `${at(p)}D01*`))
  }
  if (clear) lines.push("%LPD*%")
  return lines
}

const two = (n: number) => String(n).padStart(2, "0")

/** ISO 8601 in UTC with an explicit offset, as X2 writes it: "2026-11-10T09:05:07+00:00". */
export function creationDate(date: Date): string {
  const day = `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}`
  return `${day}T${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())}+00:00`
}

/** The whole file, LF line ends, ending in M02. `created` is the only thing in it that is not the layer's content. */
export function writeGerber(layer: GerberLayer, created: Date): string {
  const apertures = new Apertures()
  const drawing = body(layer.objects, apertures)
  const lines = [
    `%TF.GenerationSoftware,copperflow,copperflow,${VERSION}*%`,
    `%TF.CreationDate,${creationDate(created)}*%`,
    "%TF.Part,Single*%",
    `%TF.FileFunction,${layer.fileFunction}*%`,
    `%TF.FilePolarity,${layer.polarity}*%`,
    `%FSLAX4${DECIMALS}Y4${DECIMALS}*%`,
    "%MOMM*%",
    ...(apertures.usesRoundRect ? ROUNDRECT_MACRO : []),
    ...apertures.lines,
    "%LPD*%",
    "G01*",
    ...drawing,
    "M02*",
  ]
  return `${lines.join("\n")}\n`
}
