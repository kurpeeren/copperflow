// The height rows of the parts an Arduino Uno needs: the USB Type-B and Type-C receptacles, the barrel jack, the 6 × 6
// tact switches, the ceramic resonator and the shielded power inductors. Every row is typical: written from general
// knowledge of makers' drawings of such parts, none read from a document. heights.ts puts them in its table.
import type { ParsedFootprint } from "../footprints/parse.js"
import type { HeightRow } from "./heights.js"

const row = (packages: string, height: number, source: string, matches: HeightRow["matches"]): HeightRow => ({ packages, height, source, matches })

const isPlain = (p: ParsedFootprint) => p.variant === undefined && p.suffix === undefined && p.size === undefined

/** Shielded power inductors by body side, mm: the height of makers' square shielded ranges of that size, typical. */
const INDUCTOR_HEIGHTS: readonly (readonly [number, number])[] = [[4, 2], [5, 2.5], [6, 3], [8, 4], [10, 5], [12, 6]]

const inductor = (side: number, height: number): HeightRow =>
  row(`shielded power inductor ${side}x${side}`, height, `makers' shielded power inductor ranges of ${side} × ${side} mm: about ${height} mm, typical`, (p) => p.kind === "ind" && p.code === String(side) && p.cross === String(side) && isPlain(p))

export const UNO_ROWS: readonly HeightRow[] = [
  row("USB Type-B receptacle", 11, "makers' right-angle USB Type-B receptacle drawings: a shell about 11 mm high, typical", (p) => p.kind === "usb" && p.params["b"] === true),
  row("USB Type-C receptacle, 16 pins", 3.2, "makers' horizontal USB Type-C receptacle drawings: a shell about 3.2 mm high, typical", (p) => p.kind === "usb" && p.params["c"] === 16),
  row("DC barrel jack, 5.5 mm", 11, "makers' right-angle barrel jack drawings for a 5.5 mm plug: a body about 11 mm high, typical", (p) => p.kind === "dcjack"),
  row("tact switch 6 x 6, through-hole", 4.3, "makers' 6 × 6 mm tact switch drawings with the usual short button: about 4.3 mm, typical", (p) => p.kind === "tact" && p.params["smd"] === undefined),
  row("tact switch 6 x 6, surface-mount", 4.3, "makers' 6 × 6 mm surface-mount tact switch drawings with the usual short button: about 4.3 mm, typical", (p) => p.kind === "tact" && p.params["smd"] === true),
  row("ceramic resonator 3.2 x 1.3", 0.9, "makers' 3.2 × 1.3 mm three-terminal ceramic resonator drawings: about 0.9 mm, typical", (p) => p.kind === "resonator" && p.code === "3213"),
  ...INDUCTOR_HEIGHTS.map(([side, height]) => inductor(side, height)),
]
