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

/** The via's drill and diameter in mm: the net class's, else the default class's. */
export const viaSize = (rules: Rules, net: Net): RouteNet["via"] => ({ ...classFor(rules, net).via })

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
