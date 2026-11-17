import { measureLines, viaThickness, type PairFigures } from "../engine/checks/fast-lines.js"
import type { Design } from "../engine/design.js"
import { microstrip, microstripPair } from "../engine/impedance.js"
import type { Net } from "../engine/model.js"
import { stackOf } from "../engine/rules/impedance-widths.js"
import type { NetClass } from "../engine/rules/schema.js"

const r1 = (n: number) => n.toFixed(1)
const num = (n: number) => String(Math.round(n * 1000) / 1000)
const label = (nets: readonly Net[], id: string) => nets.find((n) => n.id === id)?.names[0] ?? id.replace(/^net\./, "")

function pairLine(nets: readonly Net[], figures: PairFigures): string {
  const { pair, a, b } = figures
  const name = `Pair ${label(nets, pair.a)} and ${label(nets, pair.b)} (${pair.className})`
  if (!a || !b) return `${name}: not routed pad to pad yet`
  return `${name}: ${r1(a.length)} and ${r1(b.length)} mm, skew ${r1(Math.abs(a.length - b.length))} mm, side by side ${Math.round(figures.coupled * 100)} %, vias ${figures.vias[0]} and ${figures.vias[1]}`
}

function classLine(design: Design, netClass: NetClass): string | undefined {
  if (netClass.impedance === undefined && netClass.differentialImpedance === undefined) return undefined
  const stack = stackOf(design.rules.fabrication)
  const from = netClass.widthFrom ? ` (from ${netClass.widthFrom})` : ""
  if ("missing" in stack) return `Class ${netClass.name}: ${num(netClass.trackWidth)} mm width; no impedance: ${stack.missing}`
  const board = `on a ${num(stack.boardThickness)} mm board, er ${num(stack.permittivity)}`
  if (netClass.differentialImpedance !== undefined) {
    const gap = netClass.gap ?? netClass.clearance
    const z = microstripPair({ ...stack, width: netClass.trackWidth, gap }).impedance
    return `Class ${netClass.name}: ${num(netClass.trackWidth)} mm width at a ${num(gap)} mm gap${from} gives ${r1(z)} ohm differential ${board}`
  }
  const z = microstrip({ ...stack, width: netClass.trackWidth }).impedance
  return `Class ${netClass.name}: ${num(netClass.trackWidth)} mm width${from} gives ${r1(z)} ohm ${board}`
}

/** The short block of pairs, match groups and impedance classes; empty on a board without such classes. */
export function fastLineBlock(design: Design): string[] {
  const nets = design.circuit.nets
  const lines = measureLines(nets, design.pcb, design.rules, viaThickness(design.circuit.board?.thickness, design.rules))
  if (!lines) return []
  const groups = lines.groups.map((group) => {
    const each = group.nets.map((net) => {
      const found = lines.lengths.get(net)
      return `${label(nets, net)} ${found ? `${r1(found.length)} mm` : "not routed"}`
    })
    return `Match group ${group.name}: ${each.join(", ")}`
  })
  const classes = lines.classes.flatMap((netClass) => classLine(design, netClass) ?? [])
  return ["Fast lines (estimates; the router does not route pairs together or tune lengths):", ...lines.pairs.map((p) => pairLine(nets, p)), ...groups, ...classes]
}
