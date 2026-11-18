// The height rows of the through-hole packages that stand on leads or sockets: axial parts, round LEDs, screw terminal
// blocks, pin sockets, and the larger TO power packages. Every row is typical: written from general knowledge of makers'
// drawings, none read from a document. heights.ts puts them in its table.
import type { ParsedFootprint } from "../footprints/parse.js"
import type { HeightRow } from "./heights.js"

/** How far an axial body's lowest point stands above the board: the lead's bend and the lead's own thickness. */
export const AXIAL_GAP = 0.3

/**
 * The body diameter of an axial part by its body length when the string gives no `_d`. These are the numbers of the
 * footprint generator (`footprints/axial.ts`, which does not export them): up to 3.7 mm long 1.8 mm, up to 6.6 mm
 * 2.5 mm, up to 9.1 mm 3.5 mm, up to 12.1 mm 4.5 mm, longer 5.5 mm.
 */
const AXIAL_DIAMETERS: readonly { upTo: number; diameter: number }[] = [
  { upTo: 3.7, diameter: 1.8 },
  { upTo: 6.6, diameter: 2.5 },
  { upTo: 9.1, diameter: 3.5 },
  { upTo: 12.1, diameter: 4.5 },
  { upTo: Infinity, diameter: 5.5 },
]

/** The body diameter of "axial<length>x<spacing>[_d<diameter>]". */
export function axialDiameter(parsed: ParsedFootprint): number {
  const given = parsed.params["d"]
  if (typeof given === "number" && given > 0) return given
  const length = Number(parsed.code)
  return (AXIAL_DIAMETERS.find((row) => length <= row.upTo) ?? (AXIAL_DIAMETERS[AXIAL_DIAMETERS.length - 1] as { diameter: number })).diameter
}

const AXIAL_SOURCE = `makers' drawings of axial resistors and diodes lying on the board: the body's diameter (from the string, or by body length) and about ${AXIAL_GAP} mm of gap under it`
const DIODE_SOURCE = (name: string, diameter: number) => `makers' ${name} drawings: maximum body diameter ${diameter} mm and about ${AXIAL_GAP} mm of gap under it`

const diode = (name: string, code: string, suffix: string | undefined, diameter: number): HeightRow => ({
  packages: name,
  height: diameter + AXIAL_GAP,
  source: DIODE_SOURCE(name, diameter),
  matches: (p) => p.kind === "do" && p.code === code && p.suffix === suffix && p.variant === undefined,
})

const screw = (packages: string, height: number, pitches: readonly number[]): HeightRow => ({
  packages,
  height,
  source: `makers' PCB screw terminal block drawings: about ${height} mm above the board at these pitches`,
  matches: (p) => p.kind === "screw" && pitches.includes(typeof p.params["p"] === "number" ? p.params["p"] : DEFAULT_SCREW_PITCH),
})
const DEFAULT_SCREW_PITCH = 5.08

/** Radial electrolytic cans: the common can length of makers' general-purpose series for each listed diameter, in mm. */
const RADIAL_CANS: readonly (readonly [number, number])[] = [[4, 7], [5, 11], [6.3, 11], [8, 11.5], [10, 16], [12.5, 20], [16, 25], [18, 35.5]]
const RADIAL_SOURCE = "makers' drawings of general-purpose radial aluminium electrolytic series: the common can length for the diameter"
const RADIAL_NEAREST_SOURCE = "makers' drawings of general-purpose radial aluminium electrolytic series: this diameter is not listed, so the common can length of the nearest listed diameter"

const radialDiameter = (p: ParsedFootprint): number => Number(p.code)
const isRadial = (p: ParsedFootprint) => p.kind === "radial" && Number.isFinite(radialDiameter(p)) && radialDiameter(p) > 0
const listed = (diameter: number) => RADIAL_CANS.some(([d]) => d === diameter)

/** The can length of the listed diameter nearest to `diameter` (the smaller one when two are as near). */
function nearestCan(diameter: number): number {
  const best = RADIAL_CANS.reduce((a, b) => (Math.abs(b[0] - diameter) < Math.abs(a[0] - diameter) ? b : a))
  return best[1]
}

/** Pin rows at a pitch below 2.54 mm: a 1.27 mm header (pitch up to 1.5 mm) about 4.6 mm overall, a 2 mm header about 6 mm. */
const FINE_HEADER_SOURCE = (pitch: string, height: number) => `makers' ${pitch} mm pitch pin header drawings: about ${height} mm overall above the board`
const finePitch = (p: ParsedFootprint): number | undefined => {
  const pitch = p.params["p"]
  return p.kind === "pinrow" && typeof pitch === "number" && pitch < 2.54 ? pitch : undefined
}
const FINE_HEADER_LIMIT = 1.5

export const THROUGH_HOLE_ROWS: readonly HeightRow[] = [
  {
    packages: "radial can, a listed diameter",
    height: 0,
    heightOf: (p) => nearestCan(radialDiameter(p)),
    source: RADIAL_SOURCE,
    matches: (p) => isRadial(p) && listed(radialDiameter(p)),
  },
  {
    packages: "radial can, any other diameter",
    height: 0,
    heightOf: (p) => nearestCan(radialDiameter(p)),
    source: RADIAL_NEAREST_SOURCE,
    matches: (p) => isRadial(p) && !listed(radialDiameter(p)),
  },
  { packages: "pin header, 1.27 mm pitch", height: 4.6, source: FINE_HEADER_SOURCE("1.27", 4.6), matches: (p) => (finePitch(p) ?? Infinity) <= FINE_HEADER_LIMIT },
  { packages: "pin header, 2 mm pitch", height: 6, source: FINE_HEADER_SOURCE("2", 6), matches: (p) => (finePitch(p) ?? 0) > FINE_HEADER_LIMIT },
  {
    packages: "axial resistor or diode",
    height: 0,
    heightOf: (p) => axialDiameter(p) + AXIAL_GAP,
    source: AXIAL_SOURCE,
    matches: (p) => p.kind === "axial" && p.code !== "",
  },
  diode("DO-35", "35", undefined, 2),
  diode("DO-41", "41", undefined, 2.7),
  diode("DO-15", "15", undefined, 3.6),
  diode("DO-201AD", "201", "ad", 5.3),
  { packages: "3 mm round LED", height: 5.5, source: "makers' 3 mm (T-1) round LED drawings: flange and lens seated on the board, about 5.5 mm", matches: (p) => p.kind === "led" && p.suffix === "mm" && p.code === "3" },
  { packages: "5 mm round LED", height: 8.7, source: "makers' 5 mm (T-1 3/4) round LED drawings: flange and lens seated on the board, about 8.7 mm", matches: (p) => p.kind === "led" && p.suffix === "mm" && p.code === "5" },
  screw("screw terminal block, 5 and 5.08 mm pitch", 10, [5, 5.08]),
  screw("screw terminal block, 3.5 and 3.81 mm pitch", 8.5, [3.5, 3.81]),
  { packages: "pin socket, 2.54 mm pitch", height: 8.5, source: "makers' drawings of 2.54 mm female headers: the common 8.5 mm height above the board", matches: (p) => p.kind === "socket" },
  { packages: "TO-247", height: 25.5, source: "makers' TO-247 drawings: about 4.5 mm of lead above the board under about 21 mm of body and tab", matches: (p) => p.kind === "to" && p.code === "247" },
  { packages: "TO-126", height: 13.3, source: "makers' TO-126 (SOT-32) drawings: about 2.5 mm of lead above the board under about 10.8 mm of plastic body", matches: (p) => p.kind === "to" && p.code === "126" },
]
