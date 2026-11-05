import { PIN_ATTRIBUTES, PIN_TYPES } from "../core/library.js"
import type { PinType } from "./model.js"

export interface KindInfo {
  prefix: string
  valueProp?: string
  pins: { number: number; names: string[] }[] | "from-props"
}

const TWO_PINS = [
  { number: 1, names: ["pin1", "left"] },
  { number: 2, names: ["pin2", "right"] },
]
const POLARISED = [
  { number: 1, names: ["pin1", "pos", "anode"] },
  { number: 2, names: ["pin2", "neg", "cathode"] },
]
const DIODE_PINS = [
  { number: 1, names: ["pin1", "anode", "pos"] },
  { number: 2, names: ["pin2", "cathode", "neg"] },
]
const BATTERY_PINS = [
  { number: 1, names: ["pin1", "pos"] },
  { number: 2, names: ["pin2", "neg"] },
]
const plainPins = (count: number) => Array.from({ length: count }, (_, i) => ({ number: i + 1, names: [`pin${i + 1}`] }))

/**
 * Built-in kinds and the pin names they carry. These are decisions, not facts about tscircuit; they are
 * recorded in skills/copperflow/references/editable-subset.md. A capacitor with `polarized` uses
 * POLARISED instead of its table entry, and a pin whose `pinLabels` entry names it takes those names
 * instead of the aliases listed here.
 */
export const KINDS: Readonly<Record<string, KindInfo>> = {
  resistor: { prefix: "R", valueProp: "resistance", pins: TWO_PINS },
  capacitor: { prefix: "C", valueProp: "capacitance", pins: TWO_PINS },
  inductor: { prefix: "L", valueProp: "inductance", pins: TWO_PINS },
  fuse: { prefix: "F", valueProp: "currentRating", pins: TWO_PINS },
  crystal: { prefix: "Y", valueProp: "frequency", pins: TWO_PINS },
  switch: { prefix: "SW", pins: TWO_PINS },
  diode: { prefix: "D", pins: DIODE_PINS },
  led: { prefix: "D", pins: DIODE_PINS },
  battery: { prefix: "BT", valueProp: "voltage", pins: BATTERY_PINS },
  potentiometer: {
    prefix: "RV",
    valueProp: "maxResistance",
    pins: [
      { number: 1, names: ["pin1"] },
      { number: 2, names: ["pin2", "wiper"] },
      { number: 3, names: ["pin3"] },
    ],
  },
  resonator: {
    prefix: "Y",
    valueProp: "frequency",
    pins: [
      { number: 1, names: ["pin1"] },
      { number: 2, names: ["pin2", "gnd"] },
      { number: 3, names: ["pin3"] },
    ],
  },
  pushbutton: { prefix: "SW", pins: plainPins(4) },
  testpoint: { prefix: "TP", pins: plainPins(1) },
  transistor: {
    prefix: "Q",
    pins: [
      { number: 1, names: ["pin1", "B", "base"] },
      { number: 2, names: ["pin2", "E", "emitter"] },
      { number: 3, names: ["pin3", "C", "collector"] },
    ],
  },
  mosfet: {
    prefix: "Q",
    pins: [
      { number: 1, names: ["pin1", "G", "gate"] },
      { number: 2, names: ["pin2", "S", "source"] },
      { number: 3, names: ["pin3", "D", "drain"] },
    ],
  },
  pinheader: { prefix: "J", pins: "from-props" },
  chip: { prefix: "U", pins: "from-props" },
  connector: { prefix: "J", pins: "from-props" },
}

/** The built-in kind for a tag; a tag such as `constructor` that only an object's prototype has is none. */
export function kindOf(tag: string): KindInfo | undefined {
  return Object.hasOwn(KINDS, tag) ? KINDS[tag] : undefined
}

/** The inverse of PIN_ATTRIBUTES: `{ requiresPower: true }` is `power_in`. The default is `passive`. */
export function pinTypeFromAttributes(attributes: Record<string, unknown> | undefined): PinType {
  if (!attributes) return "passive"
  for (const type of PIN_TYPES) {
    const wanted = Object.keys(PIN_ATTRIBUTES[type])
    if (wanted.length > 0 && wanted.every((key) => attributes[key] === true)) return type
  }
  return "passive"
}

export interface PinSpec {
  number: number
  names: string[]
}

export interface PinSources {
  pinLabels: Record<string, unknown> | undefined
  pinCount: unknown
  polarized: boolean
  padCount: number | undefined
}

function pinNumber(key: string): number | undefined {
  const match = /^(?:pin)?(\d+)$/.exec(key)
  const number = match ? Number(match[1]) : undefined
  return number !== undefined && number >= 1 ? number : undefined
}

/** The names `pinLabels` gives each pin number: a string or a list of strings. */
export function labelledNames(pinLabels: Record<string, unknown> | undefined): Map<number, string[]> {
  const result = new Map<number, string[]>()
  for (const [key, value] of Object.entries(pinLabels ?? {})) {
    const number = pinNumber(key)
    if (number === undefined) continue
    const list = (Array.isArray(value) ? value : [value]).filter((name): name is string => typeof name === "string" && name !== "")
    if (list.length > 0) result.set(number, list)
  }
  return result
}

function countedPins(labelled: Map<number, string[]>, sources: PinSources): number[] {
  const numbers = new Set(labelled.keys())
  const count = typeof sources.pinCount === "number" && Number.isInteger(sources.pinCount) ? sources.pinCount : undefined
  const upTo = count ?? (labelled.size > 0 ? 0 : sources.padCount ?? 0)
  for (let n = 1; n <= upTo; n++) numbers.add(n)
  return [...numbers].sort((a, b) => a - b)
}

/** The pins of one part, or an empty list when the part has no way to know them. */
export function pinSpecs(tag: string, sources: PinSources): PinSpec[] {
  const info = kindOf(tag)
  if (!info) return []
  const labelled = labelledNames(sources.pinLabels)
  const aliases = new Map<number, string[]>()
  let numbers: number[]
  if (info.pins === "from-props") numbers = countedPins(labelled, sources)
  else {
    const table = tag === "capacitor" && sources.polarized ? POLARISED : info.pins
    for (const pin of table) aliases.set(pin.number, pin.names.slice(1))
    numbers = table.map((pin) => pin.number)
  }
  return numbers.map((number) => ({ number, names: [`pin${number}`, ...(labelled.get(number) ?? aliases.get(number) ?? [])] }))
}
