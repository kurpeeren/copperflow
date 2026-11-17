import { diagnostic } from "../diagnostics.js"
import type { Diagnostic, Net } from "../model.js"
import type { NetClass, Rules } from "./schema.js"

/**
 * The name endings `pair: by-name` pairs, positive first, in the order tried: `_P`/`_N` (LVDS, PCIe and Ethernet
 * pairs such as TX_P/TX_N), `+`/`-` (USB D+/D-), `DP`/`DM` (USB on chip pins, USB_DP/USB_DM) and `H`/`L` (CANH/CANL).
 */
export const PAIR_ENDINGS: readonly (readonly [string, string])[] = [
  ["_P", "_N"],
  ["+", "-"],
  ["DP", "DM"],
  ["H", "L"],
]

export interface NetPair {
  className: string
  /** Net ids, the positive (first) one first. */
  a: string
  b: string
}

export interface MatchGroup {
  name: string
  className: string
  nets: string[]
}

/** The classes that know anything about fast lines; most boards have none, and then nothing here runs. */
export const hasFastClasses = (rules: Rules): boolean =>
  rules.classes.some(
    (c) => c.pair !== undefined || c.matchGroup !== undefined || c.maxLength !== undefined || c.impedance !== undefined || c.differentialImpedance !== undefined,
  )

const nameOf = (net: Net) => net.names[0] ?? net.id.replace(/^net\./, "")

function byNamePairs(netClass: NetClass, members: readonly Net[], diagnostics: Diagnostic[]): NetPair[] {
  const byName = new Map(members.flatMap((net) => net.names.map((name) => [name, net] as const)))
  const pairs: NetPair[] = []
  const used = new Set<string>()
  for (const net of members) {
    if (used.has(net.id)) continue
    const name = nameOf(net)
    const ending = PAIR_ENDINGS.find(([p, n]) => (name.endsWith(p) || name.endsWith(n)) && name.length > p.length)
    if (!ending) continue
    const [p, n] = ending
    const positive = name.endsWith(p)
    const stem = name.slice(0, name.length - (positive ? p : n).length)
    const partnerName = stem + (positive ? n : p)
    const partner = byName.get(partnerName)
    if (!partner || used.has(partner.id)) {
      if (!members.some((m) => used.has(m.id) && m.names.includes(partnerName))) {
        const message = `Net class ${netClass.name}: ${name} has no partner (${partnerName}) in the class, so it is not a pair`
        diagnostics.push(diagnostic("rules", "warning", message, [netClass.name]))
      }
      continue
    }
    used.add(net.id)
    used.add(partner.id)
    pairs.push(positive ? { className: netClass.name, a: net.id, b: partner.id } : { className: netClass.name, a: partner.id, b: net.id })
  }
  return pairs
}

function listedPairs(netClass: NetClass, listed: readonly [string, string][], nets: readonly Net[], diagnostics: Diagnostic[]): NetPair[] {
  const find = (name: string) => nets.find((net) => net.names.includes(name) || net.id === name)
  return listed.flatMap(([first, second]) => {
    const warn = (text: string) => diagnostics.push(diagnostic("rules", "warning", `Net class ${netClass.name}: the pair ${first} and ${second} ${text}`, [netClass.name]))
    const [a, b] = [find(first), find(second)]
    const missing = !a ? first : !b ? second : undefined
    if (missing !== undefined) {
      warn(`names ${missing}, which is no net of the circuit`)
      return []
    }
    if (a?.id === b?.id) {
      warn("names one net twice; a pair needs two nets")
      return []
    }
    return [{ className: netClass.name, a: (a as Net).id, b: (b as Net).id }]
  })
}

/** Every pair the classes declare, with a `rules` warning for each that cannot be one. */
export function classPairs(rules: Rules, nets: readonly Net[], byNet: ReadonlyMap<string, string>): { pairs: NetPair[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const pairs = rules.classes.flatMap((netClass) => {
    if (netClass.pair === undefined) return []
    if (netClass.pair !== "by-name") return listedPairs(netClass, netClass.pair, nets, diagnostics)
    const members = nets.filter((net) => byNet.get(net.id) === netClass.name)
    return byNamePairs(netClass, members, diagnostics)
  })
  return { pairs, diagnostics }
}

/** The match groups: the nets of every class naming the group, in net order. */
export function matchGroups(rules: Rules, nets: readonly Net[], byNet: ReadonlyMap<string, string>): MatchGroup[] {
  const groups = new Map<string, MatchGroup>()
  for (const netClass of rules.classes) {
    if (netClass.matchGroup === undefined) continue
    const group = groups.get(netClass.matchGroup) ?? { name: netClass.matchGroup, className: netClass.name, nets: [] }
    group.nets.push(...nets.filter((net) => byNet.get(net.id) === netClass.name).map((net) => net.id))
    groups.set(netClass.matchGroup, group)
  }
  return [...groups.values()]
}
