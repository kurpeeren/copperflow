// Orthogonal wires on the 0.1 sheet grid that go around symbols and other nets' wires.
// Hand-drawn wires are obstacles and never change. Each request is routed in the order given;
// its wire then becomes an obstacle for the next. A wire may start or end on a wire already
// joined to its pin, which makes a junction there, as EasyEDA's wire tool does. When no way
// exists inside the search box, the wire is drawn with one elbow as before, and a warning says so.
import { diagnostic } from "./diagnostics.js"
import type { Diagnostic, Point, Side, SourceRef } from "./model.js"
import { findPath, SearchScratch } from "./schematic-astar.js"
import { BLOCK, cellsAround, fromCell, holds, LocalGrid, overlaps, pointOnGrid, SOURCE, TARGET, toCell, wireMarks, type CellRect, type WireMarks } from "./schematic-grid.js"
import { Groups, rightAngle, samePoint, type PinSpot } from "./schematic-nets.js"
import type { Wire } from "./schematic.js"
import type { Bounds } from "./symbols/index.js"

/** Wires keep this far from symbol bounds, in sheet units. */
const SYMBOL_MARGIN = 0.1
/** The search box is the box around the two pins grown by this many cells (2.0 units). */
const SEARCH_REACH = 20
/** A pin's way out of its own symbol is at most this many cells long. */
const MAX_EXIT = 40
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

class Router {
  private readonly rects: CellRect[]
  /** Each pin's way out: its end, the points straight out through its symbol's margin, and one landing point beyond, as flat x, y pairs. */
  private readonly exits = new Map<string, number[]>()
  /** Every pin's landing point, as flat x, y pairs. */
  private readonly landings: Int32Array
  /** The grid marks of every wire drawn so far, by hand or by this router. */
  private readonly drawn: WireMarks[] = []
  private readonly groups = new Groups()
  private readonly groupWires = new Map<string, number[]>()
  private readonly scratch = new SearchScratch()
  readonly diagnostics: Diagnostic[] = []

  constructor(private readonly sheet: Sheet) {
    this.rects = sheet.boxes.map((box) => cellsAround(box.bounds, SYMBOL_MARGIN))
    sheet.boxes.forEach((box, index) => {
      for (const pin of box.pins) {
        const spot = sheet.spots.get(pin)
        if (spot) this.exits.set(pin, exitOf(spot, this.rects[index]))
      }
    })
    this.landings = Int32Array.from([...this.exits.values()].flatMap((exit) => exit.slice(-2)))
  }

  /** Records a drawn wire: an obstacle from now on, and part of its pins' group. */
  add(points: readonly Point[], pins: readonly string[]): void {
    const index = this.drawn.length
    this.drawn.push(wireMarks(points))
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

  /**
   * Routes one request; undefined when its pins sit on the same spot. Pins that the wires drawn so far already join
   * keep today's elbow and no warning: the trace still has a wire of its own, and nothing is left to connect.
   */
  route(request: RouteRequest): Wire | undefined {
    const [a, b] = [this.sheet.spots.get(request.from), this.sheet.spots.get(request.to)]
    if (!a || !b || samePoint(a.end, b.end)) {
      this.join(request.from, request.to)
      return undefined
    }
    const joined = this.groups.find(request.from) === this.groups.find(request.to)
    const routable = !joined && pointOnGrid(a.end) && pointOnGrid(b.end)
    const path = routable ? this.search(request, a, b) : undefined
    if (!path && !joined) this.warn(request)
    const points = path ?? rightAngle(a.end, b.end)
    this.add(points, [request.from, request.to])
    const wire: Wire = { id: request.id, net: request.net, points }
    return request.connection === undefined ? wire : { ...wire, connection: request.connection }
  }

  private warn(request: RouteRequest): void {
    const message = `wire from ${request.from} to ${request.to} could not avoid other things; drawn straight`
    this.diagnostics.push(diagnostic("auto-route", "warning", message, [request.from, request.to], request.source))
  }

  private search(request: RouteRequest, a: PinSpot, b: PinSpot): Point[] | undefined {
    const box = searchBox(a.end, b.end)
    const grid = new LocalGrid(box, this.scratch.reserve((box.maxX - box.minX + 1) * (box.maxY - box.minY + 1)))
    for (const rect of this.rects) grid.fill(rect, BLOCK)
    this.reserveExits(grid, request)
    for (const marks of this.drawn) grid.apply(marks)
    this.markEnds(grid, request.from, a, SOURCE)
    this.markEnds(grid, request.to, b, TARGET)
    const cells = findPath(grid, this.scratch)
    return cells && cells.length >= 2 ? corners(grid, cells) : undefined
  }

  /** Blocks every pin's landing point, so no other wire turns or runs in front of a pin; then opens the two routed pins' ways out. */
  private reserveExits(grid: LocalGrid, request: RouteRequest): void {
    const { landings } = this
    for (let i = 0; i < landings.length; i += 2) grid.add(landings[i] as number, landings[i + 1] as number, BLOCK)
    for (const pin of [request.from, request.to]) {
      const exit = this.exits.get(pin) ?? []
      for (let i = 0; i < exit.length; i += 2) grid.remove(exit[i] as number, exit[i + 1] as number, BLOCK)
    }
  }

  /** Marks the pin's end and the grid points of every wire already joined to the pin. */
  private markEnds(grid: LocalGrid, pin: string, spot: PinSpot, flag: typeof SOURCE | typeof TARGET): void {
    grid.addEnd(toCell(spot.end.x), toCell(spot.end.y), flag)
    for (const index of this.groupWires.get(this.groups.find(pin)) ?? []) {
      const { lattice, rect } = this.drawn[index] as WireMarks
      if (!overlaps(rect, grid.box)) continue
      for (let i = 0; i < lattice.length; i += 2) grid.addEnd(lattice[i] as number, lattice[i + 1] as number, flag)
    }
  }
}

/** The pin's end, the points straight out from it while inside its symbol's blocked cells, and the first point past them. */
function exitOf(spot: PinSpot, rect: CellRect | undefined): number[] {
  const [dx, dy] = STEP[spot.side]
  const [x, y] = [toCell(spot.end.x), toCell(spot.end.y)]
  const cells = [x, y]
  let k = 1
  for (; k <= MAX_EXIT && rect && holds(rect, x + dx * k, y + dy * k); k++) cells.push(x + dx * k, y + dy * k)
  cells.push(x + dx * k, y + dy * k)
  return cells
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

/** The path's ends and corners in sheet coordinates. */
function corners(grid: LocalGrid, cells: readonly number[]): Point[] {
  const at = (index: number): Point => ({ x: fromCell(grid.box.minX + (index % grid.width)), y: fromCell(grid.box.minY + Math.floor(index / grid.width)) })
  const points = cells.map(at)
  return points.filter((p, i) => {
    const [before, after] = [points[i - 1], points[i + 1]]
    if (!before || !after) return true
    return !((before.x === p.x && p.x === after.x) || (before.y === p.y && p.y === after.y))
  })
}

/** Routes the requests in order around the sheet's symbols and the fixed wires; one entry per request. */
export function routeWires(sheet: Sheet, fixed: readonly FixedWire[], requests: readonly RouteRequest[]): { wires: (Wire | undefined)[]; diagnostics: Diagnostic[] } {
  const router = new Router(sheet)
  for (const { wire, pins } of fixed) router.add(wire.points, pins)
  const wires = requests.map((request) => router.route(request))
  return { wires, diagnostics: router.diagnostics }
}
