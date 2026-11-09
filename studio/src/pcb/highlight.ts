// Which net is under the pointer, for the H key: a pin end, label or wire on the schematic, a pad on the PCB.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Design } from "../../../src/engine/design.js"
import type { Net } from "../../../src/engine/model.js"
import type { PcbLayout } from "../../../src/engine/pcb.js"
import type { Selection } from "../selection.js"
import type { Point } from "./geometry.js"
import type { LayerVisibility } from "./layers.js"
import { nameList } from "./group-edits.js"
import { labelAt } from "./label-drag.js"
import { padAt } from "./pcb-draw.js"
import { wireAt } from "./wire-hit.js"
import { pinAt } from "./wire-tool.js"

/** The net of the wire nearest to `p` within `reach`. */
function wireNetAt(design: Design, p: Point, reach: number): string | undefined {
  const id = wireAt(design.schematic.wires, p, reach)
  return design.schematic.wires.find((wire) => wire.id === id)?.net
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

/** The highlighted nets, by id: one from the Net tab or the H key, every net of a part from Design → Highlight net. */
export type Highlight = readonly string[]

/** No net highlighted; one shared value, so clearing an empty highlight changes nothing. */
export const NO_HIGHLIGHT: Highlight = []

/**
 * What the schematic draws for the highlighted nets: their pins, and every raw id their wires and labels may carry.
 * `net` is the first of them; the drawing lights whatever is in `aliases`, which holds every id too.
 */
export function highlightOf(design: Design, ids: Highlight): { net: string; pins: readonly string[]; aliases: readonly string[] } | undefined {
  const nets = ids.flatMap((id) => design.circuit.nets.filter((candidate) => candidate.id === id))
  const first = nets[0]
  if (!first) return undefined
  const pins = [...new Set(nets.flatMap((net) => net.pins))]
  const aliases = [...new Set(nets.flatMap((net) => [net.id, ...net.names.map((name) => `net.${name}`)]))]
  return { net: first.id, pins, aliases }
}

/** The nets a part's pins are on, in pin order, each once; empty for a part that is on no net. */
export function partNets(design: Design, part: string): Highlight {
  const pins = design.circuit.components.find((component) => component.id === part)?.pins ?? []
  const nets = pins.flatMap((pin) => design.circuit.nets.filter((net) => net.pins.includes(pin.id)).map((net) => net.id))
  return [...new Set(nets)]
}

/** What Design → Highlight net does, where no pointer is over the canvas: light every net of the selected parts, or say how. */
export function menuHighlight(parts: readonly string[], netsOf: (part: string) => Highlight): { nets: Highlight } | { message: string } {
  if (parts.length === 0) return { message: "Point at a net and press H." }
  const nets = [...new Set(parts.flatMap(netsOf))]
  return nets.length > 0 ? { nets } : { message: `${nameList(parts)} ${parts.length === 1 ? "is" : "are"} on no net.` }
}

/**
 * What Design → Highlight net does with no pointer over the canvas: light the selected wires' nets and every net of
 * the selected parts (menuHighlight), each once, or say how.
 */
export function selectionHighlight(
  selection: Selection,
  wireNet: (id: string) => string | undefined,
  netsOf: (part: string) => Highlight,
): { nets: Highlight } | { message: string } {
  const ofWires = [...new Set(selection.wires.flatMap((id) => wireNet(id) ?? []))]
  const ofParts = menuHighlight(selection.names, netsOf)
  if ("nets" in ofParts) return { nets: [...new Set([...ofWires, ...ofParts.nets])] }
  return ofWires.length > 0 ? { nets: ofWires } : ofParts
}

/** One net after a rebuild: the same id when the net still exists, else the net that now holds its first pin, else none. */
function remapNet(id: string, before: Design | undefined, after: Design): string | undefined {
  if (after.circuit.nets.some((net) => net.id === id)) return id
  const pin = before?.circuit.nets.find((net) => net.id === id)?.pins[0]
  return (pin !== undefined && after.circuit.nets.find((net) => net.pins.includes(pin))?.id) || undefined
}

/**
 * The highlight after the design was rebuilt: each net follows its first pin (an unnamed net that was named, say)
 * or goes. An unchanged highlight is returned as it was, so the state does not change.
 */
export function remapHighlight(ids: Highlight, before: Design | undefined, after: Design): Highlight {
  const next = [...new Set(ids.flatMap((id) => remapNet(id, before, after) ?? []))]
  if (next.length === ids.length && next.every((id, i) => id === ids[i])) return ids
  return next.length === 0 ? NO_HIGHLIGHT : next
}

/** The id of the net of the pad at `p`, if the pad is on one. */
export function pcbNetAt(layout: PcbLayout, p: Point, visible?: LayerVisibility): string | undefined {
  return padAt(layout, p, visible)?.net ?? undefined
}
