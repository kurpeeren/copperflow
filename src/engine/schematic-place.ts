// Placement by connectivity for parts without schX/schY. Chips stand in one row by signal flow, two-pin
// passives hang beside the chip pin they serve, and the rest goes right of them, one chain of parts per row.
// Placed parts never move: they are obstacles. Every origin is on the 0.1 grid and no two symbols come closer than
// CLEARANCE; a symbol that would is pushed down, in the order placed. Deterministic: no randomness, and
// every list is in natural name order or derived from it.
import type { Circuit, Component, Point, Side } from "./model.js"
import { naturalCompare } from "./order.js"
import { sheetBounds, snap, snapDown, snapUp, tidy, turnedBounds, type Spot } from "./schematic-geometry.js"
import { chainsOf, isPair, type Link } from "./schematic-place-chains.js"
import { anchorPinsByNet, attachmentOf, flowOrder, netlistOf, type Attachment, type Hook } from "./schematic-place-plan.js"
import { drawnAsBox, type Bounds, type SchSymbol } from "./symbols/index.js"

/** The least room between any two symbols' bounds. */
const CLEARANCE = 0.2
/** The least room between two chips in the row. */
const ANCHOR_GAP = 1.0
/** Room between a chip's bounds and a passive that hangs from it. */
const BODY_GAP = 0.3
/** Room on each side of a passive that sits between two chips. */
const BETWEEN_ROOM = 0.4
/** Gap between the placed symbols and the leftovers placed right of them, as the column had. */
const COLUMN_GAP = 1.0
/** Room between the rows of leftovers, for the wires between them. */
const ROW_GAP = 0.6
/** Room between neighbours in a chain: their joined pins meet with a straight wire. */
const CHAIN_GAP = 1.0
/** A chain longer than this wraps onto the next row. */
const ROW_WIDTH = 50
const EPSILON = 1e-9

type Symbols = ReadonlyMap<string, SchSymbol>
type Corner = "left" | "right"
type Hanging = Extract<Attachment, { hook: Hook }>
type Between = Extract<Attachment, { kind: "between" }>

/** A symbol at a spot relative to its chip's origin. */
interface Local {
  part: string
  bounds: Bounds
  spot: Spot
}

const crowds = (a: Bounds, b: Bounds): boolean =>
  a.minX < b.maxX + CLEARANCE - EPSILON &&
  b.minX < a.maxX + CLEARANCE - EPSILON &&
  a.minY < b.maxY + CLEARANCE - EPSILON &&
  b.minY < a.maxY + CLEARANCE - EPSILON

/** What has been placed so far, fixed parts first. */
class Sheet {
  readonly boxes: Bounds[]
  readonly spots = new Map<string, Spot>()

  constructor(fixed: readonly Bounds[]) {
    this.boxes = [...fixed]
  }

  /** Puts the symbol at the spot, or lower: below each box it would crowd, until it crowds none. */
  put(part: string, bounds: Bounds, spot: Spot): Spot {
    const top = turnedBounds(bounds, spot.rotation).maxY
    let y = spot.y
    for (let hit = this.crowding(bounds, { ...spot, y }); hit; hit = this.crowding(bounds, { ...spot, y })) {
      y = snapDown(hit.minY - CLEARANCE - top)
    }
    const settled = { ...spot, y }
    this.boxes.push(sheetBounds(bounds, settled))
    this.spots.set(part, settled)
    return settled
  }

  right(): number | undefined {
    return this.boxes.length > 0 ? Math.max(...this.boxes.map((box) => box.maxX)) : undefined
  }

  private crowding(bounds: Bounds, spot: Spot): Bounds | undefined {
    const box = sheetBounds(bounds, spot)
    return this.boxes.find((other) => crowds(box, other))
  }
}

/** A chip: a box symbol with three or more pins. */
const isAnchor = (component: Component, symbol: SchSymbol | undefined): boolean => symbol !== undefined && symbol.pins.length >= 3 && drawnAsBox(component)

