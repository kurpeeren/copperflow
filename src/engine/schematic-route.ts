// Orthogonal wires on the 0.1 sheet grid that go around symbols and other nets' wires.
// Hand-drawn wires are obstacles and never change. Each request is routed in the order given;
// its wire then becomes an obstacle for the next. A wire may start or end on a wire already
// joined to its pin, which makes a junction there, as EasyEDA's wire tool does. Pins that earlier
// wires already join (a loop, a repeated trace) get a wire of their own that may run along those
// wires, or none at all. When no way exists inside the search box, or the search runs past its
// cap, the wire is drawn with one elbow as before, and a warning says so.
import { diagnostic } from "./diagnostics.js"
import type { Diagnostic, Point, Side, SourceRef } from "./model.js"
import { findPath, SearchScratch } from "./schematic-astar.js"
import { cellsAround, fromCell, holds, overlaps, PASS, pointOnGrid, SheetGrid, SOURCE, SYMBOL, TARGET, toCell, wireMarks, type CellRect, type WireMarks } from "./schematic-grid.js"
import { Groups, rightAngle, samePoint, type PinSpot } from "./schematic-nets.js"
import type { Wire } from "./schematic.js"
import type { Bounds } from "./symbols/index.js"

/** Wires keep this far from symbol bounds, in sheet units. */
const SYMBOL_MARGIN = 0.1
/** The search box is the box around the two pins grown by this many cells (2.0 units). */
const SEARCH_REACH = 20
/** A pin's way out of its own symbol is at most this many cells long. */
const MAX_EXIT = 40
/** The exact search gives up after this many states; most wires need a few hundred. */
const EXACT_EXPANSIONS = 1_500
/** The weighted search that follows gives up after this many, so a wire costs a bounded amount of work however far its pins are apart. */
export const MAX_EXPANSIONS = 20_000
const STEP: Readonly<Record<Side, readonly [number, number]>> = { right: [1, 0], top: [0, 1], left: [-1, 0], bottom: [0, -1] }

/** A symbol on the sheet: its bounds in sheet coordinates and the pins it owns. */
export interface SheetBox {
  bounds: Bounds
  pins: readonly string[]
}

/** A wire already drawn by hand, and the pins it touches. */
export interface FixedWire {
  wire: Wire
  pins: readonly string[]
}

/** A wire to route between two pins. */
export interface RouteRequest {
  id: string
  net: string
  from: string
  to: string
  connection?: string
  source?: SourceRef
}

export interface Sheet {
  boxes: readonly SheetBox[]
  spots: ReadonlyMap<string, PinSpot>
}

export interface RouteOptions {
  maxExpansions?: number
}

/** A pin's way out: the points a wire to or from it may use inside margins (flat x, y pairs), and its landing point. */
interface Exit {
  open: number[]
  landing: readonly [number, number]
}

/** The SOURCE points of one search as box indices, and the TARGET points' extent in box cells. */
interface Ends {
  box: CellRect
  sources: number[]
  goal: CellRect
}

class Router {
  private readonly grid: SheetGrid
  private readonly exits = new Map<string, Exit>()
  /** The grid marks of every wire drawn so far, by hand or by this router. */
  private readonly drawn: WireMarks[] = []
  private readonly groups = new Groups()
  private readonly groupWires = new Map<string, number[]>()
  private readonly scratch = new SearchScratch()
  private readonly maxExpansions: number
  readonly diagnostics: Diagnostic[] = []

  constructor(
    private readonly sheet: Sheet,
    options: RouteOptions,
  ) {
    this.maxExpansions = options.maxExpansions ?? MAX_EXPANSIONS
    const rects = sheet.boxes.map((box) => cellsAround(box.bounds, SYMBOL_MARGIN))
    this.grid = new SheetGrid(extentOf(rects, sheet.spots))
    for (const rect of rects) this.grid.cover(rect)
    sheet.boxes.forEach((box, index) => {
      for (const pin of box.pins) {
        const spot = sheet.spots.get(pin)
        if (spot) this.exits.set(pin, exitOf(spot, rects[index], this.grid))
      }
    })
    for (const { landing } of this.exits.values()) this.grid.add(landing[0], landing[1], SYMBOL)
  }

