// Placement by connectivity for parts without schX/schY. Chips stand in one row by signal flow; two-pin
// passives, and chains of them, hang beside the chip pin they serve; the rest goes right of them, one chain of
// parts per row. Placed parts never move: they are obstacles. Every origin is on the 0.1 grid and no two symbols
// come closer than CLEARANCE; a unit that would is pushed away from the chip it hangs from (down for the rest),
// in the order placed. Deterministic: no randomness, and every list is in natural name order or derived from it.
import type { Circuit, Component, Point, Side } from "./model.js"
import { naturalCompare } from "./order.js"
import { sheetBounds, snap, snapDown, snapUp, tidy, type Spot } from "./schematic-geometry.js"
import { chainEnds, chainsOf, isPair, reversed, type Link } from "./schematic-place-chains.js"
import { anchorPinsByNet, attachmentOf, flowOrder, netlistOf, type Attachment, type Hook, type Netlist, type AnchorPin } from "./schematic-place-plan.js"
import { anchorGroups, type AnchorGroup } from "./instance-anchor.js"
import { CLEARANCE, crowds, Sheet, unitOf, type Direction, type Symbols, type Unit } from "./schematic-place-units.js"
import { drawnAsBox, type Bounds, type SchSymbol } from "./symbols/index.js"

/** The least room between two chips in the row. */
const ANCHOR_GAP = 1.0
/** Room between a chip's bounds and a passive that hangs from it. */
const BODY_GAP = 0.3
/** Room on each side of a passive that sits between two chips. */
const BETWEEN_ROOM = 0.4
/** Room between the links of a chain that hangs from a chip: enough for a short straight wire. */
const HANG_GAP = 0.4
/** Room beside a box part that hangs at a chip's corner, for the wires of its sideways pins. */
const BOX_GAP = 0.5
/** Gap between the placed symbols and the leftovers placed right of them, as the column had. */
const COLUMN_GAP = 1.0
/** Room between the rows of leftovers, for the wires between them. */
const ROW_GAP = 0.6
/** Room between neighbours in a leftover chain: their joined pins meet with a straight wire. */
const CHAIN_GAP = 1.0
/** A chain longer than this wraps onto the next row. */
const ROW_WIDTH = 50

type Corner = "left" | "right"
type Hanging = Extract<Attachment, { hook: Hook }>
type Between = Extract<Attachment, { kind: "between" }>

/** A unit at an origin relative to its chip's origin, and the way it moves when it crowds something. */
interface Local {
  unit: Unit
  spot: Spot
  push: Direction
}

/** A chip: a box symbol with three or more pins. */
const isAnchor = (component: Component, symbol: SchSymbol | undefined): boolean => symbol !== undefined && symbol.pins.length >= 3 && drawnAsBox(component)

/** The end and side of a pin of a symbol at rotation 0. */
function pinOf(symbol: SchSymbol, number: number): { end: Point; side: Side } {
  const pin = symbol.pins.find((p) => p.number === number)
  return pin ? { end: pin.end, side: pin.side } : { end: { x: 0, y: 0 }, side: "left" }
}

/** The chain turned so that `own`, one of its end pins, is its left end. */
function oriented(chain: readonly Link[], own: string, symbols: Symbols): Link[] {
  const ends = chainEnds(chain, symbols)
  return ends?.[1]?.id === own && ends[0]?.id !== own ? reversed(chain) : [...chain]
}

/** A shunt hangs at the chip's corner on its pin's side; top and bottom pins use the nearer side. */
function cornerOf(side: Side, end: Point, chip: Bounds): Corner {
  if (side === "left" || side === "right") return side
  return end.x <= (chip.minX + chip.maxX) / 2 ? "left" : "right"
}

/** The x of a shunt: its pin column BODY_GAP out from the chip, or `gap` beyond the one before it. */
function shuntX(corner: Corner, box: Bounds, chip: Bounds, outer: number | undefined, gap: number): number {
  if (corner === "left") return outer === undefined ? snap(chip.minX - BODY_GAP) : snapDown(outer - gap - box.maxX)
  return outer === undefined ? snap(chip.maxX + BODY_GAP) : snapUp(outer + gap - box.minX)
}

