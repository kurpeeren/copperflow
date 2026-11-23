// The shorts copper makes between nets, read from a build's short findings, and which of them only the router's
// unlocked copper makes. After a circuit's nets are rewritten, the router's tracks for the old nets can join pads of
// two new nets; check_circuit points such a short at remove_copper { nets }, which takes that copper back.
import type { Design } from "../engine/design.js"

export interface CopperShort {
  /** The ids of the nets the copper joins, e.g. ["net.A", "net.C"]. */
  nets: string[]
  /** The ids of the tracks and vias that join them. */
  copper: string[]
}

type Built = Pick<Design, "violations" | "circuit" | "pcb">

/** Every short between two or more nets that copper makes, with the nets and the copper. */
export function copperShorts(design: Built): CopperShort[] {
  const nets = new Set(design.circuit.nets.map((net) => net.id))
  const copper = new Set([...design.pcb.tracks, ...design.pcb.vias].map((one) => one.id))
  return design.violations
    .filter((violation) => violation.code === "short")
    .map((violation) => ({ nets: violation.items.filter((item) => nets.has(item)), copper: violation.items.filter((item) => copper.has(item)) }))
    .filter((short) => short.nets.length > 1 && short.copper.length > 0)
}

/** The shorts made only by copper the router laid and no one locked: remove_copper { nets } can take all of it back. */
export function routerShorts(design: Built): CopperShort[] {
  const router = new Set([...design.pcb.tracks, ...design.pcb.vias].filter((one) => one.by === "router" && !one.locked).map((one) => one.id))
  return copperShorts(design).filter((short) => short.copper.every((id) => router.has(id)))
}

/** A net id as remove_copper { nets } takes it: "net.A" is A; an unnamed net keeps its id. */
export const netArgument = (id: string): string => id.replace(/^net\./, "")