/** The end and side of a pin of a symbol at rotation 0. */
function pinOf(symbol: SchSymbol, number: number): { end: Point; side: Side } {
  const pin = symbol.pins.find((p) => p.number === number)
  return pin ? { end: pin.end, side: pin.side } : { end: { x: 0, y: 0 }, side: "left" }
}

/** A shunt hangs at the chip's corner on its pin's side; top and bottom pins use the nearer side. */
function cornerOf(side: Side, end: Point, chip: Bounds): Corner {
  if (side === "left" || side === "right") return side
  return end.x <= (chip.minX + chip.maxX) / 2 ? "left" : "right"
}

/** The x of a shunt: its pin column BODY_GAP out from the chip, or CLEARANCE beyond the one before it. */
function shuntX(corner: Corner, turned: Bounds, chip: Bounds, outer: number | undefined): number {
  if (corner === "left") return outer === undefined ? snap(chip.minX - BODY_GAP) : snapDown(outer - CLEARANCE - turned.maxX)
  return outer === undefined ? snap(chip.maxX + BODY_GAP) : snapUp(outer + CLEARANCE - turned.minX)
}

/** Ground shunts stand below the chip with the ground pin down; power shunts above it with the power pin up. */
function shuntSpot(kind: "ground" | "power", ownIsLeft: boolean, bounds: Bounds, chip: Bounds, x: (turned: Bounds) => number): Spot {
  const rotation = (kind === "ground") === ownIsLeft ? 270 : 90
  const turned = turnedBounds(bounds, rotation)
  const y = kind === "ground" ? snapDown(chip.minY - BODY_GAP - turned.maxY) : snapUp(chip.maxY + BODY_GAP - turned.minY)
  return { x: x(turned), y, rotation }
}

/** A series part sits in line with its pin, BODY_GAP out from the chip, the pin it shares facing the chip. */
function seriesSpot(side: Side, end: Point, ownIsLeft: boolean, bounds: Bounds, chip: Bounds): Spot {
  const rotations: Record<Side, number> = { left: ownIsLeft ? 180 : 0, right: ownIsLeft ? 0 : 180, top: ownIsLeft ? 90 : 270, bottom: ownIsLeft ? 270 : 90 }
  const rotation = rotations[side]
  const turned = turnedBounds(bounds, rotation)
  if (side === "left") return { x: snapDown(chip.minX - BODY_GAP - turned.maxX), y: end.y, rotation }
  if (side === "right") return { x: snapUp(chip.maxX + BODY_GAP - turned.minX), y: end.y, rotation }
  if (side === "top") return { x: end.x, y: snapUp(chip.maxY + BODY_GAP - turned.minY), rotation }
  return { x: end.x, y: snapDown(chip.minY - BODY_GAP - turned.maxY), rotation }
}

/** Where each passive hanging from one chip goes, relative to the chip's origin. */
function hangersOf(chip: SchSymbol, hanging: readonly Hanging[], symbols: Symbols): Local[] {
  const outer = new Map<string, number>()
  return hanging.flatMap((attachment): Local[] => {
    const symbol = symbols.get(attachment.part)
    if (!symbol) return []
    const { end, side } = pinOf(chip, attachment.hook.at.pin.number)
    const ownIsLeft = pinOf(symbol, attachment.hook.own.number).side === "left"
    if (attachment.kind === "series") return [{ part: attachment.part, bounds: symbol.bounds, spot: seriesSpot(side, end, ownIsLeft, symbol.bounds, chip.bounds) }]
    const corner = cornerOf(side, end, chip.bounds)
    const key = `${attachment.kind}:${corner}`
    const spot = shuntSpot(attachment.kind, ownIsLeft, symbol.bounds, chip.bounds, (turned) => shuntX(corner, turned, chip.bounds, outer.get(key)))
    const box = sheetBounds(symbol.bounds, spot)
    outer.set(key, corner === "left" ? box.minX : box.maxX)
    return [{ part: attachment.part, bounds: symbol.bounds, spot }]
  })
}

