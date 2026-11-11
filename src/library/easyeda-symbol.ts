// The pins of an EasyEDA symbol document (the part's `dataStr`): number, name and what the symbol says the pin is.
// A pin record is "P~show~electric~spicePin~x~y~rotation~id~locked^^dot^^path^^name^^number…", where each "^^" part
// is itself "~"-separated and the name and number parts hold their text in the fifth field.
import type { PinType } from "../core/library.js"

export interface SymbolPin {
  number: string
  /** The name as EasyEDA writes it, e.g. "1IN-" or "CS#". */
  label: string
  /** EasyEDA's electric type: 0 undefined, 1 input, 2 output, 3 bidirectional, 4 power. */
  electric: number
}

/** EasyEDA's electric type for a power pin. */
const ELECTRIC_POWER = 4

export function symbolPins(shapes: readonly string[]): SymbolPin[] {
  const pins: SymbolPin[] = []
  for (const record of shapes) {
    if (!record.startsWith("P~")) continue
    const parts = record.split("^^")
    const head = (parts[0] ?? "").split("~")
    const text = (index: number) => (parts[index] ?? "").split("~")[4]?.trim()
    const number = text(4) || head[3]?.trim() || ""
    pins.push({ number, label: text(3) ?? "", electric: Number(head[2]) || 0 })
  }
  return pins
}

const GROUND = /^(?:[ADPS]?GND|VSS)\w*$/i
const POWER = /^(?:VCC|VDD|AVDD|DVDD|VBAT|VBUS|VPP|VIN|VIO)\w*$|^V\+$/i

/**
 * passive, unless the symbol says power: EasyEDA's power type, or a supply or ground name (most EasyEDA symbols
 * leave every pin undefined, so the name is often all the symbol says).
 */
export function pinType(pin: SymbolPin): PinType {
  if (GROUND.test(pin.label)) return "ground"
  if (pin.electric === ELECTRIC_POWER || POWER.test(pin.label)) return "power_in"
  return "passive"
}

/**
 * A pin name copperflow accepts (letters, digits and _, not starting with a digit) for an EasyEDA label: an active-low
 * mark (~CS, !CS, /CS, CS#, {CS} overbar) becomes a _N suffix, a trailing + or - becomes P or N (IN+ is INP), other
 * characters become _, a name that starts with a digit gets a leading _, and a name of digits only or none is pin<n>.
 */
export function pinName(label: string, number: string): string {
  let text = label.trim().replace(/[{}]/g, "")
  let activeLow = false
  if (/^[~!/]/.test(text)) {
    activeLow = true
    text = text.slice(1)
  }
  if (text.endsWith("#")) {
    activeLow = true
    text = text.slice(0, -1)
  }
  text = text.replace(/\+$/, "P").replace(/-$/, "N")
  text = text.replace(/[^A-Za-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
  if (text === "" || /^\d+$/.test(text)) return `pin${number}`
  if (activeLow) text = `${text}_N`
  return /^\d/.test(text) ? `_${text}` : text
}
