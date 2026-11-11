import type { Point } from "../model.js"
import { naturalCompare } from "../order.js"
import { BoxIndex, GRID, inArea, moved, snap, type Box } from "./geometry.js"
import { placeConnector } from "./edge.js"
import type { Movable, Problem } from "./scope.js"
import type { State } from "./score.js"

/** Once a ring has a free spot, the scan looks this many rings further for a cheaper one (2 mm at the 0.5 mm grid). */
const EXTRA_RINGS = 4
/** A net with more pads than this pulls the scan's centre a quarter as hard: GND should not drag every part. */
const LARGE_NET = 8
const LARGE_NET_WEIGHT = 0.25
/** The placed pads of a net this small are scan centres of their own. */
const SMALL_NET = 4
/** Abutting spots are looked for among courtyards this near the scan centre (mm), or as near as the first free ring. */
const ABUT_REACH = 4
/** Courtyards further inside than this from the first free ring are not abutted (mm). */
const ABUT_BAND = 2
/** Abutting spots are rounded away from the courtyard they abut to this step (mm). */
const ABUT_STEP = 0.01
/** How much more a decoupling capacitor's distance to its supply pin weighs than its other wiring. */
const DECOUPLING_WEIGHT = 4

export interface Spot {
  x: number
  y: number
  rot: number
}

/** What the constructive pass keeps while it places: the courtyards, and the pads placed so far per net. */
export class Board {
  readonly index = new BoxIndex()
  readonly placed: Uint8Array
  readonly padsX: number[][]
  readonly padsY: number[][]
  readonly netBox: Box[]

  constructor(
    readonly problem: Problem,
    readonly state: State,
  ) {
    this.placed = new Uint8Array(problem.movables.length)
    problem.obstacles.forEach((o, k) => this.index.set(problem.movables.length + k, o.box))
    this.padsX = problem.fixedPads.map((pads) => pads.map((p) => p.x))
    this.padsY = problem.fixedPads.map((pads) => pads.map((p) => p.y))
    this.netBox = problem.fixedPads.map((pads) => ({
      minX: Math.min(...pads.map((p) => p.x)),
      minY: Math.min(...pads.map((p) => p.y)),
      maxX: Math.max(...pads.map((p) => p.x)),
      maxY: Math.max(...pads.map((p) => p.y)),
    }))
  }

  fits(m: Movable, spot: Spot): boolean {
    const box = moved(m.boxes[spot.rot] as Box, spot.x, spot.y)
    return inArea(box, this.problem.area) && !this.index.clashes(box, this.problem.clearance)
  }

  put(i: number, spot: Spot): void {
    const m = this.problem.movables[i] as Movable
    this.state.x[i] = spot.x
    this.state.y[i] = spot.y
    this.state.rot[i] = spot.rot
    this.placed[i] = 1
    this.index.set(i, moved(m.boxes[spot.rot] as Box, spot.x, spot.y))
    for (const pad of m.pads[spot.rot] ?? []) {
      if (pad.net < 0) continue
      const [x, y] = [spot.x + pad.x, spot.y + pad.y]
      this.padsX[pad.net]?.push(x)
      this.padsY[pad.net]?.push(y)
      const b = this.netBox[pad.net] as Box
      this.netBox[pad.net] = { minX: Math.min(b.minX, x), minY: Math.min(b.minY, y), maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y) }
    }
  }

  /** Where the pad `pad` of part `part` is now: a placed movable part or a fixed one; undefined when not placed. */
  padAt(part: string, pad: number): Point | undefined {
    const fixed = this.problem.fixedPartPads.get(part)?.[pad]
    if (fixed) return fixed
    const i = this.problem.movables.findIndex((m) => m.name === part)
    if (i < 0 || !this.placed[i]) return undefined
    const local = this.problem.movables[i]?.pads[this.state.rot[i] as number]?.[pad]
    return local && { x: (this.state.x[i] as number) + local.x, y: (this.state.y[i] as number) + local.y }
  }

  /**
   * What a spot costs in wiring: for each pad on a net, the distance to the nearest pad of that net placed so far,
   * plus how much the spot grows each net's half-perimeter; a decoupling capacitor adds its distance to its supply pin.
   */
  cost(m: Movable, spot: Spot, supply: Point | undefined): number {
    const pads = m.pads[spot.rot] ?? []
    let total = 0
    const grown = new Map<number, Box>()
    for (const pad of pads) {
      if (pad.net < 0) continue
      const [x, y] = [spot.x + pad.x, spot.y + pad.y]
      const xs = this.padsX[pad.net] as number[]
      const ys = this.padsY[pad.net] as number[]
      let nearest = Infinity
      for (let k = 0; k < xs.length; k++) {
        const dx = (xs[k] as number) - x
        const dy = (ys[k] as number) - y
        const d = dx * dx + dy * dy
        if (d < nearest) nearest = d
      }
      if (nearest < Infinity) total += Math.sqrt(nearest)
      const b = grown.get(pad.net) ?? (this.netBox[pad.net] as Box)
      grown.set(pad.net, { minX: Math.min(b.minX, x), minY: Math.min(b.minY, y), maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y) })
    }
    for (const [net, b] of grown) {
      const before = this.netBox[net] as Box
      if (Number.isFinite(before.minX)) total += b.maxX - b.minX + b.maxY - b.minY - (before.maxX - before.minX + before.maxY - before.minY)
    }
    if (supply && m.decouples) {
      const own = pads[m.decouples.ownPad]
      if (own) total += DECOUPLING_WEIGHT * Math.hypot(spot.x + own.x - supply.x, spot.y + own.y - supply.y)
    }
    return total
  }
}

