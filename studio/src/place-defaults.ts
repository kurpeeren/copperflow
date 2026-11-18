// Starting props of every built-in part, so a placed part builds with no error and a footprint copperflow makes.
// The inspector's usual props (inspector-sections.ts SUGGESTED_PROPS) read the same table. Plain TypeScript.
import type { Literal } from "../../src/core/types.js"

export type StartingProps = Readonly<Record<string, Literal>>

/** One entry per built-in kind of src/core/place.ts BUILTIN_PARTS; test/place-defaults.test.ts builds each one. */
export const PLACE_DEFAULTS: Readonly<Record<string, StartingProps>> = {
  resistor: { resistance: "10k", footprint: "0402" },
  capacitor: { capacitance: "100nF", footprint: "0402" },
  inductor: { inductance: "10uH", footprint: "0805" },
  led: { color: "red", footprint: "0603" },
  diode: { footprint: "sod123" },
  fuse: { currentRating: "500mA", footprint: "1206" },
  crystal: { frequency: "16MHz", footprint: "hc49s" },
  resonator: { frequency: "16MHz", footprint: "resonator3213" },
  // No footprint prop: the pads follow pinCount when the person changes it.
  pinheader: { pinCount: 4 },
  pushbutton: { footprint: "tact6x6" },
  switch: { footprint: "pinrow2" },
  testpoint: { footprint: "pinrow1" },
  transistor: { footprint: "sot23" },
  mosfet: { footprint: "sot23" },
  battery: { voltage: "3V", footprint: "pinrow2" },
  potentiometer: { maxResistance: "10k", footprint: "pinrow3" },
}

/** The starting props of a kind; none for a library part. */
export function placeDefaults(kind: string): StartingProps {
  return Object.hasOwn(PLACE_DEFAULTS, kind) ? (PLACE_DEFAULTS[kind] as StartingProps) : {}
}

/** A starting value as a typed field shows it. */
export function propText(value: Literal): string {
  return typeof value === "string" ? value : JSON.stringify(value)
}
