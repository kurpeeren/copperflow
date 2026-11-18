// The catalogue of standard packages: the footprint strings copperflow makes, under the names people call them by,
// so a person or an agent can browse them. Mostly data (the lists below), then a few pure functions. Every string
// listed is checked against `generateFootprint` by test/engine/footprints-catalogue.test.ts; facts about a package
// (pad count, size, mount) are computed from the generated footprint, never typed in.
import { generateFootprint } from "./index.js"

export const PACKAGE_GROUPS = [
  "Chip passives",
  "Diodes",
  "Transistors and regulators",
  "ICs with leads",
  "ICs without leads",
  "Capacitors",
  "Crystals and oscillators",
  "Inductors",
  "LEDs",
  "Through-hole",
  "Connectors",
  "Switches",
] as const

export type PackageGroup = (typeof PACKAGE_GROUPS)[number]

export interface PackageEntry {
  /** The string to type as the footprint. */
  readonly footprint: string
  /** What people call the package. */
  readonly name: string
  readonly group: PackageGroup
  /** Other strings that give the same footprint, found by a search. */
  readonly also?: readonly string[]
  /** A less common size of a numbered family: shown in searches and in full lists, left out of the short list. */
  readonly extra?: true
}

/** A family that takes numbers: its general form and what it says. The listed packages are examples of these. */
export interface PackageForm {
  readonly form: string
  readonly says: string
}

type Row = readonly [footprint: string, name: string, ...also: string[]]

const rows = (group: PackageGroup, list: readonly Row[], extra = false): PackageEntry[] =>
  list.map(([footprint, name, ...also]) => ({ footprint, name, group, ...(also.length > 0 ? { also } : {}), ...(extra ? { extra: true as const } : {}) }))


const CHIPS = rows("Chip passives", [
  ["01005", "01005 (0402 metric)"],
  ["0201", "0201 (0603 metric)"],
  ["0402", "0402 (1005 metric)"],
  ["0603", "0603 (1608 metric)"],
  ["0805", "0805 (2012 metric)"],
  ["1206", "1206 (3216 metric)"],
  ["1210", "1210 (3225 metric)"],
  ["1812", "1812 (4532 metric)"],
  ["2010", "2010 (5025 metric)"],
  ["2220", "2220 (5750 metric)"],
  ["2512", "2512 (6332 metric)"],
  ["array2x0402", "2x0402 resistor array"],
  ["array4x0402", "4x0402 resistor array"],
  ["array4x0603", "4x0603 resistor array"],
])

const DIODES = rows("Diodes", [
  ["sod923", "SOD-923"],
  ["sod523", "SOD-523 (SC-79)"],
  ["sod323", "SOD-323 (SC-76)"],
  ["sod123", "SOD-123"],
  ["sod123f", "SOD-123F, flat leads"],
  ["sod128", "SOD-128"],
  ["sma", "SMA (DO-214AC)", "do214ac"],
  ["smb", "SMB (DO-214AA)", "do214aa"],
  ["smc", "SMC (DO-214AB)", "do214ab"],
  ["minimelf", "MiniMELF (SOD-80, DO-213AA)", "sod80", "do213aa"],
  ["melf", "MELF (DO-213AB)", "do213ab"],
  ["do35", "DO-35 axial"],
  ["do41", "DO-41 axial"],
  ["do15", "DO-15 axial"],
  ["do201ad", "DO-201AD axial"],
])

const TRANSISTORS = rows("Transistors and regulators", [
  ["sot723", "SOT-723"],
  ["sot523", "SOT-523 (SC-89)"],
  ["sot563", "SOT-563"],
  ["sot323", "SOT-323 (SC-70)", "sc70"],
  ["sot353", "SOT-353 (SC-70-5)", "sc70_5"],
  ["sot363", "SOT-363 (SC-70-6)", "sc70_6"],
  ["sot143", "SOT-143"],
  ["sot23", "SOT-23 (TO-236)"],
  ["sot23_5", "SOT-23-5 (SOT-25)"],
  ["sot23_6", "SOT-23-6 (SOT-26)"],
  ["sot23_8", "SOT-23-8"],
  ["sot89", "SOT-89 (TO-243)"],
  ["sot223", "SOT-223 (TO-261)"],
  ["dpak", "DPAK (TO-252)", "to252"],
  ["d2pak", "D2PAK (TO-263)", "to263"],
  ["d2pak_5", "D2PAK-5 (TO-263-5)", "to263_5"],
  ["d2pak_7", "D2PAK-7 (TO-263-7)", "to263_7"],
  ["to92", "TO-92, leads at 2.54"],
  ["to126", "TO-126"],
  ["to220", "TO-220-3"],
  ["to220_2", "TO-220-2"],
  ["to220_5", "TO-220-5"],
  ["to247", "TO-247"],
])

