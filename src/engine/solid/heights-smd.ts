// The height rows of the surface-mount packages that were drawn as an assumed 1 mm box: the smallest and the largest
// chips, the small diodes and SOTs, the MELF cylinders, the power SOTs with a tab, tantalum capacitors, resistor
// arrays, aluminium cans, crystals, PLCC LEDs and PLCC chips. Every row is typical: written from general knowledge of
// makers' drawings and the case names, none read from a document in this table. heights.ts puts them in its table.
import type { ParsedFootprint } from "../footprints/parse.js"
import type { HeightRow } from "./heights.js"

/** A row for the strings `matches` accepts, typical, with its name and source. */
const row = (packages: string, height: number, source: string, matches: HeightRow["matches"]): HeightRow => ({ packages, height, source, matches })

const bare = (p: ParsedFootprint) => p.variant === undefined && p.cross === undefined && p.size === undefined
const named = (kind: string, code: string) => (p: ParsedFootprint) => p.kind === kind && p.code === code && bare(p)
const anyOf = (...tests: HeightRow["matches"][]): HeightRow["matches"] => (p) => tests.some((test) => test(p))

const CHIPS: readonly HeightRow[] = [
  row("chip 01005", 0.2, "makers' 01005 chip resistor and capacitor series: about 0.2 mm thick", (p) => p.kind === "" && p.code === "01005" && p.variant === undefined),
  row("chip 2220", 3.2, "makers' chip capacitor series: the thickest part commonly made in this size", (p) => p.kind === "" && p.code === "2220" && p.variant === undefined),
]

const flatLead = (name: string, code: string, height: number): HeightRow =>
  row(name, height, `makers' ${name} drawings: a flat-lead body up to about ${height} mm`, (p) => p.kind === "sod" && p.code === code && p.suffix === undefined && bare(p))

const DIODES: readonly HeightRow[] = [
  flatLead("SOD-523", "523", 0.7),
  flatLead("SOD-923", "923", 0.4),
  row("SOD-123F", 1.1, "makers' SOD-123F drawings: a flat-lead body up to about 1.1 mm", (p) => p.kind === "sod" && p.code === "123" && p.suffix === "f" && bare(p)),
  flatLead("SOD-128", "128", 1.1),
]

/** A MELF cylinder lies on the board, so it stands as high as it is wide: its largest diameter. */
const melf = (name: string, height: number, keys: readonly string[]): HeightRow =>
  row(name, height, `a MELF cylinder lies on the board: as high as the body is wide, the largest diameter of the footprint outline (${height} mm), which is written from general knowledge of makers' drawings`, (p) => bare(p) && keys.includes(`${p.kind}${p.code}${p.suffix ?? ""}`))

const MELFS: readonly HeightRow[] = [melf("MiniMELF (SOD-80, DO-213AA)", 1.6, ["minimelf", "sod80", "do213aa"]), melf("MELF (DO-213AB)", 2.6, ["melf", "do213ab"])]

const SMALL_SOT = "makers' small SOT drawings"
const SMALL_SOTS: readonly HeightRow[] = [
  row("SOT-323, SOT-353, SOT-363 (SC-70)", 1.1, `${SMALL_SOT} (SC-70 family): A max about 1.1 mm`, anyOf((p) => p.kind === "sot" && ["323", "353", "363"].includes(p.code) && bare(p), (p) => p.kind === "sc" && p.code === "70")),
  row("SOT-523, SC-89", 0.8, `${SMALL_SOT}: A max about 0.8 mm`, named("sot", "523")),
  row("SOT-563", 0.6, `${SMALL_SOT}: A max about 0.6 mm`, named("sot", "563")),
  row("SOT-723", 0.55, `${SMALL_SOT}: A max about 0.55 mm`, named("sot", "723")),
  row("SOT-143", 1.1, `${SMALL_SOT}: A max about 1.1 mm`, named("sot", "143")),
  row("SOT-23-8", 1.45, "typical, as the five and six lead SOT-23 packages in this table (JEDEC MO-178 outline), not read for eight leads", (p) => p.kind === "sot" && p.code === "23" && p.variant === "8"),
]

