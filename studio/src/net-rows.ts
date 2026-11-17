// The rows of the Net tab: every net of the built design, named nets first.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Design } from "../../src/engine/design.js"
import type { Net } from "../../src/engine/model.js"

export type NetBadge = "ground" | "power"

export interface NetRow {
  /** The net's id in the design, which the highlight is keyed by. */
  id: string
  label: string
  pins: number
  named: boolean
  badge?: NetBadge
  /** For a net of a pair, length or impedance class: its length pad to pad, in mm, and for a pair the partner's label and the skew. */
  length?: number
  partner?: string
  skew?: number
}

// The engine's own rules for what a ground or power name is (src/engine/schematic-nets.ts). The
// tests hold the two lists together.
const GROUND = /^[ADPF]?GND\w*$|^VSS\w*$/i
const POWER = /^(VCC|VDD|VBUS|VIN|V\d|\+)/i

const collator = new Intl.Collator("en", { numeric: true })

function badgeOf(name: string): NetBadge | undefined {
  if (GROUND.test(name)) return "ground"
  return POWER.test(name) ? "power" : undefined
}

/** The badge of the name the engine draws for the net: the first ground or power name, else none. */
export function netBadge(names: readonly string[]): NetBadge | undefined {
  for (const name of names) {
    const badge = badgeOf(name)
    if (badge) return badge
  }
  return undefined
}

/** The name the engine draws for a net: a ground or power name when it has one, else the first. */
const nameOf = (names: readonly string[]): string | undefined => names.find((name) => badgeOf(name)) ?? names[0]

/** How the Net tab and Properties name a net: the name the engine draws, or its first pin when it has no name. */
export function netLabel(net: Net): string {
  return nameOf(net.names) ?? `(unnamed) ${net.pins[0] ?? net.id}`
}

/** "11.0 mm, pair P, skew 1.0 mm": what the nets list shows of a measured net. */
export function lengthText(row: NetRow): string {
  if (row.length === undefined) return ""
  const pair = row.partner === undefined ? "" : `, pair ${row.partner}${row.skew === undefined ? "" : `, skew ${row.skew.toFixed(1)} mm`}`
  return `${row.length.toFixed(1)} mm${pair}`
}

export function netRows(design: Design): NetRow[] {
  const lines = new Map((design.lines ?? []).map((line) => [line.net, line]))
  const byId = new Map(design.circuit.nets.map((net) => [net.id, net]))
  const rows = design.circuit.nets.map((net): NetRow => {
    const name = nameOf(net.names)
    const badge = netBadge(net.names)
    const line = lines.get(net.id)
    const partner = line?.partner === undefined ? undefined : byId.get(line.partner)
    return {
      id: net.id,
      label: netLabel(net),
      pins: net.pins.length,
      named: name !== undefined,
      ...(badge ? { badge } : {}),
      ...(line ? { length: line.length } : {}),
      ...(partner ? { partner: netLabel(partner) } : {}),
      ...(line?.skew === undefined ? {} : { skew: line.skew }),
    }
  })
  return rows.sort((a, b) => Number(b.named) - Number(a.named) || collator.compare(a.label, b.label))
}