const ICS_WITH_LEADS = rows("ICs with leads", [
  ["soic8", "SOIC-8, 3.9 mm"],
  ["soic14", "SOIC-14, 3.9 mm"],
  ["soic16", "SOIC-16, 3.9 mm"],
  ["soic16w", "SOIC-16 wide, 7.5 mm"],
  ["sop8", "SOP-8, 5.3 mm"],
  ["msop8", "MSOP-8, 0.65 pitch"],
  ["msop10", "MSOP-10, 0.5 pitch"],
  ["ssop20", "SSOP-20, 5.3 mm"],
  ["tssop20", "TSSOP-20, 4.4 mm"],
  ["smdip4", "SMD DIP-4 (optocoupler)"],
  ["smdip8", "SMD DIP-8"],
  ["lqfp48_7x7_p0.5", "LQFP-48 7x7, 0.5 pitch", "qfp48", "tqfp48_7x7_p0.5"],
  ["lqfp64_10x10_p0.5", "LQFP-64 10x10, 0.5 pitch", "qfp64", "tqfp64_10x10_p0.5"],
  ["lqfp100_14x14_p0.5", "LQFP-100 14x14, 0.5 pitch", "qfp100", "tqfp100_14x14_p0.5"],
  ["lqfp144_20x20_p0.5", "LQFP-144 20x20, 0.5 pitch", "tqfp144_20x20_p0.5"],
  ["plcc28", "PLCC-28, J-leads"],
  ["plcc44", "PLCC-44, J-leads"],
  ["dip8", "DIP-8, 300 mil"],
  ["dip14", "DIP-14, 300 mil"],
  ["dip28_w15.24", "DIP-28, 600 mil"],
  ["dip40_w15.24", "DIP-40, 600 mil"],
])

const ICS_WITHOUT_LEADS = rows("ICs without leads", [
  ["qfn16_3x3_p0.5", "QFN-16 3x3, 0.5 pitch", "qfn16"],
  ["qfn20_4x4_p0.5", "QFN-20 4x4, 0.5 pitch"],
  ["qfn32_5x5_p0.5", "QFN-32 5x5, 0.5 pitch", "qfn32"],
  ["qfn32_5x5_p0.5_ep3.1", "QFN-32 5x5, exposed pad 3.1", "qfn32_ep"],
  ["qfn48_7x7_p0.5", "QFN-48 7x7, 0.5 pitch", "qfn48"],
  ["qfn64_9x9_p0.5", "QFN-64 9x9, 0.5 pitch"],
  ["dfn6_2x2_p0.65", "DFN-6 (SON) 2x2, 0.65 pitch"],
  ["dfn8_3x3_p0.65", "DFN-8 (SON) 3x3, 0.65 pitch"],
  ["bga100_11x11_p1", "BGA-100 11x11, 1 pitch"],
  ["bga256_17x17_p1", "BGA-256 17x17, 1 pitch"],
])

const CAPACITORS = rows("Capacitors", [
  ["tant_a", "Tantalum A (EIA 3216-18)", "tant3216"],
  ["tant_b", "Tantalum B (EIA 3528-21)", "tant3528"],
  ["tant_c", "Tantalum C (EIA 6032-28)", "tant6032"],
  ["tant_d", "Tantalum D (EIA 7343-31)", "tant7343"],
  ["tant_e", "Tantalum E (EIA 7343-43)"],
  ["smdcan4x5.4", "SMD electrolytic 4x5.4"],
  ["smdcan6.3x5.4", "SMD electrolytic 6.3x5.4"],
  ["smdcan8x10.2", "SMD electrolytic 8x10.2"],
  ["smdcan10x10.2", "SMD electrolytic 10x10.2"],
  ["radial6.3x2.5", "Radial electrolytic 6.3, leads 2.5"],
  ["radial8x3.5", "Radial electrolytic 8, leads 3.5"],
  ["radial10x5", "Radial electrolytic 10, leads 5"],
])

