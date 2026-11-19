// How tall a part stands above the board, for the 3D model: the height the part gives (`height` in part.yaml, which
// the generated component passes on, or a `height` prop on a built-in part), else a height by package from the table
// below, else ASSUMED_HEIGHT, marked assumed. Every figure is the largest seated height (the "A max" of the outline).
// A row with a `document` was read from that document (its page named); every other row is typical: written from
// general knowledge of the standards and makers' drawings, not read from them, and named "typical" wherever it shows.
import { parseFootprint, type ParsedFootprint } from "../footprints/parse.js"
import { RADIAL_RATINGS_DOCUMENT, radialCase } from "./radial-ratings.js"
import { parseLength } from "../units.js"
import { SMD_ROWS } from "./heights-smd.js"
import { THROUGH_HOLE_ROWS } from "./heights-through.js"
import { UNO_ROWS } from "./heights-uno.js"

/** The height of a part whose package the table does not know, in mm. */
export const ASSUMED_HEIGHT = 1

/** given: the part says its height; read: a table row read from a named document; typical: a table row not read from a document; assumed: nothing known. */
export type HeightState = "given" | "read" | "typical" | "assumed"

export interface PartHeight {
  /** Above the board's surface, in mm. */
  height: number
  /** "given", "assumed", or the table row's source. */
  source: string
  state: HeightState
  assumed: boolean
}

export interface HeightRow {
  /** The packages the row covers, as a person reads them. */
  packages: string
  height: number
  source: string
  /** The document and page the figure was read from; a row without one is typical. */
  document?: string
  /** Set when the height depends on a number in the string (an axial part's diameter): it answers instead of `height`. */
  heightOf?(parsed: ParsedFootprint): number
  matches(parsed: ParsedFootprint): boolean
}

const CHIP_SOURCE = "EIA/IEC 60384-21 chip capacitor sizes: thickness up to the body width plus its tolerance (resistors are thinner)"
const chip = (code: string, height: number): HeightRow => ({
  packages: `chip ${code}`,
  height,
  source: CHIP_SOURCE,
  matches: (p) => p.kind === "" && p.code === code && p.variant === undefined,
})

/** The larger chip sizes: the thickest part commonly made in the size, from makers' series, not from the standard. */
const BIG_CHIP_CAPACITOR_SOURCE = "makers' chip capacitor series: the thickest part commonly made in this size"
const POWER_CHIP_SOURCE = "makers' power chip resistor series: thickness up to 0.7 mm in this size"
const chipOf = (code: string, height: number, source: string): HeightRow => ({
  packages: `chip ${code}`,
  height,
  source,
  matches: (p) => p.kind === "" && p.code === code && p.variant === undefined,
})

/** A moulded diode: "sma" and so on, or its JEDEC name "do214ac" (kind "do", code "214", suffix "ac"). */
const moulded = (name: string, jedec: string, height: number): HeightRow => ({
  packages: `${name.toUpperCase()} (DO-214${jedec.toUpperCase()})`,
  height,
  source: `makers' ${name.toUpperCase()} (DO-214${jedec.toUpperCase()}) drawings: body thickness up to ${height} mm`,
  matches: (p) => p.variant === undefined && ((p.kind === name && p.code === "") || (p.kind === "do" && p.code === "214" && p.suffix === jedec)),
})

/** A plain pin row or double row at the 2.54 mm pitch: `_p` set to anything else is another kind of connector. */
const isHeaderPitch = (p: ParsedFootprint) => p.params["p"] === undefined || p.params["p"] === 2.54