/** Grid cells at Chebyshev distance `ring` from the centre cell, in a fixed order. */
function* ringCells(ring: number): Generator<[number, number]> {
  if (ring === 0) {
    yield [0, 0]
    return
  }
  for (let i = -ring; i <= ring; i++) {
    yield [i, -ring]
    yield [i, ring]
  }
  for (let j = -ring + 1; j < ring; j++) {
    yield [-ring, j]
    yield [ring, j]
  }
}

/** Free spots in rings round `centre`, from the first ring with one to EXTRA_RINGS further, every rotation; and that ring. */
function freeSpots(board: Board, m: Movable, centre: Point): { spots: Spot[]; first: number } {
  const area = board.problem.area.box
  const reach = Math.max(area.maxX - area.minX, area.maxY - area.minY)
  const rings = Math.ceil(reach / GRID) + 1
  const [cx, cy] = [snap(centre.x), snap(centre.y)]
  const spots: Spot[] = []
  const centred = m.boxes.every((b) => b.minX < 0 && b.maxX > 0 && b.minY < 0 && b.maxY > 0)
  let last = rings
  let first = rings
  for (let ring = 0; ring <= last; ring++) {
    for (const [i, j] of ringCells(ring)) {
      const [x, y] = [cx + i * GRID, cy + j * GRID]
      // A courtyard holds its part's origin, so a spot inside another courtyard is taken whatever the rotation.
      if (centred && board.index.covers(x, y)) continue
      for (let rot = 0; rot < 4; rot++) {
        const spot = { x, y, rot }
        if (board.fits(m, spot)) spots.push(spot)
      }
    }
    if (spots.length > 0 && last === rings) {
      first = ring
      last = Math.min(rings, ring + EXTRA_RINGS)
    }
  }
  return { spots, first }
}

const up = (v: number) => Math.ceil(v / ABUT_STEP - 1e-6) * ABUT_STEP
const down = (v: number) => Math.floor(v / ABUT_STEP + 1e-6) * ABUT_STEP

/**
 * Spots that put the part against a courtyard near `centre`, the clearance apart, lined up with its sides or its
 * middle: the grid alone leaves gaps of up to a grid step between parts.
 */
function abuttingSpots(board: Board, m: Movable, centre: Point, inner: number, reach: number): Spot[] {
  const gap = board.problem.clearance
  const window = { minX: centre.x - reach, minY: centre.y - reach, maxX: centre.x + reach, maxY: centre.y + reach }
  const spots: Spot[] = []
  for (const id of board.index.near(window)) {
    const other = board.index.get(id) as Box
    // Courtyards well inside the first free ring are surrounded: nothing abuts them.
    const away = Math.max(other.minX - centre.x, centre.x - other.maxX, other.minY - centre.y, centre.y - other.maxY)
    if (away < inner) continue
    for (let rot = 0; rot < 4; rot++) {
      const b = m.boxes[rot] as Box
      const xs = [other.minX - b.minX, other.maxX - b.maxX, (other.minX + other.maxX - b.minX - b.maxX) / 2]
      const ys = [other.minY - b.minY, other.maxY - b.maxY, (other.minY + other.maxY - b.minY - b.maxY) / 2]
      const right = up(other.maxX + gap - b.minX)
      const left = down(other.minX - gap - b.maxX)
      const above = up(other.maxY + gap - b.minY)
      const below = down(other.minY - gap - b.maxY)
      for (const y of ys) spots.push({ x: right, y, rot }, { x: left, y, rot })
      for (const x of xs) spots.push({ x, y: above, rot }, { x, y: below, rot })
    }
  }
  return spots.filter((spot) => board.fits(m, spot))
}