const CRYSTALS = rows("Crystals and oscillators", [
  ["xtal2016", "Crystal 2.0x1.6"],
  ["xtal2520", "Crystal 2.5x2.0"],
  ["xtal3225", "Crystal 3.2x2.5"],
  ["xtal5032", "Crystal 5.0x3.2, 4 pads"],
  ["xtal5032_2", "Crystal 5.0x3.2, 2 pads"],
  ["xtal3215", "Crystal 3.2x1.5, 32.768 kHz"],
  ["xtal7050", "Oscillator 7.0x5.0"],
  ["hc49smd", "HC-49/US SMD crystal"],
  ["hc49", "HC-49/U crystal"],
  ["hc49s", "HC-49/S crystal"],
])

/**
 * The parts added for the Arduino Uno (resonator, inductors, USB and DC receptacles, tact switches) are all extras:
 * a search or a full list shows them, the short list stays under its size limit.
 */
const CRYSTALS_EXTRA = rows("Crystals and oscillators", [["resonator3213", "Ceramic resonator 3.2x1.3, 3 pads"]], true)

const INDUCTORS_EXTRA = rows(
  "Inductors",
  [4, 5, 6, 8, 10, 12].map((n): Row => [`ind${n}x${n}`, `Shielded power inductor ${n}x${n}`]),
  true,
)

const LEDS = rows("LEDs", [
  ["led3528", "PLCC-2 LED 3.5x2.8"],
  ["led5050", "PLCC-4 LED 5.0x5.0"],
  ["led5050_6", "PLCC-6 LED 5.0x5.0"],
  ["led3mm", "LED 3 mm round"],
  ["led5mm", "LED 5 mm round"],
])

const THROUGH_HOLE = rows("Through-hole", [
  ["axial3.5x7.62", "Axial 1/8 W resistor"],
  ["axial6.3x10.16", "Axial 1/4 W resistor"],
  ["axial9x12.7", "Axial 1/2 W resistor"],
  ["axial11x15.24", "Axial 1 W resistor"],
])

const CONNECTORS = rows("Connectors", [
  ...[2, 4, 6, 8, 10].map((n): Row => [`pinrow${n}`, `Pin header 1x${n}`]),
  ...[5, 10, 20].map((n): Row => [`pinrow2x${n}`, `Pin header 2x${n}`]),
  ...[8].map((n): Row => [`socket${n}`, `Pin socket 1x${n}`]),
  ["socket2x5", "Pin socket 2x5"],
  ["screw2", "Screw terminal 2 poles, 5.08"],
  ["screw3", "Screw terminal 3 poles, 5.08"],
  ["screw2_p3.5", "Screw terminal 2 poles, 3.5"],
])

const SWITCHES = rows(
  "Switches",
  [
    ["tact6x6", "Tact switch 6 × 6 mm, through-hole"],
    ["tact6x6_smd", "Tact switch 6 × 6 mm, surface-mount"],
  ],
  true,
)