/** How far the hangers reach out of the chip's bounds on the left and on the right. */
function reachOf(chip: Bounds, hangers: readonly Local[]): { left: number; right: number } {
  const boxes = hangers.map((local) => sheetBounds(local.bounds, local.spot))
  return {
    left: Math.max(0, ...boxes.map((box) => chip.minX - box.minX)),
    right: Math.max(0, ...boxes.map((box) => box.maxX - chip.maxX)),
  }
}

interface Row {
  anchors: readonly Component[]
  hangers: readonly Local[][]
  /** The width the gap after each chip (by its index) needs for the parts between chips. */
  betweenNeed: ReadonlyMap<number, number>
}

/** The chips left to right, each gap wide enough for what hangs into it; then their passives. */
function placeRow(row: Row, symbols: Symbols, sheet: Sheet): void {
  const start = sheet.right()
  let previous: { maxX: number; right: number } | undefined
  for (const [index, anchor] of row.anchors.entries()) {
    const bounds = symbols.get(anchor.id)?.bounds
    if (!bounds) continue
    const reach = reachOf(bounds, row.hangers[index] ?? [])
    const gap = previous ? Math.max(ANCHOR_GAP, previous.right + CLEARANCE + reach.left, row.betweenNeed.get(index - 1) ?? 0) : 0
    const edge = previous ? previous.maxX + gap : (start === undefined ? 0 : start + COLUMN_GAP) + reach.left
    const spot = sheet.put(anchor.id, bounds, { x: snapUp(edge - bounds.minX), y: 0, rotation: 0 })
    previous = { maxX: spot.x + bounds.maxX, right: reach.right }
  }
  for (const [index, anchor] of row.anchors.entries()) {
    const origin = sheet.spots.get(anchor.id)
    if (!origin) continue
    for (const local of row.hangers[index] ?? []) {
      sheet.put(local.part, local.bounds, { x: tidy(origin.x + local.spot.x), y: tidy(origin.y + local.spot.y), rotation: local.spot.rotation })
    }
  }
}

/** A passive between two chips: in the middle of the gap after the left one, level with the left chip's pin. */
function placeBetween(between: Between, row: Row, symbols: Symbols, sheet: Sheet): void {
  const [left, next] = [row.anchors[between.left.at.index], row.anchors[between.left.at.index + 1]]
  const [symbol, leftSymbol, nextSymbol] = [symbols.get(between.part), left && symbols.get(left.id), next && symbols.get(next.id)]
  const [leftSpot, nextSpot] = [left && sheet.spots.get(left.id), next && sheet.spots.get(next.id)]
  if (!symbol || !leftSymbol || !nextSymbol || !leftSpot || !nextSpot) return
  const middle = (sheetBounds(leftSymbol.bounds, leftSpot).maxX + sheetBounds(nextSymbol.bounds, nextSpot).minX) / 2
  const pinY = tidy(leftSpot.y + pinOf(leftSymbol, between.left.at.pin.number).end.y)
  const rotation = pinOf(symbol, between.left.own.number).side === "left" ? 0 : 180
  sheet.put(between.part, symbol.bounds, { x: snap(middle), y: pinY, rotation })
}

/** One row of links level with each other, CHAIN_GAP apart, below `top` from `left` on; returns its lowest edge. */
function placeLinks(links: readonly Link[], left: number, top: number, symbols: Symbols, sheet: Sheet): number {
  const turned = links.flatMap((link) => {
    const bounds = symbols.get(link.part.id)?.bounds
    return bounds ? [{ link, bounds, box: turnedBounds(bounds, link.rotation) }] : []
  })
  if (turned.length === 0) return top
  const y = snapDown(top - Math.max(...turned.map((t) => t.box.maxY)))
  let [cursor, bottom] = [left, top]
  for (const { link, bounds, box } of turned) {
    const spot = sheet.put(link.part.id, bounds, { x: snapUp(cursor - box.minX), y, rotation: link.rotation })
    cursor = spot.x + box.maxX + CHAIN_GAP
    bottom = Math.min(bottom, spot.y + box.minY)
  }
  return bottom
}

