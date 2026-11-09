// The width and via a track drawn by hand gets: the net's class from rules.yaml when one claims it, else the design
// rules' default class (src/engine/rules: classOfNet, DEFAULT_CLASS). Plain TypeScript with .js imports, so the tests
// can run it.
import type { Net } from "../../../src/engine/model.js"
import { classOfNet } from "../../../src/engine/rules/classes.js"
import { DEFAULT_CLASS } from "../../../src/engine/rules/profiles.js"
import type { NetClass, Rules } from "../../../src/engine/rules/schema.js"

/** The net a track is drawn on: its id, the name the layout file and the messages use, its width and its via. */
export interface RouteNet {
  id: string
  name: string
  width: number
  via: { drill: number; diameter: number }
}

/** What the rule reads of the design. */
export interface RuleSource {
  rules: Rules
  circuit: { nets: readonly Net[] }
}

const classFor = (rules: Rules, net: Net): NetClass => rules.classes.find((one) => one.name === classOfNet(rules, net)) ?? DEFAULT_CLASS

/** The width in mm: the net class's, else the default class's. */
export const trackWidth = (rules: Rules, net: Net): number => classFor(rules, net).trackWidth

/** Rounds to a thousandth of a micrometre, so 0.3 + 2 × 0.18 is 0.66, not 0.6599999999999999. */
const toNanometre = (mm: number): number => Math.round(mm * 1e6) / 1e6

/**
 * The via's drill and diameter in mm: the net class's, else the default class's; the diameter grows to the drill plus
 * the fabrication profile's minimum annular ring on both sides, so a via the tool places never fails the ring check.
 */
export function viaSize(rules: Rules, net: Net): RouteNet["via"] {
  return ringSafe(rules, classFor(rules, net).via)
}

/** The via placed on no net: the default class's, grown like viaSize. */
export const defaultVia = (rules: Rules): RouteNet["via"] => ringSafe(rules, DEFAULT_CLASS.via)

function ringSafe(rules: Rules, { drill, diameter }: RouteNet["via"]): RouteNet["via"] {
  return { drill, diameter: Math.max(diameter, toNanometre(drill + 2 * rules.fabrication.minAnnularRing)) }
}

/** The net's first name, else its id; "no net" for none. */
export function netName(design: Pick<RuleSource, "circuit">, id: string | undefined): string {
  if (id === undefined) return "no net"
  return design.circuit.nets.find((net) => net.id === id)?.names[0] ?? id
}

/** The net with id `id` as the track tool draws it; undefined when the circuit has no such net. */
export function routeNet(design: RuleSource, id: string): RouteNet | undefined {
  const net = design.circuit.nets.find((one) => one.id === id)
  if (!net) return undefined
  return { id, name: net.names[0] ?? id, width: trackWidth(design.rules, net), via: viaSize(design.rules, net) }
}
