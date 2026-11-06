import type { Circuit, Component, Connection, Point, Side } from "./model.js"
import { naturalCompare } from "./order.js"
import { junctionsOf, labelName, labelStyle, layoutNets, rightAngle, type Drawn, type PinSpot } from "./schematic-nets.js"
import { symbolFor, type Bounds, type SchSymbol } from "./symbols/index.js"
import { clean } from "./symbols/types.js"

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
}

/** Gap between the placed symbols and the column of auto-placed ones. */
const COLUMN_GAP = 1.0
/** Gap between stacked auto-placed symbols. */
const STACK_GAP = 0.4
const GRID = 0.1
/** Counter-clockwise order, so a quarter turn moves one step on. */
const SIDES: readonly Side[] = ["right", "top", "left", "bottom"]

/** Removes floating-point noise and negative zero so that coordinates compare exactly. */
const tidy = (value: number): number => clean(value) + 0

const turnsOf = (rotation: number): number => Math.round((((rotation % 360) + 360) % 360) / 90) % 4

/** Counter-clockwise quarter turns, y up. */
function rotatePoint(p: Point, rotation: number): Point {
  switch (turnsOf(rotation)) {
    case 1:
      return { x: tidy(-p.y), y: tidy(p.x) }
    case 2:
      return { x: tidy(-p.x), y: tidy(-p.y) }
    case 3:
      return { x: tidy(p.y), y: tidy(-p.x) }
    default:
      return { x: tidy(p.x), y: tidy(p.y) }
  }
}

function rotateSide(side: Side, rotation: number): Side {
  return SIDES[(SIDES.indexOf(side) + turnsOf(rotation)) % 4] ?? side
}

function sheetPoint(p: Point, at: { x: number; y: number; rotation: number }): Point {
  const turned = rotatePoint(p, at.rotation)
  return { x: tidy(at.x + turned.x), y: tidy(at.y + turned.y) }
}

/** The box around the rotated corners of the bounds, relative to the origin. */
function turnedBounds(bounds: Bounds, rotation: number): Bounds {
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ].map((corner) => rotatePoint(corner, rotation))
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

const snapDown = (value: number): number => tidy(Math.floor(value / GRID + 1e-9) * GRID)
const snapUp = (value: number): number => tidy(Math.ceil(value / GRID - 1e-9) * GRID)

interface Origin {
  x: number
  y: number
  rotation: number
  autoPlaced: boolean
}

/** Right edge of the placed symbols, or undefined when none is placed. */
function placedRight(components: readonly Component[], symbols: ReadonlyMap<string, SchSymbol>): number | undefined {
  const edges = components.flatMap((component) => {
    const symbol = symbols.get(component.id)
    return component.sch && symbol ? [component.sch.x + turnedBounds(symbol.bounds, component.sch.rotation).maxX] : []
  })
  return edges.length > 0 ? Math.max(...edges) : undefined
}

/** Placed symbols keep their spot; the rest stack downward in a column right of them. */
function origins(components: readonly Component[], symbols: ReadonlyMap<string, SchSymbol>): Map<string, Origin> {
  const result = new Map<string, Origin>()
  for (const component of components) {
    if (component.sch) result.set(component.id, { ...component.sch, autoPlaced: false })
  }
  const loose = components.filter((c) => !c.sch).sort((a, b) => naturalCompare(a.id, b.id))
  const right = placedRight(components, symbols)
  const reach = Math.max(0, ...loose.map((c) => -(symbols.get(c.id)?.bounds.minX ?? 0)))
  const x = right === undefined ? 0 : snapUp(right + COLUMN_GAP + reach)
  let cursor = 0
  for (const component of loose) {
    const bounds = symbols.get(component.id)?.bounds
    if (!bounds) continue
    const y = snapDown(cursor - bounds.maxY)
    result.set(component.id, { x, y, rotation: 0, autoPlaced: true })
    cursor = tidy(y + bounds.minY - STACK_GAP)
  }
  return result
}

function placeSymbols(circuit: Circuit): { symbols: PlacedSymbol[]; spots: Map<string, PinSpot> } {
  const drawn = new Map(circuit.components.map((component) => [component.id, symbolFor(component)]))
  const where = origins(circuit.components, drawn)
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
  wires: Wire[]
  labels: NetLabel[]
  joins: [string, string][]
  labeled: Set<string>
}

function drawPinToPin(circuit: Circuit, connection: Connection, from: PinSpot, to: PinSpot, into: HandDrawn): void {
  const bends = connection.corners ?? []
  const points = bends.length > 0 ? [from.end, ...bends, to.end] : rightAngle(from.end, to.end)
  if (points.length < 2) return
  into.wires.push({ id: `wire:${connection.id}`, net: netIdOf(circuit, connection.from), points, connection: connection.id })
  into.joins.push([connection.from, connection.to])
}

/** A wire from a pin through its corners to a named net stops at the last corner, where the label sits. */
function drawPinToNet(circuit: Circuit, connection: Connection, pinFirst: boolean, spot: PinSpot, into: HandDrawn): void {
  const [pin, netEnd] = pinFirst ? [connection.from, connection.to] : [connection.to, connection.from]
  const bends = connection.corners ?? []
  if (bends.length === 0 || !netEnd.startsWith("net.")) return
  const points = [spot.end, ...(pinFirst ? bends : [...bends].reverse())]
  const label = labelAtEnd(circuit, connection, netEnd, points)
  into.wires.push({ id: `wire:${connection.id}`, net: netEnd, points, connection: connection.id })
  if (label) into.labels.push(label)
  into.labeled.add(pin)
}

function handDrawn(circuit: Circuit, spots: ReadonlyMap<string, PinSpot>): HandDrawn {
  const result: HandDrawn = { wires: [], labels: [], joins: [], labeled: new Set() }
  for (const connection of circuit.connections) {
    const from = spots.get(connection.from)
    const to = spots.get(connection.to)
    if (from && to) drawPinToPin(circuit, connection, from, to, result)
    else if (from) drawPinToNet(circuit, connection, true, from, result)
    else if (to) drawPinToNet(circuit, connection, false, to, result)
  }
  return result
}

/** Where every symbol, wire, label and junction of the schematic goes. */
export function layoutSchematic(circuit: Circuit): SchematicLayout {
  const { symbols, spots } = placeSymbols(circuit)
  const hand = handDrawn(circuit, spots)
  const drawn: Drawn = { joins: hand.joins, labeled: hand.labeled }
  const nets = layoutNets(circuit, spots, drawn)
  const wires = [...hand.wires, ...nets.wires]
  return { symbols, wires, labels: [...hand.labels, ...nets.labels], junctions: junctionsOf(wires, spots) }
}
