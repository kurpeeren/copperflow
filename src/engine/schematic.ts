import type { Circuit, Component, Connection, Diagnostic, Point, SchematicDrawing, Side } from "./model.js"
import { junctionsOf, labelName, labelStyle, layoutNets, type Drawn, type PinSpot } from "./schematic-nets.js"
import { routeWires, type FixedWire, type RouteRequest, type SheetBox } from "./schematic-route.js"
import { rotateSide, sheetBounds, sheetPoint, type Spot } from "./schematic-geometry.js"
import { placeLoose } from "./schematic-place.js"
import { symbolFor, type SchSymbol } from "./symbols/index.js"

export interface PlacedSymbol {
  component: string
  x: number
  y: number
  rotation: number
  autoPlaced: boolean
  symbol: SchSymbol
  /** Keyed by pin id, in sheet coordinates. */
  pinEnds: Record<string, Point>
}

export interface Wire {
  id: string
  net: string
  points: Point[]
  /** The Connection.id, when the wire came from a trace. */
  connection?: string
}

export interface NetLabel {
  id: string
  net: string
  text: string
  at: Point
  side: Side
  style: "label" | "ground" | "power"
}

export interface SchematicLayout {
  symbols: PlacedSymbol[]
  wires: Wire[]
  labels: NetLabel[]
  junctions: Point[]
  /** The circuit's drawings as they are, in an array of their own: already on the sheet, with the groups' offsets added. */
  drawings: SchematicDrawing[]
}

interface Origin extends Spot {
  autoPlaced: boolean
}

/** Placed symbols keep their spot; the rest are placed by connectivity (schematic-place.ts). */
function origins(circuit: Circuit, symbols: ReadonlyMap<string, SchSymbol>): Map<string, Origin> {
  const result = new Map<string, Origin>()
  for (const component of circuit.components) {
    if (component.sch) result.set(component.id, { ...component.sch, autoPlaced: false })
  }
  for (const [name, spot] of placeLoose(circuit, symbols)) result.set(name, { ...spot, autoPlaced: true })
  return result
}

function placeSymbols(circuit: Circuit): { symbols: PlacedSymbol[]; spots: Map<string, PinSpot> } {
  const drawn = new Map(circuit.components.map((component) => [component.id, symbolFor(component)]))
  const where = origins(circuit, drawn)
  const spots = new Map<string, PinSpot>()
  const symbols = circuit.components.flatMap((component): PlacedSymbol[] => {
    const symbol = drawn.get(component.id)
    const at = where.get(component.id)
    if (!symbol || !at) return []
    const pinEnds: Record<string, Point> = {}
    for (const pin of symbol.pins) {
      const id = component.pins.find((p) => p.number === pin.number)?.id
      if (id === undefined) continue
      const end = sheetPoint(pin.end, at)
      pinEnds[id] = end
      spots.set(id, { end, side: rotateSide(pin.side, at.rotation) })
    }
    return [{ component: component.id, ...at, symbol, pinEnds }]
  })
  return { symbols, spots }
}

function directionOf(from: Point | undefined, to: Point): Side {
  if (!from) return "right"
  if (to.x !== from.x) return to.x > from.x ? "right" : "left"
  return to.y < from.y ? "bottom" : "top"
}

function labelAtEnd(circuit: Circuit, connection: Connection, netEnd: string, points: readonly Point[]): NetLabel | undefined {
  const net = circuit.nets.find((candidate) => candidate.id === netEnd)
  const name = net ? labelName(net) : netEnd.replace(/^net\./, "")
  const at = points[points.length - 1]
  if (name === undefined || !at) return undefined
  return { id: `label:${connection.id}`, net: netEnd, text: name, at, side: directionOf(points[points.length - 2], at), style: labelStyle(name) }
}

const netIdOf = (circuit: Circuit, pin: string): string => circuit.nets.find((net) => net.pins.includes(pin))?.id ?? `net:${pin}`

interface HandDrawn {
  /** One per drawn connection, in source order: a hand-drawn wire, or a wire still to route. */
  slots: (Wire | RouteRequest)[]
  fixed: FixedWire[]
  labels: NetLabel[]
  joins: [string, string][]
  labeled: Set<string>
  spots: ReadonlyMap<string, PinSpot>
}