/** A box part's pins point sideways, at its neighbour in the corner, so it keeps room for their wires. */
const sideGap = (unit: Unit, symbols: Symbols): number => (unit.pieces.every((piece) => isPair(symbols.get(piece.part))) ? CLEARANCE : BOX_GAP)

const SERIES_WAY: Readonly<Record<Side, Direction>> = { left: "left", right: "right", top: "up", bottom: "down" }

/** A series unit sits in line with its pin, BODY_GAP out from the chip. */
function seriesSpot(side: Side, end: Point, box: Bounds, chip: Bounds): Spot {
  if (side === "left") return { x: snapDown(chip.minX - BODY_GAP - box.maxX), y: end.y, rotation: 0 }
  if (side === "right") return { x: snapUp(chip.maxX + BODY_GAP - box.minX), y: end.y, rotation: 0 }
  if (side === "top") return { x: end.x, y: snapUp(chip.maxY + BODY_GAP - box.minY), rotation: 0 }
  return { x: end.x, y: snapDown(chip.minY - BODY_GAP - box.maxY), rotation: 0 }
}

/** Where one attachment goes relative to its chip; `outer` keeps the outer edge reached at each corner. */
function hangerOf(chip: SchSymbol, attachment: Hanging, links: readonly Link[], outer: Map<string, number>, symbols: Symbols): Local {
  const { end, side } = pinOf(chip, attachment.hook.at.pin.number)
  const chain = oriented(links, attachment.hook.own.id, symbols)
  if (attachment.kind === "series") {
    const unit = unitOf(chain, SERIES_WAY[side], HANG_GAP, symbols)
    return { unit, spot: seriesSpot(side, end, unit.box, chip.bounds), push: SERIES_WAY[side] }
  }
  const way: Direction = attachment.kind === "ground" ? "down" : "up"
  const unit = unitOf(chain, way, HANG_GAP, symbols)
  const corner = cornerOf(side, end, chip.bounds)
  const key = `${attachment.kind}:${corner}`
  const y = way === "down" ? snapDown(chip.bounds.minY - BODY_GAP - unit.box.maxY) : snapUp(chip.bounds.maxY + BODY_GAP - unit.box.minY)
  const spot = { x: shuntX(corner, unit.box, chip.bounds, outer.get(key), sideGap(unit, symbols)), y, rotation: 0 }
  outer.set(key, corner === "left" ? spot.x + unit.box.minX : spot.x + unit.box.maxX)
  return { unit, spot, push: way }
}

/** How far the hangers reach out of the chip's bounds on the left and on the right. */
function reachOf(chip: Bounds, hangers: readonly Local[]): { left: number; right: number } {
  return {
    left: Math.max(0, ...hangers.map((h) => chip.minX - (h.spot.x + h.unit.box.minX))),
    right: Math.max(0, ...hangers.map((h) => h.spot.x + h.unit.box.maxX - chip.maxX)),
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
    const symbol = symbols.get(anchor.id)
    if (!symbol) continue
    const reach = reachOf(symbol.bounds, row.hangers[index] ?? [])
    const gap = previous ? Math.max(ANCHOR_GAP, previous.right + CLEARANCE + reach.left, row.betweenNeed.get(index - 1) ?? 0) : 0
    const edge = previous ? previous.maxX + gap : (start === undefined ? 0 : start + COLUMN_GAP) + reach.left
    const unit = unitOf([{ part: anchor, rotation: 0 }], "right", 0, symbols)
    const spot = sheet.put(unit, { x: snapUp(edge - symbol.bounds.minX), y: 0, rotation: 0 })
    previous = { maxX: spot.x + symbol.bounds.maxX, right: reach.right }
  }
  for (const [index, anchor] of row.anchors.entries()) {
    const origin = sheet.spots.get(anchor.id)
    if (!origin) continue
    for (const local of row.hangers[index] ?? []) {
      sheet.put(local.unit, { x: tidy(origin.x + local.spot.x), y: tidy(origin.y + local.spot.y), rotation: 0 }, local.push)
    }
  }
}

