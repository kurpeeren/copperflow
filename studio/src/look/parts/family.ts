// Which family of simple shape a part is drawn as, from what the design already says of it (its kind, its package
// name, whether its pads go through the board, the letter its designator starts with), and the colours of each
// family. Every colour is copperflow's own choice, picked by eye to read on a screen; none is said to be any maker's.
import { parseFootprint, type ParsedFootprint } from "../../../../src/engine/footprints/parse.js"
import type { Rgb } from "../scene.js"

export type Family = "chip" | "molded" | "gullwing" | "leadless" | "header" | "crystal" | "electrolytic" | "block" | "box"

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
  header: { sentence: "Pin header: a black plastic base with a gold pin on every pad.", body: [28, 28, 30], metal: GOLD, mark: [28, 28, 30] },
  crystal: { sentence: "Crystal: a plain metal can with rounded ends.", body: [188, 190, 194], metal: TIN, mark: [188, 190, 194] },
  electrolytic: { sentence: "Electrolytic capacitor: a dark blue sleeve with a pale stripe at the minus lead, a metal lid.", body: [38, 52, 98], top: [182, 186, 192], metal: TIN, mark: [198, 204, 214] },
  relay: { sentence: "Relay: a mid-blue box with its leads.", body: [46, 86, 156], top: [58, 100, 170], metal: TIN, mark: [46, 86, 156] },
  terminal: { sentence: "Connector at another pitch, such as a terminal block: a green box with its leads.", body: [44, 128, 78], metal: TIN, mark: [44, 128, 78] },
  block: { sentence: "Any other through-hole part: a dark grey box with its leads.", body: [72, 74, 78], metal: TIN, mark: [72, 74, 78] },
  box: { sentence: "Anything else: a plain box, as before shapes were drawn.", body: [96, 138, 118], metal: TIN, mark: [96, 138, 118] },
} as const satisfies Record<string, FamilyLook>

export type LookName = keyof typeof FAMILY_LOOKS

const CHIP_CODES = new Set(["0201", "0402", "0603", "0805", "1206", "1210", "1812", "2010", "2512"])
const GULLWING = new Set(["soic", "sot", "sop", "ssop", "tssop", "msop", "qfp", "lqfp", "tqfp", "sc", "sod323f"])
const LEADLESS = new Set(["qfn", "dfn", "son", "wson", "vson"])
const MOLDED = new Set(["sod", "sma", "smb", "smc", "do", "minimelf", "melf"])

const parsed = (footprint: string | undefined): ParsedFootprint | undefined =>
  footprint === undefined || footprint.includes("/") || footprint.endsWith(".yaml") ? undefined : parseFootprint(footprint)

/** The family's look for a chip part: by its kind. */
function chipLook(kind: string): LookName {
  if (kind === "resistor") return "resistor"
  if (kind === "capacitor") return "capacitor"
  if (kind === "led") return "led"
  return "chip"
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
    if (MOLDED.has(p.kind)) return withParsed("molded", "molded")
    if (GULLWING.has(p.kind)) return withParsed("gullwing", "gullwing")
    if (LEADLESS.has(p.kind)) return withParsed("leadless", "leadless")
    if (p.kind === "pinrow" && (p.params["p"] === undefined || p.params["p"] === 2.54)) return withParsed("header", "header")
    if (p.kind === "hc" && p.code === "49") return withParsed("crystal", "crystal")
    if (p.kind === "radial") return withParsed("electrolytic", "electrolytic")
    if (p.kind === "pinrow") return withParsed("block", blockLook(name || "J"))
  }
  if (through) return withParsed("block", blockLook(name))
  return withParsed("box", "box")
}
