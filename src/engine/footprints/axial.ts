import type { Point } from "../model.js"
import { mm } from "./exposed.js"
import { range } from "./ic.js"
import { leadDiameter, THROUGH_HOLE_COURTYARD, throughHoleLand, throughHolePad } from "./ipc7251.js"
import type { Range } from "./ipc7351.js"
import { closedRectangle, courtyard, SILK_CLEARANCE, tidy } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import { refuse, type Footprint, type Pad, type Refusal } from "./types.js"

/**
 * Axial through-hole parts lying flat: "axial<body length>x<lead spacing>" with an optional
 * `_d<body diameter>`, and the diodes do35, do41, do15, do201ad.
 *
 * Written from general knowledge of resistor and diode makers' drawings, not transcribed from one:
 * - body diameter by body length when `_d` is not given: up to 3.7 mm long 1.8 mm (1/8 W), up to
 *   6.6 mm 2.5 mm (1/4 W), up to 9.1 mm 3.5 mm (1/2 W), up to 12.1 mm 4.5 mm (1 W), longer 5.5 mm;
 * - lead diameter 0.55–0.65 mm up to a 6.6 mm body, 0.75–0.85 mm above;
 * - each lead needs 1.5 mm of straight lead out of the body before its bend, so the lead spacing must
 *   be at least the body length plus 3 mm;
 * - DO-35 body 4.2 × 2.0, lead 0.46–0.56; DO-41 body 5.2 × 2.7, lead 0.71–0.86; DO-15 body 7.6 × 3.6,
 *   lead 0.69–0.88; DO-201AD body 9.5 × 5.3, lead 1.2–1.3 (maximum body sizes as makers commonly give).
 */
const DIAMETERS: readonly { upTo: number; diameter: number }[] = [
  { upTo: 3.7, diameter: 1.8 },
  { upTo: 6.6, diameter: 2.5 },
  { upTo: 9.1, diameter: 3.5 },
  { upTo: 12.1, diameter: 4.5 },
  { upTo: Infinity, diameter: 5.5 },
]
const THIN_LEAD = range(0.55, 0.65)
const THICK_LEAD = range(0.75, 0.85)
const THIN_LEAD_UP_TO = 6.6
/** Straight lead out of the body before the bend, at each end. */
export const AXIAL_BEND = 1.5
/** Bounds that only keep a string sane; they are not part limits. */
const MIN_BODY = 1
const MAX_BODY = 30
const MAX_DIAMETER = 20
const MAX_SPACING = 60
/** The cathode bar sits this far inside the cathode end of the body, at most. */
const CATHODE_INSET = 0.6
/** Lead lines on the silkscreen stop this far short of the silkscreen clearance around a pad. */
const LEAD_GAP = 0.05

interface Axial {
  label: string
  length: number
  diameter: number
  lead: Range
  pitch: number
  diode: boolean
}

const DIODES = new Map<string, Axial>([
  ["do35", { label: "DO-35", length: 4.2, diameter: 2.0, lead: range(0.46, 0.56), pitch: 7.62, diode: true }],
  ["do41", { label: "DO-41", length: 5.2, diameter: 2.7, lead: range(0.71, 0.86), pitch: 10.16, diode: true }],
  ["do15", { label: "DO-15", length: 7.6, diameter: 3.6, lead: range(0.69, 0.88), pitch: 12.7, diode: true }],
  ["do201ad", { label: "DO-201AD", length: 9.5, diameter: 5.3, lead: range(1.2, 1.3), pitch: 15.24, diode: true }],
])

const isPlainHead = (parsed: ParsedFootprint) =>
  parsed.suffix === undefined && parsed.size === undefined && parsed.pairs === undefined && parsed.variant === undefined

