// How tall a part stands above the board, for the 3D model: the height the part gives (`height` in part.yaml, which
// the generated component passes on, or a `height` prop on a built-in part), else a height by package from the table
// below, else ASSUMED_HEIGHT, marked assumed. Every figure is the largest seated height (the "A max" of the outline)
// that the named standard or makers' drawings give for the package, written from general knowledge of those drawings,
// not transcribed from them; a part's own datasheet should confirm it.
import { parseFootprint, type ParsedFootprint } from "../footprints/parse.js"
import { parseLength } from "../units.js"

/** The height of a part whose package the table does not know, in mm. */
export const ASSUMED_HEIGHT = 1

export interface PartHeight {
  /** Above the board's surface, in mm. */
  height: number
  /** "given", "assumed", or the table row's source. */
  source: string
  assumed: boolean
}

export interface HeightRow {
  /** The packages the row covers, as a person reads them. */
  packages: string
  height: number
  source: string
  matches(parsed: ParsedFootprint): boolean
}

const CHIP_SOURCE = "EIA/IEC 60384-21 chip capacitor sizes: thickness up to the body width plus its tolerance (resistors are thinner)"
const chip = (code: string, height: number): HeightRow => ({
  packages: `chip ${code}`,
  height,
  source: CHIP_SOURCE,
  matches: (p) => p.kind === "" && p.code === code && p.variant === undefined,
})

/** A plain pin row or double row at the 2.54 mm pitch: `_p` set to anything else is another kind of connector. */
const isHeaderPitch = (p: ParsedFootprint) => p.params["p"] === undefined || p.params["p"] === 2.54

/** Radial electrolytic cans: the common can length of makers' general-purpose series for each diameter. */
const RADIAL_SOURCE = "makers' drawings of general-purpose radial aluminium electrolytic series: the common can length for the diameter"
const radial = (diameter: string, height: number): HeightRow => ({
  packages: `radial can ${diameter} mm across`,
  height,
  source: RADIAL_SOURCE,
  matches: (p) => p.kind === "radial" && p.code === diameter,
})

/** The heights by package, in the order they are tried. */
export const HEIGHT_TABLE: readonly HeightRow[] = [
  chip("0402", 0.55),
  chip("0603", 0.9),
  chip("0805", 1.45),
  chip("1206", 1.8),
  { packages: "SOIC (narrow)", height: 1.75, source: "JEDEC MS-012, A max 1.75 mm", matches: (p) => p.kind === "soic" && p.suffix === undefined },
  { packages: "SOIC (wide)", height: 2.65, source: "JEDEC MS-013, A max 2.65 mm", matches: (p) => p.kind === "soic" && p.suffix === "w" },
  { packages: "SOT-23 (3 leads)", height: 1.12, source: "JEDEC TO-236 AB, A max 1.12 mm", matches: (p) => p.kind === "sot" && p.code === "23" && p.variant === undefined },
  { packages: "SOT-23-5, SOT-23-6", height: 1.45, source: "JEDEC MO-178, A max 1.45 mm", matches: (p) => p.kind === "sot" && p.code === "23" && (p.variant === "5" || p.variant === "6") },
  { packages: "QFN", height: 1, source: "JEDEC MO-220, A max 1.00 mm", matches: (p) => p.kind === "qfn" },
  { packages: "DFN", height: 1, source: "JEDEC MO-229, A max 1.00 mm", matches: (p) => p.kind === "dfn" },
  { packages: "LQFP, QFP", height: 1.6, source: "JEDEC MS-026 (LQFP), A max 1.60 mm", matches: (p) => p.kind === "lqfp" || p.kind === "qfp" },
  { packages: "TQFP", height: 1.2, source: "JEDEC MS-026 (TQFP), A max 1.20 mm", matches: (p) => p.kind === "tqfp" },
  { packages: "SOD-123", height: 1.35, source: "makers' SOD-123 drawings (for example onsemi case 425), A max 1.35 mm", matches: (p) => p.kind === "sod" && p.code === "123" },
  {
    packages: "pin header, 2.54 mm pitch",
    height: 8.5,
    source: "makers' drawings of straight 2.54 mm headers: 2.5 mm insulator and 6 mm of pin above it",
    matches: (p) => p.kind === "pinrow" && isHeaderPitch(p),
  },
  { packages: "HC-49/U crystal", height: 13.46, source: "crystal makers' HC-49/U drawings, height max 13.46 mm", matches: (p) => p.kind === "hc" && p.code === "49" && p.suffix === undefined },
  { packages: "HC-49/S crystal", height: 3.5, source: "crystal makers' HC-49/S (HC-49/US) drawings, height max 3.5 mm", matches: (p) => p.kind === "hc" && p.code === "49" && p.suffix === "s" },
  radial("4", 7),
  radial("5", 11),
  radial("6.3", 11),
  radial("8", 11.5),
  radial("10", 16),
  radial("12.5", 20),
  radial("16", 25),
  radial("18", 35.5),
]

/** A positive length the part gives as its `height` prop, in mm. */
function givenHeight(props: Readonly<Record<string, unknown>>): number | undefined {
  const height = parseLength(props["height"])
  return height !== undefined && height > 0 ? height : undefined
}

/** How tall the part is: given, by package, or ASSUMED_HEIGHT and assumed. */
export function partHeight(part: { footprint?: string; props: Readonly<Record<string, unknown>> }): PartHeight {
  const given = givenHeight(part.props)
  if (given !== undefined) return { height: given, source: "given", assumed: false }
  const parsed = part.footprint === undefined || part.footprint.includes("/") ? undefined : parseFootprint(part.footprint)
  const row = parsed === undefined ? undefined : HEIGHT_TABLE.find((candidate) => candidate.matches(parsed))
  return row === undefined ? { height: ASSUMED_HEIGHT, source: "assumed", assumed: true } : { height: row.height, source: row.source, assumed: false }
}
