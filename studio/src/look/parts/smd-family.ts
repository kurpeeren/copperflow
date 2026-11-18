// The families of the surface-mount packages that have a shape of their own (MELF cylinders, tantalum capacitors, resistor
// arrays, aluminium cans, crystals, SMD LEDs, PLCC chips and the DPAK power packages), the colours of each and which strings
// are theirs. family.ts spreads the colours into its table and asks `smdFamilyOf` first. Every colour is copperflow's own
// choice, picked by eye to read on a screen; none is said to be any maker's.
import type { ParsedFootprint } from "../../../../src/engine/footprints/parse.js"
import type { Rgb } from "../scene.js"
import type { FamilyLook } from "./family.js"

const TIN: Rgb = [196, 198, 200]

export const SMD_LOOKS = {
  melf: { sentence: "MELF diode: a dark glass cylinder lying on the board between two tinned end caps, a pale band at the cathode.", body: [54, 42, 40], metal: TIN, mark: [214, 208, 190] },
  tantalum: { sentence: "Tantalum capacitor: an amber moulded block with a darker stripe across the top at the plus end, tinned terminals wrapped over its ends.", body: [204, 140, 56], metal: TIN, mark: [112, 70, 28] },
  array: { sentence: "Resistor array: one pale ceramic body under a near-black coat with a small tinned terminal over each pad.", body: [206, 202, 190], top: [34, 34, 38], metal: TIN, mark: [34, 34, 38] },
  smdcan: { sentence: "Surface-mount aluminium capacitor: a black plastic base with two clipped corners under a round aluminium can, a dark segment on the lid at the minus side.", body: [28, 28, 32], top: [200, 204, 210], metal: [186, 190, 196], mark: [34, 36, 42] },
  xtal: { sentence: "Surface-mount crystal: a ceramic base under a smaller metal lid with a dot at pin 1, tinned terminals at the pads.", body: [212, 196, 162], top: [186, 190, 196], metal: TIN, mark: [60, 60, 66] },
  xtalCan: { sentence: "HC-49 SMD crystal: a metal can with rounded ends on a low dark seat, a flat tinned lead to each pad.", body: [188, 190, 194], top: [204, 206, 210], metal: TIN, mark: [38, 38, 42] },
  ledsmd: { sentence: "Surface-mount LED: a white body with a round pale lens on top and a clipped corner at pad 1 (the two-pad one a green bar at the cathode), tinned terminals.", body: [238, 238, 230], top: [250, 240, 196], metal: TIN, mark: [64, 168, 92] },
  plcc: { sentence: "PLCC chip: a near-black body with a clipped corner and a dot at pin 1 and a tinned J-lead on every pad.", body: [34, 34, 38], metal: TIN, mark: [150, 150, 156] },
} as const satisfies Record<string, FamilyLook>

export type SmdFamily = "melf" | "tantalum" | "array" | "smdcan" | "xtal" | "ledsmd" | "plcc"

/** The family and look of a string that is one of these packages, else undefined. */
export function smdFamilyOf(p: ParsedFootprint): { family: SmdFamily | "tab"; look: keyof typeof SMD_LOOKS | "tab" } | undefined {
  if (p.kind === "minimelf" || p.kind === "melf" || (p.kind === "sod" && p.code === "80") || (p.kind === "do" && p.code === "213")) return { family: "melf", look: "melf" }
  if (p.kind === "tant") return { family: "tantalum", look: "tantalum" }
  if (p.kind === "array") return { family: "array", look: "array" }
  if (p.kind === "smdcan") return { family: "smdcan", look: "smdcan" }
  if (p.kind === "xtal") return { family: "xtal", look: "xtal" }
  if (p.kind === "hc" && p.code === "49" && p.suffix === "smd") return { family: "xtal", look: "xtalCan" }
  if (p.kind === "led" && (p.code === "3528" || p.code === "5050")) return { family: "ledsmd", look: "ledsmd" }
  if (p.kind === "plcc") return { family: "plcc", look: "plcc" }
  const power = (p.kind === "dpak" && p.code === "") || (p.kind === "to" && (p.code === "252" || p.code === "263")) || (p.kind === "d" && p.code === "2" && p.suffix === "pak")
  return power ? { family: "tab", look: "tab" } : undefined
}