/** A unit between two chips: in the middle of the gap after the left one, level with the left chip's pin. */
function placeBetween(between: Between, links: readonly Link[], row: Row, symbols: Symbols, sheet: Sheet): void {
  const [left, next] = [row.anchors[between.left.at.index], row.anchors[between.left.at.index + 1]]
  const [leftSymbol, nextSymbol] = [left && symbols.get(left.id), next && symbols.get(next.id)]
  const [leftSpot, nextSpot] = [left && sheet.spots.get(left.id), next && sheet.spots.get(next.id)]
  if (!leftSymbol || !nextSymbol || !leftSpot || !nextSpot) return
  const unit = unitOf(oriented(links, between.left.own.id, symbols), "right", HANG_GAP, symbols)
  const middle = (sheetBounds(leftSymbol.bounds, leftSpot).maxX + sheetBounds(nextSymbol.bounds, nextSpot).minX) / 2
  const pinY = tidy(leftSpot.y + pinOf(leftSymbol, between.left.at.pin.number).end.y)
  sheet.put(unit, { x: snap(middle - (unit.box.minX + unit.box.maxX) / 2), y: pinY, rotation: 0 })
}

/** A chain's links cut into rows no wider than ROW_WIDTH. */
function rowsOf(chain: readonly Link[], symbols: Symbols): Link[][] {
  const rows: Link[][] = []
  let width = Infinity
  for (const link of chain) {
    const bounds = symbols.get(link.part.id)?.bounds
    const wide = bounds ? bounds.maxX - bounds.minX + CHAIN_GAP : 0
    if (width + wide > ROW_WIDTH + 1e-9) {
      rows.push([])
      width = 0
    }
    rows[rows.length - 1]?.push(link)
    width += wide
  }
  return rows
}

/** What is left goes right of everything, one chain per row from the top down, as the column did before. */
function placeLeftovers(chains: readonly Link[][], symbols: Symbols, sheet: Sheet): void {
  const right = sheet.right()
  const left = right === undefined ? 0 : right + COLUMN_GAP
  let top = 0
  for (const chain of chains) {
    for (const row of rowsOf(chain, symbols)) {
      const unit = unitOf(row, "right", CHAIN_GAP, symbols)
      if (unit.pieces.length === 0) continue
      const spot = sheet.put(unit, { x: snapUp(left - unit.box.minX), y: snapDown(top - unit.box.maxY), rotation: 0 })
      top = spot.y + unit.box.minY - ROW_GAP
    }
  }
}

/** The width each gap after a chip needs for the units that go between chips. */
function betweenNeeds(between: readonly Between[], strands: ReadonlyMap<string, Link[]>, symbols: Symbols): Map<number, number> {
  const needs = new Map<number, number>()
  for (const part of between) {
    const box = unitOf(strands.get(part.part) ?? [], "right", HANG_GAP, symbols).box
    const need = snapUp(box.maxX - box.minX + 2 * BETWEEN_ROOM)
    needs.set(part.left.at.index, Math.max(needs.get(part.left.at.index) ?? 0, need))
  }
  return needs
}

/** What hangs from the chips, keyed by its first part, and the chains that hang from nothing. */
interface Hung {
  attachments: Attachment[]
  strands: Map<string, Link[]>
  leftovers: Link[][]
}

/**
 * Shunts and passives between two chips first, by their own rule; then the rest as chains (a part in line with one
 * chip pin may go on as a chain), by the rule from the chain's end nets with the in-line fallback. Only chains that share no net with a chip pin are left over.
 */
function hang(loose: readonly Component[], chips: ReadonlySet<string>, circuit: Circuit, symbols: Symbols, netlist: Netlist, byNet: ReadonlyMap<string, AnchorPin[]>): Hung {
  const hung: Hung = { attachments: [], strands: new Map(), leftovers: [] }
  for (const part of loose) {
    if (chips.has(part.id) || !isPair(symbols.get(part.id))) continue
    const attachment = attachmentOf(part.id, [...part.pins].sort((a, b) => a.number - b.number), netlist, byNet)
    if (!attachment || attachment.kind === "series") continue
    hung.attachments.push(attachment)
    hung.strands.set(part.id, [{ part, rotation: 0 }])
  }
  const rest = loose.filter((part) => !chips.has(part.id) && !hung.strands.has(part.id))
  for (const chain of chainsOf(rest, circuit, symbols)) {
    const ends = chainEnds(chain, symbols)
    const key = chain[0]?.part.id
    const attachment = ends && key !== undefined ? attachmentOf(key, ends, netlist, byNet, true) : undefined
    if (!attachment || key === undefined) hung.leftovers.push(chain)
    else {
      hung.attachments.push(attachment)
      hung.strands.set(key, chain)
    }
  }
  return hung
}

