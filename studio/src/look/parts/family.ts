// Which family of simple shape a part is drawn as, from what the design already says of it (its kind, its package
// name, whether its pads go through the board, the letter its designator starts with), and the colours of each
// family. Every colour is copperflow's own choice, picked by eye to read on a screen; none is said to be any maker's.
import { parseFootprint, type ParsedFootprint } from "../../../../src/engine/footprints/parse.js"
import type { Rgb } from "../scene.js"
import { SMD_LOOKS, smdFamilyOf, type SmdFamily } from "./smd-family.js"
import { UNO_LOOKS, unoFamilyOf, type UnoFamily } from "./uno-family.js"

export type Family = "chip" | "molded" | "gullwing" | "leadless" | "header" | "crystal" | "electrolytic" | "block" | "box" | "bga" | "dip" | "to220" | "to92" | "tab" | "axial" | "ledth" | "screw" | "socket" | SmdFamily | UnoFamily

/** The colours a shape is painted with; each family's table row says which it uses. */
export interface FamilyLook {
  sentence: string
  body: Rgb
  /** The top of the body when it differs: a chip resistor's dark coat, an LED's lens, a can's lid. */
  top?: Rgb
  /** Metal: end caps, legs, pins, leads. */
  metal: Rgb
  /** A mark: pin 1, the cathode, the minus stripe. */
  mark: Rgb
}

const TIN: Rgb = [196, 198, 200]
const GOLD: Rgb = [214, 176, 86]

export const FAMILY_LOOKS = {
  resistor: { sentence: "Chip resistor: a pale ceramic body under a near-black coat, between two tinned end caps.", body: [216, 214, 204], top: [34, 34, 36], metal: TIN, mark: [34, 34, 36] },
  capacitor: { sentence: "Chip capacitor: a tan ceramic body between two tinned end caps.", body: [176, 138, 92], metal: TIN, mark: [176, 138, 92] },
  led: { sentence: "Chip LED: a white body under a pale yellow lens, a green mark at the cathode.", body: [234, 234, 226], top: [244, 232, 168], metal: TIN, mark: [64, 168, 92] },
  chip: { sentence: "Any other chip part: a grey-brown body between two tinned end caps.", body: [120, 112, 100], metal: TIN, mark: [120, 112, 100] },
  molded: { sentence: "Moulded diode: a near-black body, a light grey band at the cathode, flat tinned leads.", body: [44, 44, 46], metal: TIN, mark: [200, 200, 194] },
  gullwing: { sentence: "Gull-wing chip: a near-black moulded body with a pin 1 dot, tinned legs bent down to the pads.", body: [40, 40, 43], metal: TIN, mark: [96, 96, 100] },
  leadless: { sentence: "Leadless chip: a near-black body with a pin 1 dot, tinned terminals at its edges.", body: [40, 40, 43], metal: TIN, mark: [96, 96, 100] },
  bga: { sentence: "Ball grid array: a tan substrate on a ball of tin under every pad, a dark mould cap on it and a pin 1 dot.", body: [36, 36, 40], top: [150, 128, 78], metal: TIN, mark: [196, 196, 190] },
  dip: { sentence: "Dual in-line package: a near-black body raised off the board with a notch and dot at pin 1, flat tinned legs down through the holes.", body: [34, 34, 38], metal: TIN, mark: [150, 150, 156] },
  to220: { sentence: "TO-220: a metal tab with its hole at the back of a near-black plastic body, flat tinned leads (two, three or five) down into the board; the TO-247 is bigger, the TO-126 all plastic with a hole.", body: [30, 30, 33], metal: [176, 180, 186], mark: [30, 30, 33] },
  to92: { sentence: "TO-92: a near-black body with a flat front and a round back, raised on three tinned leads.", body: [34, 34, 36], metal: TIN, mark: [34, 34, 36] },
  tab: { sentence: "Power SOT with a tab: a near-black body with a pin 1 dot, tinned legs on the narrow pads and one wide flat tab on the wide pad.", body: [40, 40, 43], metal: TIN, mark: [96, 96, 100] },
  axialResistor: { sentence: "Axial resistor: a beige body lying above the board with three or four coloured bands (fixed colours, not the value's code), a wire from each end bent down through its hole.", body: [214, 188, 142], metal: TIN, mark: [214, 188, 142] },
  axialDiode: { sentence: "Axial diode: a near-black body with a pale band at the cathode end, a wire from each end bent down through its hole.", body: [38, 38, 40], metal: TIN, mark: [208, 208, 200] },
  axialGlass: { sentence: "Glass diode: an orange glass body with a dark band at the cathode end, a wire from each end bent down through its hole.", body: [214, 122, 44], metal: TIN, mark: [34, 30, 28] },
  axialPlain: { sentence: "Any other axial part: a plain grey body lying above the board, a wire from each end bent down through its hole.", body: [122, 126, 132], metal: TIN, mark: [122, 126, 132] },
  ledlens: { sentence: "Round LED: a flange ring on the board with a flat at the cathode, a translucent-looking lens (red unless the part says another colour) with a domed top, two tinned leads.", body: [214, 48, 44], top: [236, 96, 88], metal: TIN, mark: [244, 240, 232] },
  screw: { sentence: "Screw terminal block: a green block with a slotted round screw head on top and a dark wire opening on the front of every pole, a tinned pin through each hole.", body: [44, 128, 78], metal: TIN, mark: [16, 18, 18] },
  socket: { sentence: "Pin socket: a black body with a dark square opening over every pin and a gold pin through each hole.", body: [26, 26, 28], metal: GOLD, mark: [8, 8, 10] },
  header: { sentence: "Pin header: a black plastic base with a gold pin on every pad.", body: [28, 28, 30], metal: GOLD, mark: [28, 28, 30] },
  crystal: { sentence: "Crystal: a plain metal can with rounded ends.", body: [188, 190, 194], metal: TIN, mark: [188, 190, 194] },
  electrolytic: { sentence: "Electrolytic capacitor: a black sleeve with a white stripe of chevrons and minus bars at the minus lead, its value and voltage printed up the can, a metal lid with a vent.", body: [30, 30, 33], top: [186, 190, 196], metal: TIN, mark: [228, 230, 232] },
  relay: { sentence: "Relay: a mid-blue box with its leads.", body: [46, 86, 156], top: [58, 100, 170], metal: TIN, mark: [46, 86, 156] },
  terminal: { sentence: "Connector at another pitch, such as a terminal block: a green box with its leads.", body: [44, 128, 78], metal: TIN, mark: [44, 128, 78] },
  block: { sentence: "Any other through-hole part: a dark grey box with its leads.", body: [72, 74, 78], metal: TIN, mark: [72, 74, 78] },
  ...SMD_LOOKS,
  ...UNO_LOOKS,
  box: { sentence: "Anything else: a plain box, as before shapes were drawn.", body: [96, 138, 118], metal: TIN, mark: [96, 138, 118] },
} as const satisfies Record<string, FamilyLook>