/** The scan centres for a part: where its nets' placed pads are on average, and the pads of its small nets. */
function centresFor(board: Board, i: number): Point[] {
  const m = board.problem.movables[i] as Movable
  const area = board.problem.area.box
  const middle = { x: (area.minX + area.maxX) / 2, y: (area.minY + area.maxY) / 2 }
  if (m.decouples) {
    const supply = board.padAt(m.decouples.part, m.decouples.pad)
    if (supply) return [supply]
  }
  const nets = [...new Set((m.pads[0] ?? []).map((p) => p.net).filter((n) => n >= 0))]
  let [sx, sy, weight] = [0, 0, 0]
  const extra: Point[] = []
  for (const net of nets) {
    const xs = board.padsX[net] as number[]
    const ys = board.padsY[net] as number[]
    if (xs.length === 0) continue
    const w = xs.length > LARGE_NET ? LARGE_NET_WEIGHT : 1
    sx += (w * xs.reduce((a, b) => a + b, 0)) / xs.length
    sy += (w * ys.reduce((a, b) => a + b, 0)) / ys.length
    weight += w
    if (xs.length <= SMALL_NET) xs.forEach((x, k) => extra.push({ x, y: ys[k] as number }))
  }
  return weight === 0 ? [middle] : [{ x: sx / weight, y: sy / weight }, ...extra]
}

/** Places part `i` at its cheapest free spot; false when nothing on the board is free for it. */
function placeOne(board: Board, i: number): boolean {
  const m = board.problem.movables[i] as Movable
  if (m.role === "connector") {
    const spot = placeConnector(board, i, centresFor(board, i)[0] as Point)
    if (spot) {
      board.put(i, spot)
      return true
    }
  }
  const centres = centresFor(board, i)
  const supply = m.decouples ? board.padAt(m.decouples.part, m.decouples.pad) : undefined
  const first = centres[0] as Point
  let best: { spot: Spot; cost: number; far: number } | undefined
  const seen = new Set<string>()
  for (const centre of centres) {
    const free = freeSpots(board, m, centre)
    const reach = Math.max(ABUT_REACH, (free.first + 1) * GRID)
    const inner = free.first * GRID - ABUT_BAND
    for (const spot of [...free.spots, ...abuttingSpots(board, m, centre, inner, reach)]) {
      const key = `${spot.x},${spot.y},${spot.rot}`
      if (seen.has(key)) continue
      seen.add(key)
      const cost = board.cost(m, spot, supply)
      const far = Math.hypot(spot.x - first.x, spot.y - first.y)
      if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) <= 1e-9 && far < best.far - 1e-9)) best = { spot, cost, far }
    }
  }
  if (!best) return false
  board.put(i, best.spot)
  return true
}

/** How strongly a part hangs on what is placed: its pads on nets with a placed pad. */
function pull(board: Board, m: Movable): number {
  return (m.pads[0] ?? []).filter((p) => p.net >= 0 && (board.padsX[p.net]?.length ?? 0) > 0).length
}

/**
 * The order parts are placed in: decoupling capacitors of fixed chips first, then the chip with most connections,
 * then each time the part that hangs most on what is placed (ties: more connections, then the name), every chip
 * followed by its decoupling capacitors; connectors last, on the board edge.
 */
function nextPart(board: Board, waiting: readonly number[]): number {
  const movables = board.problem.movables
  const anyPlaced = board.placed.some((p) => p === 1)
  const rank = (i: number) => {
    const m = movables[i] as Movable
    const chipWaits = m.decouples !== undefined && !board.problem.fixedPartPads.has(m.decouples.part)
    return [m.role === "connector" ? 1 : 0, chipWaits ? 1 : 0, anyPlaced || m.role === "chip" ? 0 : 1, -pull(board, m), -m.connections] as const
  }
  let best = waiting[0] as number
  let bestRank = rank(best)
  for (const i of waiting.slice(1)) {
    const r = rank(i)
    const diff = r.map((v, k) => v - (bestRank[k] as number)).find((d) => d !== 0) ?? naturalCompare((movables[i] as Movable).name, (movables[best] as Movable).name)
    if (diff < 0) {
      best = i
      bestRank = r
    }
  }
  return best
}

/** Places every movable part; the parts that found no free spot keep where the build put them and are returned. */
export function construct(problem: Problem, state: State): { board: Board; unplaced: number[] } {
  const board = new Board(problem, state)
  const capsOf = new Map<string, number[]>()
  problem.movables.forEach((m, i) => {
    if (m.decouples) capsOf.set(m.decouples.part, [...(capsOf.get(m.decouples.part) ?? []), i])
  })
  const unplaced: number[] = []
  const done = new Set<number>()
  const place = (i: number) => {
    done.add(i)
    if (!placeOne(board, i)) unplaced.push(i)
    for (const cap of capsOf.get((problem.movables[i] as Movable).name) ?? []) if (!done.has(cap)) place(cap)
  }
  for (const [chip, caps] of capsOf) if (problem.fixedPartPads.has(chip)) caps.forEach((cap) => !done.has(cap) && place(cap))
  for (;;) {
    const waiting = problem.movables.map((_, i) => i).filter((i) => !done.has(i))
    if (waiting.length === 0) break
    place(nextPart(board, waiting))
  }
  return { board, unplaced }
}