const SMALL_ICS: readonly HeightRow[] = [
  row("MSOP (3 mm)", 1.1, "JEDEC MO-187 (MSOP), A max about 1.1 mm, typical", (p) => p.kind === "msop"),
  row("QSOP (150 mil)", 1.75, "JEDEC MO-137 (QSOP), A max about 1.75 mm, typical", (p) => p.kind === "qsop"),
  row("surface-mount DIP", 4.5, "makers' drawings of the gull-wing option of a 300 mil DIP: about 4.5 mm above the board, typical", (p) => p.kind === "smdip"),
  row("PLCC (MS-018)", 4.57, "JEDEC MS-018 (square PLCC), A max about 4.57 mm, typical", (p) => p.kind === "plcc" && p.code !== "32"),
  row("PLCC-32 (MS-016)", 3.55, "JEDEC MS-016 (rectangular PLCC-32), A max about 3.55 mm, typical", (p) => p.kind === "plcc" && p.code === "32"),
]

const POWER = "makers' drawings, A max about"
const POWERS: readonly HeightRow[] = [
  row("DPAK (TO-252)", 2.4, `${POWER} 2.4 mm for DPAK (TO-252), typical`, anyOf((p) => p.kind === "dpak" && p.code === "", (p) => p.kind === "to" && p.code === "252")),
  row("D2PAK (TO-263), 3, 5 or 7 leads", 4.8, `${POWER} 4.8 mm for D2PAK (TO-263), typical`, anyOf((p) => p.kind === "d" && p.code === "2" && p.suffix === "pak", (p) => p.kind === "to" && p.code === "263")),
]

/** A tantalum case name such as 3216-18 ends in the case height in tenths of a millimetre. */
const CASE_NAME = "EIA case name: the last two digits of the case code are its height in tenths of a mm; the maker's tolerance was not read"
const tantalum = (letter: string, size: string | undefined, height: number): HeightRow =>
  row(`tantalum case ${letter.toUpperCase()}`, height, `${CASE_NAME} (${height} mm)`, (p) => p.kind === "tant" && (size === undefined ? p.params[letter] === true : p.code === size))

const TANTALUMS: readonly HeightRow[] = [
  tantalum("a", undefined, 1.8),
  tantalum("b", undefined, 2.1),
  tantalum("c", undefined, 2.8),
  tantalum("d", undefined, 3.1),
  tantalum("e", undefined, 4.3),
  tantalum("a", "3216", 1.8),
  tantalum("b", "3528", 2.1),
  tantalum("c", "6032", 2.8),
  tantalum("d", "7343", 3.1),
]

const array = (name: string, height: number): HeightRow =>
  row(`chip resistor array ${name}`, height, `makers' chip resistor array series: about ${height} mm thick, typical`, (p) => p.kind === "array" && `${p.code}x${p.cross}` === name)

const ARRAYS: readonly HeightRow[] = [array("4x0603", 0.5), array("4x0402", 0.35), array("2x0402", 0.35)]

const CANS: readonly HeightRow[] = [
  {
    packages: "surface-mount aluminium can",
    height: 0,
    source: "the can height written in the footprint name (smdcan8x10.2 is 10.2 mm), the whole part above the board",
    heightOf: (p) => Number(p.cross),
    matches: (p) => p.kind === "smdcan" && p.cross !== undefined,
  },
]

const xtal = (key: string, height: number): HeightRow =>
  row(`crystal ${key}`, height, `makers' surface-mount crystal and oscillator drawings of this size: about ${height} mm, typical`, (p) => `${p.kind}${p.code}${p.variant === undefined ? "" : `_${p.variant}`}` === key && p.suffix === undefined)

const CRYSTALS: readonly HeightRow[] = [
  xtal("xtal2016", 0.5),
  xtal("xtal2520", 0.6),
  xtal("xtal3225", 0.8),
  xtal("xtal5032", 1.2),
  xtal("xtal5032_2", 1.2),
  xtal("xtal3215", 0.9),
  xtal("xtal7050", 1.4),
  row("HC-49/US SMD crystal", 4.5, "crystal makers' HC-49/US SMD drawings: a can about 3.5 mm on a seat about 1 mm, typical", (p) => p.kind === "hc" && p.code === "49" && p.suffix === "smd"),
]

const led = (key: string, height: number): HeightRow =>
  row(`PLCC LED ${key}`, height, `LED makers' PLCC drawings of this size: about ${height} mm, typical`, (p) => p.kind === "led" && `${p.code}${p.variant === undefined ? "" : `_${p.variant}`}` === key)

const LEDS: readonly HeightRow[] = [led("3528", 1.9), led("5050", 1.6), led("5050_6", 1.6)]

/** The rows of every package this file covers, in the order they are tried. */
export const SMD_ROWS: readonly HeightRow[] = [...CHIPS, ...DIODES, ...MELFS, ...SMALL_SOTS, ...SMALL_ICS, ...POWERS, ...TANTALUMS, ...ARRAYS, ...CANS, ...CRYSTALS, ...LEDS]