export type LookName = keyof typeof FAMILY_LOOKS

const CHIP_CODES = new Set(["0201", "0402", "0603", "0805", "1206", "1210", "1812", "2010", "2512", "01005", "2220"])
const GULLWING = new Set(["soic", "sot", "sop", "ssop", "tssop", "msop", "qsop", "smdip", "qfp", "lqfp", "tqfp", "sc"])
const LEADLESS = new Set(["qfn", "dfn", "son", "wson", "vson"])
const TABBED = new Set(["223", "89"])
const MOLDED = new Set(["sod", "sma", "smb", "smc", "do"])

const parsed = (footprint: string | undefined): ParsedFootprint | undefined =>
  footprint === undefined || footprint.includes("/") || footprint.endsWith(".yaml") ? undefined : parseFootprint(footprint)

/** The family's look for a chip part: by its kind. */
function chipLook(kind: string): LookName {
  if (kind === "resistor") return "resistor"
  if (kind === "capacitor") return "capacitor"
  if (kind === "led") return "led"
  return "chip"
}

/** The TO packages drawn as the TO-220 family, by code, and the codes of the axial diodes (DO-35, -41, -15, -201). */
const TO220_FAMILY = new Set(["220", "247", "126"])
const AXIAL_DIODE_CODES = new Set(["35", "41", "15", "201"])

/** An axial part's look: a resistor by its kind, a diode by its kind or its DO name (glass for DO-35), else plain. */
function axialLook(kind: string, p: ParsedFootprint): LookName {
  if (p.kind === "do") return p.code === "35" ? "axialGlass" : "axialDiode"
  if (kind === "resistor") return "axialResistor"
  if (kind === "diode") return "axialDiode"
  return "axialPlain"
}

/** A through-hole block's look: by the letter its designator starts with (K a relay, J, P or X a connector). */
function blockLook(name: string): LookName {
  const letter = /^[A-Za-z]+/.exec(name)?.[0]?.toUpperCase() ?? ""
  if (letter === "K") return "relay"
  if (letter === "J" || letter === "P" || letter === "X" || letter === "CN") return "terminal"
  return "block"
}

/** The family a part is drawn as, and its colours. */
export function familyOf(kind: string, footprint: string | undefined, through = false, name = ""): { family: Family; look: LookName; parsed?: ParsedFootprint } {
  const p = parsed(footprint)
  const withParsed = (family: Family, look: LookName) => ({ family, look, ...(p ? { parsed: p } : {}) })
  if (p !== undefined) {
    if (p.kind === "" && CHIP_CODES.has(p.code)) return withParsed("chip", chipLook(kind))
    if (p.kind === "bga") return withParsed("bga", "bga")
    if (p.kind === "dip") return withParsed("dip", "dip")
    if (p.kind === "to" && TO220_FAMILY.has(p.code)) return withParsed("to220", "to220")
    if (p.kind === "axial" || (p.kind === "do" && AXIAL_DIODE_CODES.has(p.code))) return withParsed("axial", axialLook(kind, p))
    if (p.kind === "led" && p.suffix === "mm") return withParsed("ledth", "ledlens")
    if (p.kind === "screw") return withParsed("screw", "screw")
    if (p.kind === "socket") return withParsed("socket", "socket")
    if (p.kind === "to" && p.code === "92") return withParsed("to92", "to92")
    const uno = unoFamilyOf(p)
    if (uno !== undefined) return withParsed(uno, uno)
    const smd = smdFamilyOf(p)
    if (smd !== undefined) return withParsed(smd.family, smd.look)
    if (p.kind === "sot" && TABBED.has(p.code) && p.variant === undefined) return withParsed("tab", "tab")
    if (MOLDED.has(p.kind)) return withParsed("molded", "molded")
    if (GULLWING.has(p.kind)) return withParsed("gullwing", "gullwing")
    if (LEADLESS.has(p.kind)) return withParsed("leadless", "leadless")
    if (p.kind === "pinrow" && (p.params["p"] === undefined || p.params["p"] === 2.54 || (typeof p.params["p"] === "number" && p.params["p"] < 2.54))) return withParsed("header", "header")
    if (p.kind === "hc" && p.code === "49") return withParsed("crystal", "crystal")
    if (p.kind === "radial") return withParsed("electrolytic", "electrolytic")
    if (p.kind === "pinrow") return withParsed("block", blockLook(name || "J"))
  }
  if (through) return withParsed("block", blockLook(name))
  return withParsed("box", "box")
}