/** A chain's links cut into rows no wider than ROW_WIDTH. */
function rowsOf(chain: readonly Link[], symbols: Symbols): Link[][] {
  const rows: Link[][] = []
  let width = Infinity
  for (const link of chain) {
    const bounds = symbols.get(link.part.id)?.bounds
    const wide = bounds ? bounds.maxX - bounds.minX + CHAIN_GAP : 0
    if (width + wide > ROW_WIDTH + EPSILON) {
      rows.push([])
      width = 0
    }
    rows[rows.length - 1]?.push(link)
    width += wide
  }
  return rows
}

/** What is left goes right of everything, one chain per row from the top down, as the column did before. */
function placeLeftovers(rest: readonly Component[], circuit: Circuit, symbols: Symbols, sheet: Sheet): void {
  const right = sheet.right()
  const left = right === undefined ? 0 : right + COLUMN_GAP
  let top = 0
  for (const chain of chainsOf(rest, circuit, symbols)) {
    for (const row of rowsOf(chain, symbols)) top = placeLinks(row, left, top, symbols, sheet) - ROW_GAP
  }
}

/** The width each gap after a chip needs for the passives that go between chips. */
function betweenNeeds(between: readonly Between[], symbols: Symbols): Map<number, number> {
  const needs = new Map<number, number>()
  for (const part of between) {
    const bounds = symbols.get(part.part)?.bounds
    if (!bounds) continue
    const need = snapUp(bounds.maxX - bounds.minX + 2 * BETWEEN_ROOM)
    needs.set(part.left.at.index, Math.max(needs.get(part.left.at.index) ?? 0, need))
  }
  return needs
}

/** The row: the chips in signal-flow order and every passive that hangs from one of them. */
function rowOf(loose: readonly Component[], circuit: Circuit, symbols: Symbols): { row: Row; between: Between[] } {
  const netlist = netlistOf(circuit)
  const chips = new Map(loose.filter((c) => isAnchor(c, symbols.get(c.id))).map((c) => [c.id, c]))
  const anchors = flowOrder([...chips.values()], netlist).flatMap((name) => chips.get(name) ?? [])
  const byNet = anchorPinsByNet(anchors, netlist)
  const attachments = loose.filter((c) => isPair(symbols.get(c.id))).flatMap((c) => attachmentOf(c, netlist, byNet) ?? [])
  const between = attachments.filter((a): a is Between => a.kind === "between")
  const hangers = anchors.map((anchor) => {
    const hanging = attachments.filter((a): a is Hanging => a.kind !== "between" && a.hook.at.anchor === anchor.id)
    const chip = symbols.get(anchor.id)
    return chip ? hangersOf(chip, hanging, symbols) : []
  })
  return { row: { anchors, hangers, betweenNeed: betweenNeeds(between, symbols) }, between }
}

/** Spots for the components without schX/schY, keyed by name. */
export function placeLoose(circuit: Circuit, symbols: Symbols): Map<string, Spot> {
  const fixed = circuit.components.flatMap((c) => {
    const symbol = symbols.get(c.id)
    return c.sch && symbol ? [sheetBounds(symbol.bounds, c.sch)] : []
  })
  const sheet = new Sheet(fixed)
  const loose = circuit.components.filter((c) => !c.sch && symbols.has(c.id)).sort((a, b) => naturalCompare(a.id, b.id))
  const { row, between } = rowOf(loose, circuit, symbols)
  placeRow(row, symbols, sheet)
  for (const part of between) placeBetween(part, row, symbols, sheet)
  placeLeftovers(loose.filter((c) => !sheet.spots.has(c.id)), circuit, symbols, sheet)
  return sheet.spots
}
