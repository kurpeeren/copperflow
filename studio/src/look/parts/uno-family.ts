// The families of the parts an Arduino Uno needs that have a shape of their own (the USB Type-B and Type-C receptacles,
// the barrel jack, the 6 × 6 tact switches, the ceramic resonator and the shielded power inductors), the colours of each
// and which strings are theirs. family.ts spreads the colours into its table and asks `unoFamilyOf`. Every colour is
// copperflow's own choice, picked by eye to read on a screen; none is said to be any maker's.
import type { ParsedFootprint } from "../../../../src/engine/footprints/parse.js"
import type { Rgb } from "../scene.js"
import type { FamilyLook } from "./family.js"

const TIN: Rgb = [196, 198, 200]

export const UNO_LOOKS = {
  usbb: { sentence: "USB Type-B receptacle: a tinned metal shell open at the mating face with a dark opening and a pale plastic tongue inside, two shell legs and four pins through their holes.", body: [226, 222, 204], metal: TIN, mark: [14, 14, 18] },
  usbc: { sentence: "USB Type-C receptacle: a low tinned metal shell with rounded ends, a dark stadium opening at the mating face with a thin pale tongue, shell legs through their slots and a row of terminals on the pads at the back.", body: [226, 222, 204], metal: TIN, mark: [18, 18, 22] },
  dcjack: { sentence: "Barrel jack: a black plastic body with a round opening on the mating face and a metal pin in its middle, flat terminals through the slots.", body: [32, 32, 35], metal: TIN, mark: [8, 8, 10] },
  tact: { sentence: "Tact switch, 6 × 6 mm: a low black base under a tinned metal cover plate with a round black button standing out of its middle, pins through the holes or gull-wing terminals on the pads.", body: [30, 30, 34], top: [62, 62, 68], metal: TIN, mark: [30, 30, 34] },
  resonator: { sentence: "Ceramic resonator: a small pale ceramic body under a tinned metal cap over most of its top, a terminal on each of its three pads.", body: [226, 212, 172], metal: TIN, mark: [226, 212, 172] },
  inductor: { sentence: "Shielded power inductor: a dark grey ferrite block with clipped corners and a slightly lighter top with a small mark, a tinned terminal at each pad.", body: [58, 60, 64], top: [86, 88, 94], metal: TIN, mark: [178, 180, 184] },
} as const satisfies Record<string, FamilyLook>

export type UnoFamily = keyof typeof UNO_LOOKS

/** The family (its look has the same name) of a string that is one of these parts, else undefined. */
export function unoFamilyOf(p: ParsedFootprint): UnoFamily | undefined {
  if (p.kind === "usb") return p.params["b"] === true ? "usbb" : p.params["c"] === 16 ? "usbc" : undefined
  if (p.kind === "dcjack") return "dcjack"
  if (p.kind === "tact") return "tact"
  if (p.kind === "resonator") return "resonator"
  if (p.kind === "ind") return "inductor"
  return undefined
}
