// What a read KiCad board becomes in copperflow: designators and net names copperflow accepts, each part's pins, and
// one library part per distinct land pattern, pin list and value (the value is the part's title, which the BOM reads).
import { PART_NAME, NET_NAME } from "../../core/netlist.js"
import { PIN_NAME, PIN_NUMBER, PIN_TYPES, type PinType } from "../../core/pin-types.js"
import type { FootprintFile } from "../../engine/footprints/file.js"
import type { KicadPad, KicadPart } from "./footprints.js"

/** A net KiCad named itself, from a pad (`Net-(R1-Pad1)`) or for a pad on no net (`unconnected-(U1-Pad3)`). */
export const isMadeUpName = (name: string): boolean => /^(Net-\(|unconnected-\(|Net-\/)/.test(name)

/** A name made of letters, digits and _ that starts as `first` allows. */
function cleaned(name: string, first: RegExp, prefix: string, extra = ""): string {
  const body = name.replace(new RegExp(`[^A-Za-z0-9_${extra}]`, "g"), "_")
  return first.test(body) ? body : `${prefix}${body}`
}

/** The net name copperflow writes for a KiCad net name: "+5V" is P5V, "-12V" N12V, "/sense" sense. */
export function circuitNetName(name: string): string {
  const plain = name.replace(/^\//, "").replace(/^\+/, "P").replace(/^-(?=\d)/, "N")
  const result = cleaned(plain, /^[A-Za-z_]/, "N", "-")
  return NET_NAME.test(result) ? result : "N"
}

/** Gives each name a form `make` turns it into, unique among them: a second "A" is A_2. */
function uniqueNames(names: readonly string[], make: (name: string) => string, used = new Set<string>()): Map<string, string> {
  const result = new Map<string, string>()
  for (const name of names) {
    const base = make(name)
    let candidate = base
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base}_${n}`
    used.add(candidate.toLowerCase())
    result.set(name, candidate)
  }
  return result
}

export interface PlannedNets {
  /** File net name to the circuit's name, for every net that keeps a name. */
  names: Map<string, string>
  /** File nets without a name of their own that join two or more pins. */
  unnamed: Set<string>
  /** File nets that reach one pin only: nothing to connect. */
  single: Set<string>
}

/** Which nets get a name and which are connections without one, from the pins on each; a net on no pin gets nothing. */
export function planNets(pinsOn: ReadonlyMap<string, readonly string[]>): PlannedNets {
  const names: string[] = []
  const unnamed = new Set<string>()
  const single = new Set<string>()
  for (const [net, pins] of pinsOn) {
    if (pins.length < 2 && (isMadeUpName(net) || pins.length === 0)) single.add(net)
    else if (isMadeUpName(net)) unnamed.add(net)
    else names.push(net)
  }
  return { names: uniqueNames(names, circuitNetName), unnamed, single }
}

/** Each part's designator as copperflow writes it: R1 stays R1, "#FL1" is P_FL1, a repeat gets _2. */
export function planDesignators(parts: readonly KicadPart[]): string[] {
  const used = new Set<string>()
  return parts.map((part) => {
    const base = cleaned(part.ref || "P", /^[A-Za-z]/, "P").slice(0, 28)
    let name = PART_NAME.test(base) ? base : "P"
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)}_${n}`
    used.add(name.toLowerCase())
    return name
  })
}

export interface PartPins {
  /** The pin number each pad is, in the order of the part's pads. */
  padPins: number[]
  pins: Record<string, { name: string; type: PinType }>
}

const TYPES: ReadonlySet<string> = new Set(PIN_TYPES)

function pinType(pad: KicadPad): PinType {
  const type = (pad.type ?? "passive").replace(/\+no_connect$/, "")
  if (type === "no_connect") return pad.net ? "passive" : "no_connect"
  return TYPES.has(type) ? (type as PinType) : "passive"
}

/** A pin name from the pad's function ("~{RESET}" is RESET), else from its number. */
function pinName(pad: KicadPad, number: number): string {
  const fn = pad.function?.replace(/[~{}]/g, "").trim()
  if (fn) {
    const name = cleaned(fn, /^[A-Za-z_]/, "P")
    if (PIN_NAME.test(name)) return name
  }
  if (pad.number !== "" && !PIN_NUMBER.test(pad.number)) return cleaned(pad.number, /^[A-Za-z_]/, "P")
  return pad.number === "" ? "MP" : `pin${number}`
}

/**
 * The pins of a part: a pad numbered 1, 2, … is that pin; a pad named otherwise ("A1", "SH") or unnamed gets the next
 * number after the highest, and pads of one name are one pin. A name used twice gets the pin number added: GND_4.
 */
export function planPins(part: KicadPart): PartPins {
  const numeric = part.pads.flatMap((pad) => (PIN_NUMBER.test(pad.number) ? [Number(pad.number)] : []))
  let next = Math.max(0, ...numeric) + 1
  const byName = new Map<string, number>()
  const padPins = part.pads.map((pad) => {
    if (PIN_NUMBER.test(pad.number)) return Number(pad.number)
    if (pad.number === "") return next++
    const known = byName.get(pad.number)
    if (known !== undefined) return known
    byName.set(pad.number, next)
    return next++
  })
  const pins: PartPins["pins"] = {}
  const taken = new Set<string>()
  part.pads.forEach((pad, index) => {
    const number = padPins[index] as number
    if (String(number) in pins) return
    let name = pinName(pad, number)
    if (taken.has(name.toLowerCase())) name = `${name}_${number}`
    taken.add(name.toLowerCase())
    pins[String(number)] = { name, type: pinType(pad) }
  })
  return { padPins, pins }
}

const round = (v: number) => Math.round(v * 10_000) / 10_000 || 0

/** The land pattern of a part, with its pads numbered as pins. */
export function footprintFileOf(part: KicadPart, pins: PartPins): FootprintFile {
  return {
    pads: part.pads.map((pad, index) => ({
      number: String(pins.padPins[index]),
      shape: pad.shape,
      x: round(pad.x),
      y: round(pad.y),
      width: pad.width,
      height: pad.height,
      ...(pad.rotation !== 0 ? { rotation: pad.rotation } : {}),
      ...(pad.layers === "through" ? { layers: "through" as const } : {}),
      ...(pad.drill !== undefined ? { drill: pad.drill } : {}),
    })),
  }
}

/** What makes two parts one library part: the same land pattern, pin list and value. */
export function partKey(part: KicadPart, pins: PartPins): string {
  return JSON.stringify([footprintFileOf(part, pins), pins.pins, part.value])
}

/** A library part id from a footprint's library name: "Resistor_SMD:R_0603" is R_0603. */
export function baseId(footprint: string, value: string): string {
  const item = footprint.split(":").pop() || value || "part"
  const id = item.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^[^A-Za-z]+/, "").replace(/[^A-Za-z0-9]+$/, "").slice(0, 50)
  return id === "" ? "part" : id
}

/** The value as an id suffix: "10k" stays, "4.7 µF" is 4.7__F. */
export const valueSuffix = (value: string): string => value.replace(/[^A-Za-z0-9._-]/g, "_").replace(/[^A-Za-z0-9]+$/, "").slice(0, 12)