  /** Records a drawn wire: an obstacle from now on, and part of its pins' group. */
  add(points: readonly Point[], pins: readonly string[]): void {
    const index = this.drawn.length
    const marks = wireMarks(points)
    this.drawn.push(marks)
    this.grid.apply(marks)
    const [first, ...rest] = pins
    if (first === undefined) return
    for (const pin of rest) this.join(first, pin)
    const root = this.groups.find(first)
    this.groupWires.set(root, [...(this.groupWires.get(root) ?? []), index])
  }

  private join(a: string, b: string): void {
    const [ra, rb] = [this.groups.find(a), this.groups.find(b)]
    if (!this.groups.join(a, b)) return
    const root = this.groups.find(a)
    const merged = [...(this.groupWires.get(ra) ?? []), ...(this.groupWires.get(rb) ?? [])]
    this.groupWires.delete(ra === root ? rb : ra)
    this.groupWires.set(root, merged)
  }

  /** Routes one request; undefined when its pins sit on the same spot, or are already joined and no wire of their own fits. */
  route(request: RouteRequest): Wire | undefined {
    const [a, b] = [this.sheet.spots.get(request.from), this.sheet.spots.get(request.to)]
    const joined = this.groups.find(request.from) === this.groups.find(request.to)
    if (!a || !b || samePoint(a.end, b.end)) {
      this.join(request.from, request.to)
      return undefined
    }
    const path = pointOnGrid(a.end) && pointOnGrid(b.end) ? this.search(request, a, b, joined) : undefined
    if (!path && joined) return undefined
    if (!path) this.warn(request)
    const points = path ?? rightAngle(a.end, b.end)
    this.add(points, [request.from, request.to])
    const wire: Wire = { id: request.id, net: request.net, points }
    return request.connection === undefined ? wire : { ...wire, connection: request.connection }
  }

  private warn(request: RouteRequest): void {
    const message = `wire from ${request.from} to ${request.to} could not avoid other things; drawn straight`
    this.diagnostics.push(diagnostic("auto-route", "warning", message, [request.from, request.to], request.source))
  }

  private search(request: RouteRequest, a: PinSpot, b: PinSpot, joined: boolean): Point[] | undefined {
    const box = clip(searchBox(a.end, b.end), this.grid.box)
    const ends: Ends = { box, sources: [], goal: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity } }
    this.openExits(request, joined)
    this.markEnd(ends, toCell(a.end.x), toCell(a.end.y), SOURCE)
    this.markEnd(ends, toCell(b.end.x), toCell(b.end.y), TARGET)
    if (joined) this.markGroup(ends, request.from, PASS)
    else {
      this.markGroup(ends, request.from, SOURCE)
      this.markGroup(ends, request.to, TARGET)
    }
    if (ends.goal.minX === Infinity) {
      this.grid.undo()
      return undefined
    }
    const window = { grid: this.grid, box, sources: ends.sources, goal: ends.goal }
    const exact = findPath({ ...window, maxExpansions: Math.min(EXACT_EXPANSIONS, this.maxExpansions), weighted: false }, this.scratch)
    const cells = exact ?? findPath({ ...window, maxExpansions: this.maxExpansions, weighted: true }, this.scratch)
    this.grid.undo()
    return cells && cells.length >= 2 ? corners(box, cells) : undefined
  }

  /** Opens the two routed pins' ways out until the search is over; joined pins may also run along them. */
  private openExits(request: RouteRequest, joined: boolean): void {
    for (const pin of [request.from, request.to]) {
      const open = this.exits.get(pin)?.open ?? []
      for (let i = 0; i < open.length; i += 2) this.grid.patch(open[i] as number, open[i + 1] as number, joined ? PASS : 0, SYMBOL)
    }
  }

  /** Marks one SOURCE, TARGET or PASS point inside the box, keeping the source list and the goal extent. */
  private markEnd(ends: Ends, x: number, y: number, flag: number): void {
    const index = this.grid.indexOf(x, y)
    if (index < 0 || !holds(ends.box, x, y) || ((this.grid.flags[index] as number) & flag) !== 0) return
    // Where the two groups' wires already cross, a path of one point would draw nothing: end beside it instead.
    if (flag === TARGET && ((this.grid.flags[index] as number) & SOURCE) !== 0) return
    this.grid.patch(x, y, flag)
    const [lx, ly] = [x - ends.box.minX, y - ends.box.minY]
    if (flag === SOURCE) ends.sources.push(ly * (ends.box.maxX - ends.box.minX + 1) + lx)
    if (flag !== TARGET) return
    ends.goal.minX = Math.min(ends.goal.minX, lx)
    ends.goal.maxX = Math.max(ends.goal.maxX, lx)
    ends.goal.minY = Math.min(ends.goal.minY, ly)
    ends.goal.maxY = Math.max(ends.goal.maxY, ly)
  }

  /** Marks the grid points of the wires joined to the pin, leaving out those inside a symbol's margin. */
  private markGroup(ends: Ends, pin: string, flag: number): void {
    for (const index of this.groupWires.get(this.groups.find(pin)) ?? []) {
      const { lattice, rect } = this.drawn[index] as WireMarks
      if (!overlaps(rect, ends.box)) continue
      for (let i = 0; i < lattice.length; i += 2) {
        const [x, y] = [lattice[i] as number, lattice[i + 1] as number]
        if (this.grid.marginsAt(x, y) === 0) this.markEnd(ends, x, y, flag)
      }
    }
  }
}

