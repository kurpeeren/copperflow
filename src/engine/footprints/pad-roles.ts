// What each pad of a generated package is, where its footprint module says so: the pins of connectors (dcjack,
// usb_b, usb_c16), the joined pairs of the tact switches, the anode and cathode of diodes and two-pad LEDs, and the
// plus of polarised capacitors. Taken from the modules' own documentation (dcjack.ts, usb.ts, tact.ts, sod.ts,
// melf.ts, molded.ts, axial.ts, ledsmd.ts, ledth.ts, tantalum.ts, smdcan.ts, radial.ts); a test checks every role
// names a pad the footprint has and every pad has a role.
import type { PackageEntry } from "./catalogue.js"
import { USB_C16_CONTACTS } from "./usb.js"

export type PadRoles = Readonly<Record<string, string>>

/** The Type-C contacts' signals, in USB_C16_CONTACTS order (usb.ts). */
const USB_C16_SIGNALS = ["GND", "VBUS", "SBU2", "CC1", "D−", "D+", "D−", "D+", "SBU1", "CC2", "VBUS", "GND"]

const DIODE: PadRoles = { "1": "anode", "2": "cathode" }
const POLARISED: PadRoles = { "1": "plus", "2": "minus" }
const TACT: PadRoles = { "1": "contact A (joined to 2)", "2": "contact A (joined to 1)", "3": "contact B (joined to 4)", "4": "contact B (joined to 3)" }

const BY_FOOTPRINT: Readonly<Record<string, PadRoles>> = {
  dcjack: { "1": "centre pin", "2": "sleeve", "3": "switch contact (opens when a plug goes in)" },
  usb_b: { "1": "VBUS", "2": "D−", "3": "D+", "4": "GND", "5": "shell" },
  usb_c16: {
    ...Object.fromEntries(USB_C16_CONTACTS.map((contact, i) => [String(i + 1), `${contact} ${USB_C16_SIGNALS[i]}`])),
    "13": "shell",
  },
  tact6x6: TACT,
  tact6x6_smd: TACT,
  led3528: DIODE,
  led3mm: DIODE,
  led5mm: DIODE,
}

const POLARISED_PREFIXES = ["tant_", "smdcan", "radial"]

/** The roles of a catalogue package's pads, or undefined when its module documents none. */
export function padRoles(entry: Pick<PackageEntry, "footprint" | "group">): PadRoles | undefined {
  const own = BY_FOOTPRINT[entry.footprint]
  if (own) return own
  if (entry.group === "Diodes") return DIODE
  if (entry.group === "Capacitors" && POLARISED_PREFIXES.some((prefix) => entry.footprint.startsWith(prefix))) return POLARISED
  return undefined
}
