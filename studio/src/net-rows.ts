// The rows of the Nets tab: every net of the built design, named nets first.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Design } from "../../src/engine/design.js"

export type NetBadge = "ground" | "power"

export interface NetRow {
  /** The net's id in the design, which the highlight is keyed by. */
  id: string
  label: string
  pins: number
  named: boolean
  badge?: NetBadge
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

export function netRows(design: Design): NetRow[] {
  const rows = design.circuit.nets.map((net): NetRow => {
    const name = nameOf(net.names)
    const badge = netBadge(net.names)
    return {
      id: net.id,
      label: name ?? `(unnamed) ${net.pins[0] ?? net.id}`,
      pins: net.pins.length,
      named: name !== undefined,
      ...(badge ? { badge } : {}),
    }
  })
  return rows.sort((a, b) => Number(b.named) - Number(a.named) || collator.compare(a.label, b.label))
}