/** "axial…" or a named axial diode: the footprint, a refusal, or undefined when the string is not one. */
export function axialFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  if (parsed.kind === "do") {
    const diode = DIODES.get(`do${parsed.code}${parsed.suffix ?? ""}`)
    const bare = parsed.cross === undefined && parsed.variant === undefined && parsed.size === undefined && parsed.pairs === undefined
    return diode && bare && Object.keys(parsed.params).length === 0 ? build(diode, `do${parsed.code}${parsed.suffix ?? ""}`) : undefined
  }
  if (parsed.kind !== "axial" || !isPlainHead(parsed) || Object.keys(parsed.params).some((key) => key !== "d")) return undefined
  const axial = resistorLike(parsed)
  if ("refused" in axial) return axial
  const name = `axial${mm(axial.length)}x${mm(axial.pitch)}${parsed.params["d"] === undefined ? "" : `_d${mm(axial.diameter)}`}`
  return build(axial, name)
}

function resistorLike(parsed: ParsedFootprint): Axial | Refusal {
  if (parsed.cross === undefined || parsed.code === "") return refuse("an axial part is axial<body length>x<lead spacing>, such as axial6.3x10.16")
  const length = Number(parsed.code)
  const pitch = Number(parsed.cross)
  const given = parsed.params["d"]
  if (given === true) return refuse("_d needs the body diameter in mm, such as _d2.5")
  if (length < MIN_BODY || length > MAX_BODY) return refuse(`the body is ${MIN_BODY} to ${MAX_BODY} mm long`)
  if (pitch > MAX_SPACING) return refuse(`the leads are at most ${MAX_SPACING} mm apart`)
  if (pitch < length + 2 * AXIAL_BEND) {
    return refuse(`leads ${mm(pitch)} mm apart leave no room to bend them around a ${mm(length)} mm body: at least ${mm(length + 2 * AXIAL_BEND)} mm (${AXIAL_BEND} mm of straight lead at each end)`)
  }
  const diameter = given ?? (DIAMETERS.find((row) => length <= row.upTo) as { diameter: number }).diameter
  if (diameter <= 0 || diameter > MAX_DIAMETER) return refuse(`the body diameter is above 0 and at most ${MAX_DIAMETER} mm`)
  const lead = length <= THIN_LEAD_UP_TO ? THIN_LEAD : THICK_LEAD
  return { label: "axial", length, diameter, lead, pitch, diode: false }
}

function build(part: Axial, name: string): Footprint {
  const land = throughHoleLand(leadDiameter(part.lead))
  const pads: Pad[] = [throughHolePad("1", tidy(-part.pitch / 2), 0, land, true), throughHolePad("2", tidy(part.pitch / 2), 0, land)]
  const body = { x: tidy(part.length / 2), y: tidy(part.diameter / 2) }
  const silkscreen = [closedRectangle(body), ...leadLines(part, land.pad), ...(part.diode ? [cathodeBar(part)] : [])]
  const kind = part.diode ? `${part.label} diode (pad 1 anode, pad 2 cathode)` : `axial ${mm(part.length)} × ${mm(part.diameter)} mm body`
  return {
    name,
    pads,
    courtyard: courtyard(pads, body, THROUGH_HOLE_COURTYARD),
    silkscreen,
    fabrication: [closedRectangle(body)],
    origin: `Through-hole, ${kind}, leads ${mm(part.pitch)} mm apart: ${land.drill} mm holes, ${land.pad} mm lands (IPC-2222 level B); body typical`,
  }
}

/** The leads from the body ends towards the pads, stopping clear of them. */
function leadLines(part: Axial, padSize: number): Point[][] {
  const start = tidy(part.length / 2)
  const end = tidy(part.pitch / 2 - padSize / 2 - SILK_CLEARANCE - LEAD_GAP)
  if (end <= start) return []
  return [
    [{ x: -end, y: 0 }, { x: -start, y: 0 }],
    [{ x: start, y: 0 }, { x: end, y: 0 }],
  ]
}

/** A bar across the body near its pad 2 (cathode) end. */
function cathodeBar(part: Axial): Point[] {
  const x = tidy(part.length / 2 - Math.min(CATHODE_INSET, part.length * 0.15))
  const y = tidy(part.diameter / 2)
  return [{ x, y: -y }, { x, y }]
}
