// The circuit as its own pages draw it: each sub-sheet instance on the circuit is one sheet symbol with a pin per port,
// standing in for the parts inside it, which are drawn on the sheet's own page. The symbol is a component of kind
// "sheet" named by the instance, so it is placed, routed and picked like a part; a pin is "<instance>.<port>".
import type { Circuit, Component, Net, Point, SheetInstance, Side } from "./model.js"
import { rotateSide } from "./schematic-geometry.js"
import type { NetLabel, PlacedSymbol } from "./schematic.js"
import { sheetSymbol, sheetSymbolLayout } from "./sheet-symbol.js"
import type { SchSymbol } from "./symbols/index.js"

/** The pin id of a port on an instance's symbol. */
export const portPinId = (instance: string, port: string): string => `${instance}.${port}`

/** The symbol's stand-in component: one passive pin per port, numbered in port order. */
function symbolComponent(instance: SheetInstance): Component {
  const pins = instance.ports.map((port, index) => ({
    id: portPinId(instance.path, port.name),
    component: instance.path,
    number: index + 1,
    names: [port.name],
    type: "passive" as const,
  }))
  return {
    id: instance.path,
    kind: "sheet",
    value: instance.sheet,
    supplierPartNumbers: {},
    pins,
    pinSides: {},
    ...(instance.sch ? { sch: { x: instance.sch.x, y: instance.sch.y, rotation: instance.sch.rotation ?? 0 } } : {}),
    groupOffset: { pcb: { x: 0, y: 0 }, sch: { x: 0, y: 0 } },
    props: instance.schRotation === undefined ? {} : { schRotation: instance.schRotation },
    source: instance.source,
    ...(instance.page === undefined ? {} : { page: instance.page }),
  }
}

/** The nets as the parent page sees them: without the pins inside instances, with each net port's symbol pin. */
function parentNets(circuit: Circuit, inside: ReadonlySet<string>, top: readonly SheetInstance[]): Net[] {
  const nets = circuit.nets.map((net) => ({ ...net, pins: net.pins.filter((pin) => !inside.has(pin)) }))
  for (const instance of top) {
    for (const port of instance.ports) {
      if (port.bus) continue
      const pin = portPinId(instance.path, port.name)
      const net = nets.find((candidate) => candidate.names.includes(port.net))
      if (net) net.pins = [...net.pins, pin]
      else nets.push({ id: `net.${port.net}`, names: [port.net], pins: [pin] })
    }
  }
  return nets.filter((net) => net.pins.length > 0)
}

/**
 * The circuit with each instance on it drawn as its sheet symbol: the parts, traces and drawings inside instances
 * left out, a "sheet" component per outermost instance, and the symbols to draw them with. A circuit without
 * instances is itself.
 */
export function withSheetSymbols(circuit: Circuit): { circuit: Circuit; symbols: Map<string, SchSymbol> } {
  const top = (circuit.instances ?? []).filter((instance) => !instance.path.includes("/"))
  if (top.length === 0) return { circuit, symbols: new Map() }
  const innerParts = circuit.components.filter((component) => component.instance !== undefined)
  const inside = new Set(innerParts.flatMap((component) => component.pins.map((pin) => pin.id)))
  const stands = top.map(symbolComponent)
  const symbols = new Map(top.map((instance) => [instance.path, sheetSymbol(instance.name, instance.sheet, sheetSymbolLayout(instance.ports, instance.size))]))
  const drawn = {
    ...circuit,
    components: [...circuit.components.filter((component) => component.instance === undefined), ...stands],
    nets: parentNets(circuit, inside, top),
    connections: circuit.connections.filter((connection) => !inside.has(connection.from) && !inside.has(connection.to)),
    drawings: circuit.drawings.filter((drawing) => drawing.instance === undefined),
  }
  return { circuit: drawn, symbols }
}

/** Where the flags of ports that reach no pin and no bus stand: in a column this far left of the drawing. */
const LOOSE_FLAG_GAP = 1
const LOOSE_FLAG_PITCH = 0.4

/** A pin's end on the sheet and the side it faces, by pin id. */
function pinSpots(symbols: readonly PlacedSymbol[]): Map<string, { at: Point; side: Side }> {
  const spots = new Map<string, { at: Point; side: Side }>()
  for (const placed of symbols) {
    const numbers = new Map(placed.symbol.pins.map((pin) => [pin.number, pin.side]))
    for (const [id, at] of Object.entries(placed.pinEnds)) {
      const number = Number(id.slice(id.lastIndexOf(".pin") + 4))
      spots.set(id, { at, side: rotateSide(numbers.get(number) ?? "left", placed.rotation) })
    }
  }
  return spots
}

/**
 * On a sheet built alone, a flag for each `<port>`: at a pin of its net, a bus port at the start of its bus, and a port
 * that reaches neither in a column left of the drawing. A circuit that is not a sheet has none.
 */
export function portFlags(circuit: Circuit, layout: { symbols: readonly PlacedSymbol[]; labels: readonly NetLabel[] }): NetLabel[] {
  if (!circuit.sheet) return []
  const spots = pinSpots(layout.symbols)
  const ends = [...spots.values()].map((spot) => spot.at.x)
  const left = Math.min(0, ...ends) - LOOSE_FLAG_GAP
  let loose = 0
  return circuit.sheet.ports.map((port): NetLabel => {
    const net = circuit.nets.find((candidate) => candidate.names.includes(port.name))
    const pin = net?.pins.find((id) => spots.has(id))
    const bus = port.bus ? circuit.drawings.find((drawing) => drawing.kind === "bus" && drawing.name === port.name) : undefined
    const busStart = bus?.kind === "bus" ? bus.points[0] : undefined
    const spot = pin === undefined ? undefined : spots.get(pin)
    const at = spot?.at ?? busStart ?? { x: left, y: -LOOSE_FLAG_PITCH * loose++ }
    const flag = { id: `port:${port.name}`, net: net?.id ?? `net.${port.name}`, text: port.name, at, side: spot?.side ?? "left", style: "label" as const, port: true as const }
    return port.bus ? { ...flag, bus: true } : flag
  })
}