/** The row: the chips in signal-flow order and everything that hangs from them. */
function rowOf(loose: readonly Component[], circuit: Circuit, symbols: Symbols): { row: Row; between: Between[]; hung: Hung } {
  const netlist = netlistOf(circuit)
  const chips = new Map(loose.filter((c) => isAnchor(c, symbols.get(c.id))).map((c) => [c.id, c]))
  const anchors = flowOrder([...chips.values()], netlist).flatMap((name) => chips.get(name) ?? [])
  const hung = hang(loose, new Set(chips.keys()), circuit, symbols, netlist, anchorPinsByNet(anchors, netlist))
  const between = hung.attachments.filter((a): a is Between => a.kind === "between")
  const hangers = anchors.map((anchor) => {
    const chip = symbols.get(anchor.id)
    const outer = new Map<string, number>()
    const hanging = hung.attachments.filter((a): a is Hanging => a.kind !== "between" && a.hook.at.anchor === anchor.id)
    return chip ? hanging.map((a) => hangerOf(chip, a, hung.strands.get(a.part) ?? [], outer, symbols)) : []
  })
  return { row: { anchors, hangers, betweenNeed: betweenNeeds(between, hung.strands, symbols) }, between, hung }
}

/** Places `loose` by connectivity on `sheet`. */
function placeParts(loose: readonly Component[], circuit: Circuit, symbols: Symbols, sheet: Sheet): void {
  const { row, between, hung } = rowOf(loose, circuit, symbols)
  placeRow(row, symbols, sheet)
  for (const part of between) placeBetween(part, hung.strands.get(part.part) ?? [], row, symbols, sheet)
  placeLeftovers(hung.leftovers, symbols, sheet)
}

/**
 * An instance's loose parts, placed by connectivity on a sheet of their own, then moved as one block: to the
 * instance's own spot, or right of everything when it has none, and on to the right past anything it would crowd.
 */
function placeBlock(group: AnchorGroup, circuit: Circuit, symbols: Symbols, sheet: Sheet): void {
  const own = new Sheet([])
  placeParts(group.parts, circuit, symbols, own)
  if (own.boxes.length === 0) return
  const block = unionOf(own.boxes)
  const right = sheet.right()
  let dx = group.anchor ? snap(group.anchor.x) : snapUp((right === undefined ? 0 : right + COLUMN_GAP) - block.minX)
  const dy = group.anchor ? snap(group.anchor.y) : 0
  for (let hit = crowding(block, dx, dy, sheet); hit; hit = crowding(block, dx, dy, sheet)) dx = snapUp(hit.maxX + CLEARANCE - block.minX)
  for (const [part, spot] of own.spots) {
    const moved = { x: tidy(spot.x + dx), y: tidy(spot.y + dy), rotation: spot.rotation }
    const symbol = symbols.get(part)
    sheet.spots.set(part, moved)
    if (symbol) sheet.boxes.push(sheetBounds(symbol.bounds, moved))
  }
}

function unionOf(boxes: readonly Bounds[]): Bounds {
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  }
}

/** A box on the sheet that the block, moved by dx and dy, would crowd. */
function crowding(block: Bounds, dx: number, dy: number, sheet: Sheet): Bounds | undefined {
  const moved = { minX: block.minX + dx, maxX: block.maxX + dx, minY: block.minY + dy, maxY: block.maxY + dy }
  return sheet.boxes.find((box) => crowds(moved, box))
}

/** Spots for the components without schX/schY, keyed by name. Each sub-sheet instance's parts are placed as one block. */
export function placeLoose(circuit: Circuit, symbols: Symbols): Map<string, Spot> {
  const fixed = circuit.components.flatMap((c) => {
    const symbol = symbols.get(c.id)
    return c.sch && symbol ? [sheetBounds(symbol.bounds, c.sch)] : []
  })
  const sheet = new Sheet(fixed)
  const loose = circuit.components.filter((c) => !c.sch && symbols.has(c.id)).sort((a, b) => naturalCompare(a.id, b.id))
  for (const group of anchorGroups(circuit, loose, "sch")) {
    if (group.key === "") placeParts(group.parts, circuit, symbols, sheet)
    else placeBlock(group, circuit, symbols, sheet)
  }
  return sheet.spots
}