/** Less common sizes of the numbered families, each group's after its first ones. */
const ICS_WITH_LEADS_EXTRA = rows(
  "ICs with leads",
  [
    ...[10, 12].map((n): Row => [`soic${n}`, `SOIC-${n}, 3.9 mm`]),
    ...[18, 20, 24, 28].map((n): Row => [`soic${n}w`, `SOIC-${n} wide, 7.5 mm`]),
    ...[10, 12, 14, 16].map((n): Row => [`sop${n}`, `SOP-${n}, 5.3 mm`]),
    ...[14, 16, 24, 28].map((n): Row => [`ssop${n}`, `SSOP-${n}, 5.3 mm`]),
    ...[8, 10, 12, 14, 16, 18, 22, 24, 26, 28].map((n): Row => [`tssop${n}`, `TSSOP-${n}, 4.4 mm`]),
    ...[16, 20, 24, 28].map((n): Row => [`qsop${n}`, `QSOP-${n}, 0.635 pitch`]),
    ["smdip6", "SMD DIP-6 (optocoupler)"],
    ["lqfp32_7x7_p0.8", "LQFP-32 7x7, 0.8 pitch", "qfp32", "tqfp32_7x7_p0.8"],
    ["lqfp44_10x10_p0.8", "LQFP-44 10x10, 0.8 pitch", "tqfp44_10x10_p0.8"],
    ["lqfp80_12x12_p0.5", "LQFP-80 12x12, 0.5 pitch", "tqfp80_12x12_p0.5"],
    ["lqfp176_24x24_p0.5", "LQFP-176 24x24, 0.5 pitch", "tqfp176_24x24_p0.5"],
    ...[20, 32, 52, 68, 84].map((n): Row => [`plcc${n}`, `PLCC-${n}, J-leads`]),
    ...[4, 6, 16, 18, 20, 24].map((n): Row => [`dip${n}`, `DIP-${n}, 300 mil`]),
    ...[24, 32].map((n): Row => [`dip${n}_w15.24`, `DIP-${n}, 600 mil`]),
  ],
  true,
)

const ICS_WITHOUT_LEADS_EXTRA = rows(
  "ICs without leads",
  [
    ["qfn24_4x4_p0.5", "QFN-24 4x4, 0.5 pitch"],
    ["qfn28_5x5_p0.5", "QFN-28 5x5, 0.5 pitch"],
    ["qfn40_6x6_p0.5", "QFN-40 6x6, 0.5 pitch"],
    ["qfn56_8x8_p0.5", "QFN-56 8x8, 0.5 pitch"],
    ["dfn8_2x2_p0.5", "DFN-8 (SON) 2x2, 0.5 pitch"],
    ["dfn10_3x3_p0.5", "DFN-10 (SON) 3x3, 0.5 pitch"],
    ["bga49_7x7_p0.8", "BGA-49 7x7, 0.8 pitch"],
    ["bga64_8x8_p0.8", "BGA-64 8x8, 0.8 pitch"],
    ["bga100_10x10_p0.8", "BGA-100 10x10, 0.8 pitch"],
    ["bga144_13x13_p1", "BGA-144 13x13, 1 pitch"],
  ],
  true,
)

const CAPACITORS_EXTRA = rows(
  "Capacitors",
  [
    ["smdcan5x5.4", "SMD electrolytic 5x5.4"],
    ["smdcan6.3x7.7", "SMD electrolytic 6.3x7.7"],
    ["radial5x2", "Radial electrolytic 5, leads 2"],
    ["radial12.5x5", "Radial electrolytic 12.5, leads 5"],
    ["radial16x7.5", "Radial electrolytic 16, leads 7.5"],
  ],
  true,
)

const CONNECTORS_EXTRA = rows(
  "Connectors",
  [
    ...[1, 3, 5, 7, 9, 12, 16, 20].map((n): Row => [`pinrow${n}`, `Pin header 1x${n}`]),
    ...[2, 3, 4, 6, 7, 8, 9, 13, 17].map((n): Row => [`pinrow2x${n}`, `Pin header 2x${n}`]),
    ...[4, 6, 10].map((n): Row => [`socket${n}`, `Pin socket 1x${n}`]),
    ...[10, 20].map((n): Row => [`socket2x${n}`, `Pin socket 2x${n}`]),
    ...[4, 5, 6].map((n): Row => [`screw${n}`, `Screw terminal ${n} poles, 5.08`]),
    ...[3, 4, 5, 6].map((n): Row => [`screw${n}_p3.5`, `Screw terminal ${n} poles, 3.5`]),
    ["usb_b", "USB Type-B receptacle, through-hole"],
    ["usb_c16", "USB Type-C receptacle, 16 pins (USB 2.0)"],
    ["dcjack", "DC barrel jack 5.5 / 2.1 mm", "dcjack2.1", "dcjack2.5"],
  ],
  true,
)

