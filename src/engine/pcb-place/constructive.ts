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
/** How much more a part's distance to the pins it sits beside (a decoupling capacitor's supply pin) weighs than its other wiring. */
const BESIDE_WEIGHT = 4

export interface Spot {
  x: number
  y: number
  rot: number
}

/**
 * A pad a part sits beside, its own pad there, and for a part beside a part that itself sits beside pins (a load
 * capacitor beside a crystal) where those pins are, to keep away from.
 */
export interface Host {
  at: Point
  ownPad: number
  away?: Point
}

/** What the constructive pass keeps while it places: the courtyards, and the pads placed so far per net. */
export class Board {
  readonly index = new BoxIndex()
  readonly placed: Uint8Array
  readonly padsX: number[][]
  readonly padsY: number[][]
  readonly netBox: Box[]
  /** Every pad of each net, placed or not. */
  readonly netSize: number[]

  constructor(
    readonly problem: Problem,
    readonly state: State,
  ) {
    this.placed = new Uint8Array(problem.movables.length)
    this.netSize = problem.fixedPads.map((pads) => pads.length)
    for (const m of problem.movables) for (const pad of m.pads[0] ?? []) if (pad.net >= 0) this.netSize[pad.net] = (this.netSize[pad.net] ?? 0) + 1
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

  /** How hard a net pulls a part: a large net (ground) a quarter as hard on a part that sits beside pins. */
  private weight(hosts: readonly unknown[], net: number): number {
    return hosts.length > 0 && (this.netSize[net] as number) > LARGE_NET ? LARGE_NET_WEIGHT : 1
  }

  /** Where the pads a part sits beside are now, paired with its own pad on each; empty when they are not placed. */
  hosts(m: Movable): Host[] {
    if (!m.beside) return []
    const { part } = m.beside
    // The pins the host itself sits beside (a crystal's chip pins), whether the host moves or a person placed it: this
    // part keeps to the far side of the host.
    const hostTie = this.problem.movables.find((one) => one.name === part)?.beside ?? this.problem.fixedBeside.get(part)
    const from = hostTie ? [hostTie, ...(hostTie.also ? [hostTie.also] : [])].flatMap((tie) => this.padAt(hostTie.part, tie.pad) ?? []) : []
    const away = from.length > 0 ? { x: from.reduce((s, p) => s + p.x, 0) / from.length, y: from.reduce((s, p) => s + p.y, 0) / from.length } : undefined
    return [m.beside, ...(m.beside.also ? [m.beside.also] : [])].flatMap((tie) => {
      const at = this.padAt(part, tie.pad)
      return at ? [{ at, ownPad: tie.ownPad, ...(away ? { away } : {}) }] : []
    })
  }

  /**
   * What a spot costs in wiring: for each pad on a net, the distance to the nearest pad of that net placed so far,
   * plus how much the spot grows each net's half-perimeter; a part that sits beside pins (a decoupling capacitor, a
   * crystal, a pull-up) adds its distance to each of them, weighted. Such a part's pad on a large net (ground) pulls
   * a quarter as hard, so a crystal's load capacitor goes beside the crystal pad rather than toward the chip's ground.
   */
  cost(m: Movable, spot: Spot, hosts: readonly Host[]): number {
    const pads = m.pads[spot.rot] ?? []
    let total = 0
    const grown = new Map<number, Box>()
    const tied = new Set(hosts.map((h) => h.ownPad))
    for (const [index, pad] of pads.entries()) {
      // A pad tied to a pin is costed by its distance to that pin alone (below), not pulled toward the net's others.
      if (pad.net < 0 || tied.has(index)) continue
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
      if (nearest < Infinity) total += this.weight(hosts, pad.net) * Math.sqrt(nearest)
      const b = grown.get(pad.net) ?? (this.netBox[pad.net] as Box)
      grown.set(pad.net, { minX: Math.min(b.minX, x), minY: Math.min(b.minY, y), maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y) })
    }
    for (const [net, b] of grown) {
      const before = this.netBox[net] as Box
      const growth = b.maxX - b.minX + b.maxY - b.minY - (before.maxX - before.minX + before.maxY - before.minY)
      if (Number.isFinite(before.minX)) total += this.weight(hosts, net) * growth
    }
    for (const host of hosts) {
      const own = pads[host.ownPad]
      if (!own) continue
      const [dx, dy] = [spot.x + own.x - host.at.x, spot.y + own.y - host.at.y]
      total += BESIDE_WEIGHT * Math.hypot(dx, dy)
      if (!host.away) continue
      // How far the pad sits back toward the host's own pins, past the host pad: a load capacitor between crystal and chip.
      const [ax, ay] = [host.at.x - host.away.x, host.at.y - host.away.y]
      const length = Math.hypot(ax, ay)
      if (length > 0) total += BESIDE_WEIGHT * Math.max(0, -(dx * ax + dy * ay) / length)
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
function abuttingSpots(board: Board, m: Movable, centre: Point, inner: number, reach: number, host: number | undefined): Spot[] {
  const gap = board.problem.clearance
  const window = { minX: centre.x - reach, minY: centre.y - reach, maxX: centre.x + reach, maxY: centre.y + reach }
  const spots: Spot[] = []
  for (const id of board.index.near(window)) {
    const other = board.index.get(id) as Box
    // Courtyards well inside the first free ring are surrounded: nothing abuts them. The part this one sits beside
    // holds the scan centre (its pins) in its courtyard, and is abutted whatever.
    const away = Math.max(other.minX - centre.x, centre.x - other.maxX, other.minY - centre.y, centre.y - other.maxY)
    if (away < inner && id !== host) continue
    for (let rot = 0; rot < 4; rot++) {
      const b = m.boxes[rot] as Box
      // Lined up with the other's sides or middle, or with the scan centre (the pins a crystal sits beside).
      const xs = [other.minX - b.minX, other.maxX - b.maxX, (other.minX + other.maxX - b.minX - b.maxX) / 2, centre.x]
      const ys = [other.minY - b.minY, other.maxY - b.maxY, (other.minY + other.maxY - b.minY - b.maxY) / 2, centre.y]
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

/** The courtyard id (in the board's index) of the part `m` sits beside, when it has one. */
function hostId(problem: Problem, m: Movable): number | undefined {
  if (!m.beside) return undefined
  const part = m.beside.part
  const movable = problem.movables.findIndex((one) => one.name === part)
  if (movable >= 0) return movable
  const fixed = problem.obstacles.findIndex((o) => o.part && o.name === part)
  return fixed >= 0 ? problem.movables.length + fixed : undefined
}

/** The scan centres for a part: where its nets' placed pads are on average, and the pads of its small nets. */
function centresFor(board: Board, i: number): Point[] {
  const m = board.problem.movables[i] as Movable
  const area = board.problem.area.box
  const middle = { x: (area.minX + area.maxX) / 2, y: (area.minY + area.maxY) / 2 }
  const hosts = board.hosts(m)
  if (hosts.length > 0) return [{ x: hosts.reduce((s, h) => s + h.at.x, 0) / hosts.length, y: hosts.reduce((s, h) => s + h.at.y, 0) / hosts.length }]
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
  // Nothing it connects to is placed yet: its sub-sheet instance's own place, else the middle of the area.
  return weight === 0 ? [m.anchor ?? middle] : [{ x: sx / weight, y: sy / weight }, ...extra]
}

/** What placing one part gave: whether it found a spot, and a note when a connector could not go on an edge. */
interface Placed {
  placed: boolean
  note?: string
}

/** Places part `i` at its cheapest free spot; not placed when nothing on the board is free for it. */
function placeOne(board: Board, i: number): Placed {
  const m = board.problem.movables[i] as Movable
  let note: string | undefined
  if (m.role === "connector") {
    const spot = placeConnector(board, i, centresFor(board, i)[0] as Point)
    if (spot) {
      board.put(i, spot)
      return { placed: true }
    }
    note = `${m.name} is a connector, but no board edge has room for it, so it is placed inside the board`
  }
  const centres = centresFor(board, i)
  const hosts = board.hosts(m)
  const first = centres[0] as Point
  let best: { spot: Spot; cost: number; far: number } | undefined
  const seen = new Set<string>()
  for (const centre of centres) {
    const free = freeSpots(board, m, centre)
    const reach = Math.max(ABUT_REACH, (free.first + 1) * GRID)
    const inner = free.first * GRID - ABUT_BAND
    for (const spot of [...free.spots, ...abuttingSpots(board, m, centre, inner, reach, hostId(board.problem, m))]) {
      const key = `${spot.x},${spot.y},${spot.rot}`
      if (seen.has(key)) continue
      seen.add(key)
      const cost = board.cost(m, spot, hosts)
      const far = Math.hypot(spot.x - first.x, spot.y - first.y)
      if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) <= 1e-9 && far < best.far - 1e-9)) best = { spot, cost, far }
    }
  }
  if (!best) return { placed: false }
  board.put(i, best.spot)
  return note === undefined ? { placed: true } : { placed: true, note }
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
    const chipWaits = m.beside !== undefined && !board.problem.fixedPartPads.has(m.beside.part)
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

/** What the constructive pass gave: the parts it found no room for (or no time for), and notes about the rest. */
export interface Constructed {
  board: Board
  unplaced: { index: number; reason: string }[]
  notes: string[]
}

/** The reason a part found no spot: its courtyard and how much of the area is left. */
function noRoom(board: Board, m: Movable): string {
  const b = m.boxes[0] as Box
  const a = board.problem.area.box
  const gap = board.problem.clearance
  const areaSize = (a.maxX - a.minX) * (a.maxY - a.minY)
  const clip = (o: Box) => Math.max(0, Math.min(o.maxX, a.maxX) - Math.max(o.minX, a.minX)) * Math.max(0, Math.min(o.maxY, a.maxY) - Math.max(o.minY, a.minY))
  const taken = board.index.near(a).reduce((sum, id) => sum + clip(board.index.get(id) as Box), 0)
  const mm = (v: number) => v.toFixed(1)
  return (
    `no free spot for its ${mm(b.maxX - b.minX)} x ${mm(b.maxY - b.minY)} mm courtyard with ${gap} mm around it: ` +
    `the ${mm(a.maxX - a.minX)} x ${mm(a.maxY - a.minY)} mm area inside the edge clearance has about ${mm(Math.max(0, areaSize - taken))} mm2 not under a courtyard, in gaps too small for it`
  )
}

export const OUT_OF_TIME = "the time budget ran out before it was placed"

/**
 * Places every movable part. The parts that find no free spot, and those left when `late` says the time is up, are
 * returned unplaced with the reason; their state is left as it was. `onPart` is told after each part.
 */
export function construct(problem: Problem, state: State, late: () => boolean = () => false, onPart: (done: number, total: number) => void = () => undefined): Constructed {
  const board = new Board(problem, state)
  const capsOf = new Map<string, number[]>()
  problem.movables.forEach((m, i) => {
    if (m.beside) capsOf.set(m.beside.part, [...(capsOf.get(m.beside.part) ?? []), i])
  })
  const unplaced: { index: number; reason: string }[] = []
  const notes: string[] = []
  const done = new Set<number>()
  const place = (i: number) => {
    done.add(i)
    const m = problem.movables[i] as Movable
    if (late()) unplaced.push({ index: i, reason: OUT_OF_TIME })
    else {
      const result = placeOne(board, i)
      if (!result.placed) unplaced.push({ index: i, reason: noRoom(board, m) })
      if (result.note) notes.push(result.note)
    }
    onPart(done.size, problem.movables.length)
    for (const cap of capsOf.get(m.name) ?? []) if (!done.has(cap)) place(cap)
  }
  for (const [chip, caps] of capsOf) if (problem.fixedPartPads.has(chip)) caps.forEach((cap) => !done.has(cap) && place(cap))
  for (;;) {
    const waiting = problem.movables.map((_, i) => i).filter((i) => !done.has(i))
    if (waiting.length === 0) break
    place(nextPart(board, waiting))
  }
  return { board, unplaced, notes }
}