/** A wire between two pins: drawn through its corners, or routed later when it has none. */
function drawPinToPin(circuit: Circuit, connection: Connection, into: HandDrawn): void {
  const { id, from, to, source } = connection
  const [bends, net] = [connection.corners ?? [], netIdOf(circuit, from)]
  into.joins.push([from, to])
  if (bends.length === 0) {
    into.slots.push({ id: `wire:${id}`, net, from, to, connection: id, source })
    return
  }
  const [a, b] = [into.spots.get(from)?.end, into.spots.get(to)?.end]
  if (!a || !b) return
  const wire: Wire = { id: `wire:${id}`, net, points: [a, ...bends, b], connection: id }
  into.slots.push(wire)
  into.fixed.push({ wire, pins: [from, to] })
}

/** A wire from a pin through its corners to a named net stops at the last corner, where the label sits. */
function drawPinToNet(circuit: Circuit, connection: Connection, pinFirst: boolean, spot: PinSpot, into: HandDrawn): void {
  const [pin, netEnd] = pinFirst ? [connection.from, connection.to] : [connection.to, connection.from]
  const bends = connection.corners ?? []
  if (bends.length === 0 || !netEnd.startsWith("net.")) return
  const points = [spot.end, ...(pinFirst ? bends : [...bends].reverse())]
  const label = labelAtEnd(circuit, connection, netEnd, points)
  const wire: Wire = { id: `wire:${connection.id}`, net: netEnd, points, connection: connection.id }
  into.slots.push(wire)
  into.fixed.push({ wire, pins: [pin] })
  if (label) into.labels.push(label)
  into.labeled.add(pin)
}

function handDrawn(circuit: Circuit, spots: ReadonlyMap<string, PinSpot>): HandDrawn {
  const result: HandDrawn = { slots: [], fixed: [], labels: [], joins: [], labeled: new Set(), spots }
  for (const connection of circuit.connections) {
    const from = spots.get(connection.from)
    const to = spots.get(connection.to)
    if (from && to) drawPinToPin(circuit, connection, result)
    else if (from) drawPinToNet(circuit, connection, true, from, result)
    else if (to) drawPinToNet(circuit, connection, false, to, result)
  }
  return result
}

/** The symbols' bounds on the sheet and the pins each owns, for the router. */
function sheetBoxes(symbols: readonly PlacedSymbol[]): SheetBox[] {
  return symbols.map((placed) => ({ bounds: sheetBounds(placed.symbol.bounds, placed), pins: Object.keys(placed.pinEnds) }))
}

const isRequest = (slot: Wire | RouteRequest): slot is RouteRequest => !("points" in slot)

/**
 * Where every symbol, wire, label and junction of the schematic goes, and a warning for each wire that could not
 * avoid other things. Wires without corners are routed in source order, then the near pins of each named net.
 */
export function layoutSchematicWithDiagnostics(circuit: Circuit): { layout: SchematicLayout; diagnostics: Diagnostic[] } {
  const { symbols, spots } = placeSymbols(circuit)
  const hand = handDrawn(circuit, spots)
  const drawn: Drawn = { joins: hand.joins, labeled: hand.labeled }
  const nets = layoutNets(circuit, spots, drawn)
  const requests = [...hand.slots.filter(isRequest), ...nets.wires]
  const routed = routeWires({ boxes: sheetBoxes(symbols), spots }, hand.fixed, requests)
  const byRequest = new Map(requests.map((request, index) => [request, routed.wires[index]]))
  const wires = [...hand.slots, ...nets.wires].flatMap((slot) => {
    const wire = isRequest(slot) ? byRequest.get(slot) : slot
    return wire ? [wire] : []
  })
  const layout = { symbols, wires, labels: [...hand.labels, ...nets.labels], junctions: junctionsOf(wires, spots), drawings: [...circuit.drawings] }
  return { layout, diagnostics: routed.diagnostics }
}

/** Where every symbol, wire, label and junction of the schematic goes. */
export function layoutSchematic(circuit: Circuit): SchematicLayout {
  return layoutSchematicWithDiagnostics(circuit).layout
}