/** The sheet's cells: every symbol margin and pin, with room for every search box. */
function extentOf(rects: readonly CellRect[], spots: ReadonlyMap<string, PinSpot>): CellRect {
  const xs = [...rects.flatMap((r) => [r.minX, r.maxX]), ...[...spots.values()].map((s) => toCell(s.end.x))]
  const ys = [...rects.flatMap((r) => [r.minY, r.maxY]), ...[...spots.values()].map((s) => toCell(s.end.y))]
  if (xs.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  const reach = SEARCH_REACH + 1
  return { minX: Math.min(...xs) - reach, minY: Math.min(...ys) - reach, maxX: Math.max(...xs) + reach, maxY: Math.max(...ys) + reach }
}

/**
 * The pin's way out: its end and the points straight out from it while inside its own symbol's margin, each one
 * only when no other margin covers it, and the first point past them, which a wire may use only when no margin does.
 */
function exitOf(spot: PinSpot, rect: CellRect | undefined, grid: SheetGrid): Exit {
  const [dx, dy] = STEP[spot.side]
  const [x, y] = [toCell(spot.end.x), toCell(spot.end.y)]
  const open: number[] = []
  let k = 0
  for (; k <= MAX_EXIT && (k === 0 || (rect !== undefined && holds(rect, x + dx * k, y + dy * k))); k++) {
    if (grid.marginsAt(x + dx * k, y + dy * k) <= 1) open.push(x + dx * k, y + dy * k)
  }
  const landing = [x + dx * k, y + dy * k] as const
  if (grid.marginsAt(landing[0], landing[1]) === 0) open.push(landing[0], landing[1])
  return { open, landing }
}

function searchBox(a: Point, b: Point): CellRect {
  const [ax, ay, bx, by] = [toCell(a.x), toCell(a.y), toCell(b.x), toCell(b.y)]
  return {
    minX: Math.min(ax, bx) - SEARCH_REACH,
    minY: Math.min(ay, by) - SEARCH_REACH,
    maxX: Math.max(ax, bx) + SEARCH_REACH,
    maxY: Math.max(ay, by) + SEARCH_REACH,
  }
}

const clip = (rect: CellRect, within: CellRect): CellRect => ({
  minX: Math.max(rect.minX, within.minX),
  minY: Math.max(rect.minY, within.minY),
  maxX: Math.min(rect.maxX, within.maxX),
  maxY: Math.min(rect.maxY, within.maxY),
})

/** The path's ends and corners in sheet coordinates. */
function corners(box: CellRect, cells: readonly number[]): Point[] {
  const width = box.maxX - box.minX + 1
  const at = (index: number): Point => ({ x: fromCell(box.minX + (index % width)), y: fromCell(box.minY + Math.floor(index / width)) })
  const points = cells.map(at)
  return points.filter((p, i) => {
    const [before, after] = [points[i - 1], points[i + 1]]
    if (!before || !after) return true
    return !((before.x === p.x && p.x === after.x) || (before.y === p.y && p.y === after.y))
  })
}

/** Routes the requests in order around the sheet's symbols and the fixed wires; one entry per request. */
export function routeWires(
  sheet: Sheet,
  fixed: readonly FixedWire[],
  requests: readonly RouteRequest[],
  options: RouteOptions = {},
): { wires: (Wire | undefined)[]; diagnostics: Diagnostic[] } {
  const router = new Router(sheet, options)
  for (const { wire, pins } of fixed) router.add(wire.points, pins)
  const wires = requests.map((request) => router.route(request))
  return { wires, diagnostics: router.diagnostics }
}