/** In catalogue order: the groups in PACKAGE_GROUPS order, each group's first sizes before its extra ones. */
export const PACKAGES: readonly PackageEntry[] = [
  ...CHIPS,
  ...DIODES,
  ...TRANSISTORS,
  ...ICS_WITH_LEADS,
  ...ICS_WITH_LEADS_EXTRA,
  ...ICS_WITHOUT_LEADS,
  ...ICS_WITHOUT_LEADS_EXTRA,
  ...CAPACITORS,
  ...CAPACITORS_EXTRA,
  ...CRYSTALS,
  ...CRYSTALS_EXTRA,
  ...INDUCTORS_EXTRA,
  ...LEDS,
  ...THROUGH_HOLE,
  ...CONNECTORS,
  ...CONNECTORS_EXTRA,
  ...SWITCHES,
]

/** The families that take numbers: any size of these works, the listed ones are examples. */
export const PACKAGE_FORMS: readonly PackageForm[] = [
  { form: "soic<N>[w] sop<N> ssop<N> tssop<N>", says: "dual gull-wing ICs by pin count" },
  { form: "qfn<N>_<b>x<b>_p<pitch>[_ep<size>]", says: "any square QFN by body and pitch" },
  { form: "dfn<N>_<a>x<b>_p<pitch>[_ep<w>x<h>]", says: "any DFN by body and pitch" },
  { form: "lqfp<N>_<b>x<b>_p<pitch>", says: "any square QFP (tqfp, qfp too)" },
  { form: "bga<N>_<x>x<y>_p<pitch>", says: "any ball grid by body and pitch" },
  { form: "dip<N>[_w<spacing>]", says: "DIP; wide is _w15.24" },
  { form: "plcc<N>", says: "PLCC 20, 28, 32, 44, 52, 68, 84" },
  { form: "pinrow<N>[_p<pitch>] pinrow2x<N>", says: "pin headers" },
  { form: "socket<N> socket2x<N>", says: "pin sockets" },
  { form: "screw<N>[_p<pitch>]", says: "screw terminals, 2-24 poles" },
  { form: "radial<can>x<spacing>", says: "radial electrolytic" },
  { form: "axial<body>x<spacing>[_d<dia>]", says: "axial resistor" },
  { form: "ind<a>x<a>", says: "power inductor 4 to 12 mm" },
  { form: "parts/<id>/footprint.yaml", says: "any other package: its own pads" },
]

/** What a package is, computed from the footprint copperflow makes for it. */
export interface PackageFacts {
  /** Distinct pad numbers. */
  readonly pads: number
  readonly mount: "surface-mount" | "through-hole"
  /** Courtyard width and height in mm, rounded to 0.1. */
  readonly width: number
  readonly height: number
  /** Where the footprint's numbers come from. */
  readonly origin: string
}

const tenth = (value: number) => Math.round(value * 10) / 10

export function packageFacts(entry: PackageEntry): PackageFacts {
  const footprint = generateFootprint(entry.footprint)
  if ("error" in footprint) throw new Error(`catalogue entry "${entry.footprint}" cannot be made: ${footprint.error}`)
  const xs = footprint.courtyard.map((point) => point.x)
  const ys = footprint.courtyard.map((point) => point.y)
  return {
    pads: new Set(footprint.pads.map((pad) => pad.number)).size,
    mount: footprint.pads.some((pad) => pad.layers === "through") ? "through-hole" : "surface-mount",
    width: tenth(Math.max(...xs) - Math.min(...xs)),
    height: tenth(Math.max(...ys) - Math.min(...ys)),
    origin: footprint.origin,
  }
}

/** Case, dashes and spaces of a written name do not matter: "SOT-23-5" finds "sot23_5". */
const plain = (text: string) => text.toLowerCase().replace(/[\s-]+/g, "")

/**
 * The packages in which every word is found, in catalogue order, in the footprint string, the name, the group or one
 * of the other strings. No words gives everything.
 */
export function findPackages(words: readonly string[]): readonly PackageEntry[] {
  const wanted = words.map(plain).filter((word) => word !== "")
  return PACKAGES.filter((entry) => {
    const fields = [entry.footprint, entry.name, entry.group, ...(entry.also ?? [])].map(plain)
    return wanted.every((word) => fields.some((field) => field.includes(word)))
  })
}