/** The heights by package, in the order they are tried. */
export const HEIGHT_TABLE: readonly HeightRow[] = [
  chip("0402", 0.55),
  chip("0603", 0.9),
  chip("0805", 1.45),
  chip("1206", 1.8),
  chip("0201", 0.33),
  chipOf("1210", 2.5, BIG_CHIP_CAPACITOR_SOURCE),
  chipOf("1812", 3.2, BIG_CHIP_CAPACITOR_SOURCE),
  chipOf("2010", 0.7, POWER_CHIP_SOURCE),
  chipOf("2512", 0.7, POWER_CHIP_SOURCE),
  {
    packages: "SOIC (narrow)",
    height: 1.75,
    source: "JEDEC MS-012, A max 1.75 mm",
    document: "NXP TJA1051 data sheet Rev. 9, p15, Fig 9, SOT96-1 (SO8, JEDEC MS-012): A max 1.75 mm",
    matches: (p) => p.kind === "soic" && p.suffix === undefined,
  },
  {
    packages: "SOIC (wide)",
    height: 2.65,
    source: "JEDEC MS-013, A max 2.65 mm",
    document: "Microchip MCP2515 data sheet DS20001801J, p82, 18-lead SOIC 7.50 mm body (drawing C04-051C): A max 2.65 mm",
    matches: (p) => p.kind === "soic" && p.suffix === "w",
  },
  { packages: "SOT-23 (3 leads)", height: 1.12, source: "JEDEC TO-236 AB, A max 1.12 mm", matches: (p) => p.kind === "sot" && p.code === "23" && p.variant === undefined },
  { packages: "SOT-23-5, SOT-23-6", height: 1.45, source: "JEDEC MO-178, A max 1.45 mm", matches: (p) => p.kind === "sot" && p.code === "23" && (p.variant === "5" || p.variant === "6") },
  { packages: "SOT-223", height: 1.8, source: "makers' SOT-223 (TO-261AA) drawings, A max 1.8 mm", matches: (p) => p.kind === "sot" && p.code === "223" && p.variant === undefined },
  { packages: "SOT-89", height: 1.6, source: "makers' SOT-89 (TO-243AA) drawings, A max about 1.6 mm", matches: (p) => p.kind === "sot" && p.code === "89" && p.variant === undefined },
  { packages: "SOP (208 mil)", height: 2.2, source: "makers' 208 mil SOP drawings, A max about 2.2 mm", matches: (p) => p.kind === "sop" },
  { packages: "SSOP", height: 2, source: "JEDEC MO-150 (SSOP), A max 2.0 mm", matches: (p) => p.kind === "ssop" },
  { packages: "TSSOP", height: 1.2, source: "JEDEC MO-153 (TSSOP), A max 1.2 mm", matches: (p) => p.kind === "tssop" },
  { packages: "ball grid array", height: 1.4, source: "makers' fine-pitch BGA drawings: balls and body together, 1.0 to 1.6 mm", matches: (p) => p.kind === "bga" },
  { packages: "QFN", height: 1, source: "JEDEC MO-220, A max 1.00 mm", matches: (p) => p.kind === "qfn" },
  { packages: "DFN", height: 1, source: "JEDEC MO-229, A max 1.00 mm", matches: (p) => p.kind === "dfn" },
  { packages: "LQFP, QFP", height: 1.6, source: "JEDEC MS-026 (LQFP), A max 1.60 mm", matches: (p) => p.kind === "lqfp" || p.kind === "qfp" },
  { packages: "TQFP", height: 1.2, source: "JEDEC MS-026 (TQFP), A max 1.20 mm", matches: (p) => p.kind === "tqfp" },
  { packages: "SOD-123", height: 1.35, source: "makers' SOD-123 drawings (for example onsemi case 425), A max 1.35 mm", matches: (p) => p.kind === "sod" && p.code === "123" && p.suffix === undefined },
  { packages: "SOD-323", height: 1.1, source: "makers' SOD-323 drawings, A max about 1.1 mm", matches: (p) => p.kind === "sod" && p.code === "323" && (p.suffix === undefined || p.suffix === "f") },
  moulded("sma", "ac", 2.4),
  moulded("smb", "aa", 2.4),
  moulded("smc", "ab", 2.7),
  { packages: "plastic DIP", height: 5.1, source: "makers' plastic DIP drawings: the body seated about 0.5 mm off the board, up to 5.1 mm high", matches: (p) => p.kind === "dip" },
  { packages: "TO-220, upright", height: 20.5, source: "makers' TO-220AB drawings, seated against the leads' shoulders: about 4.5 mm of lead above the board under about 16 mm of body and tab", matches: (p) => p.kind === "to" && p.code === "220" },
  { packages: "TO-92", height: 5.2, source: "makers' TO-92 drawings: the body up to 5.2 mm above the board", matches: (p) => p.kind === "to" && p.code === "92" },
  {
    packages: "pin header, 2.54 mm pitch",
    height: 8.5,
    source: "makers' drawings of straight 2.54 mm headers: 2.5 mm insulator and 6 mm of pin above it",
    matches: (p) => p.kind === "pinrow" && isHeaderPitch(p),
  },
  { packages: "HC-49/U crystal", height: 13.46, source: "crystal makers' HC-49/U drawings, height max 13.46 mm", matches: (p) => p.kind === "hc" && p.code === "49" && p.suffix === undefined },
  { packages: "HC-49/S crystal", height: 3.5, source: "crystal makers' HC-49/S (HC-49/US) drawings, height max 3.5 mm", matches: (p) => p.kind === "hc" && p.code === "49" && p.suffix === "s" },
  ...THROUGH_HOLE_ROWS,
  ...SMD_ROWS,
  ...UNO_ROWS,
]

/** A positive length the part gives as its `height` prop, in mm. */
function givenHeight(props: Readonly<Record<string, unknown>>): number | undefined {
  const height = parseLength(props["height"])
  return height !== undefined && height > 0 ? height : undefined
}

/** How tall the part is: given, by package, or ASSUMED_HEIGHT and assumed. */
export function partHeight(part: { footprint?: string; props: Readonly<Record<string, unknown>> }): PartHeight {
  const given = givenHeight(part.props)
  if (given !== undefined) return { height: given, source: "given", state: "given", assumed: false }
  const parsed = part.footprint === undefined || part.footprint.includes("/") ? undefined : parseFootprint(part.footprint)
  const can = parsed?.kind === "radial" ? radialCase(part.props) : undefined
  if (can !== undefined && can.diameter === Number(parsed?.code)) {
    const source = `${RADIAL_RATINGS_DOCUMENT}: ${can.volts} V ${can.microfarads} µF is a ${can.diameter} x ${can.length} mm can`
    return { height: can.length, source, state: "read", assumed: false }
  }
  const row = parsed === undefined ? undefined : HEIGHT_TABLE.find((candidate) => candidate.matches(parsed))
  if (row === undefined) return { height: ASSUMED_HEIGHT, source: "assumed", state: "assumed", assumed: true }
  const height = row.heightOf?.(parsed as ParsedFootprint) ?? row.height
  return row.document === undefined ? { height, source: row.source, state: "typical", assumed: false } : { height, source: row.document, state: "read", assumed: false }
}
