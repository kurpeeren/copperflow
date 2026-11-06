// Which net is under the pointer, for the H key: a pin end, label or wire on the schematic, a pad on the PCB.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Design } from "../../../src/engine/design.js"
import type { Net } from "../../../src/engine/model.js"
import type { PcbLayout } from "../../../src/engine/pcb.js"
import type { Point } from "./geometry.js"
import { labelAt } from "./label-drag.js"
import { padAt } from "./pcb-draw.js"
import { pinAt } from "./wire-tool.js"

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy })
}

/** The net of the wire nearest to `p` within `reach`. */
function wireNetAt(design: Design, p: Point, reach: number): string | undefined {
  let best: { net: string; d: number } | undefined
  for (const wire of design.schematic.wires) {
    for (let i = 1; i < wire.points.length; i++) {
      const [a, b] = [wire.points[i - 1], wire.points[i]]
      if (!a || !b) continue
      const d = distanceToSegment(p, a, b)
      if (d <= reach && (!best || d < best.d)) best = { net: wire.net, d }
    }
  }
  return best?.net
}

/** The id of the net a pin end, net label or wire at `p` belongs to, in that order of preference; undefined for none, or for a pin on no net. */
export function schematicNetAt(design: Design, p: Point, reach: number): string | undefined {
  const pin = pinAt(design, p, reach)
  if (pin) return design.circuit.nets.find((net) => net.pins.includes(pin.pin))?.id
  const raw = labelAt(design, p)?.net ?? wireNetAt(design, p, reach)
  return raw === undefined ? undefined : canonicalNet(design.circuit.nets, raw)
}

/**
 * The id a net has in `circuit.nets`. Hand-drawn wires and labels carry the raw `net.<name>` they were
 * written with, which for a net with two names may be the second one, not the id (the first name).
 */
export function canonicalNet(nets: readonly Net[], raw: string): string {
  if (nets.some((net) => net.id === raw)) return raw
  const name = raw.startsWith("net.") ? raw.slice("net.".length) : undefined
  return nets.find((net) => name !== undefined && net.names.includes(name))?.id ?? raw
}

/** What the schematic draws for a highlighted net: its pins, and every raw id its wires and labels may carry. */
export function highlightOf(design: Design, id: string | null): { net: string; pins: readonly string[]; aliases: readonly string[] } | undefined {
  const net = id === null ? undefined : design.circuit.nets.find((candidate) => candidate.id === id)
  return net && { net: net.id, pins: net.pins, aliases: [...new Set([net.id, ...net.names.map((name) => `net.${name}`)])] }
}

/**
 * The highlight after the design was rebuilt: the same id when the net still exists, else the net that now
 * holds the old net's first pin (an unnamed net that was named, say), else none.
 */
export function remapHighlight(id: string | null, before: Design | undefined, after: Design): string | null {
  if (id === null || after.circuit.nets.some((net) => net.id === id)) return id
  const pin = before?.circuit.nets.find((net) => net.id === id)?.pins[0]
  return (pin !== undefined && after.circuit.nets.find((net) => net.pins.includes(pin))?.id) || null
}

/** The id of the net of the pad at `p`, if the pad is on one. */
export function pcbNetAt(layout: PcbLayout, p: Point): string | undefined {
  return padAt(layout, p)?.net ?? undefined
}
