// The router of a perfboard or stripboard: a cheapest-path search on the hole lattice, one net at a time, each net
// grown from its first pin's piece to the nearest piece of it not joined yet. Paths run only along grid lines between
// holes: on perfboard a step to a neighbouring hole is a run of solder, on stripboard a step along a strip is the strip
// itself and costs almost nothing. A link (a wire on the top) jumps straight along a row or column, never over a leg
// or another link, at the cost of several solder steps, so it is taken where it saves a detour or where paths would
// cross. Nets are routed shortest first; a net that fails goes first in the next round, and the best round is kept.
// Then the stripboard's strips get one cut per change of net (cuts.ts). Pure and deterministic.
import type { ProtoRecord } from "../../core/layout-proto.js"
import { naturalCompare } from "../order.js"
import type { PlacedFootprint, WorldPad } from "../pcb.js"
import { boardState, cloneState, fillStrip, FREE, joinAlongStrip, partedAlong, stripOf, type BoardState, type NetIndex } from "./board-state.js"
import { neededCuts, type CutDraft } from "./cuts.js"
import { holeKey, holeName, holeOfKey, inGrid, type Hole, type ProtoGrid } from "./grid.js"
import { pinHoles } from "./placement.js"

/** A step to a neighbouring hole on perfboard: a run of solder. */
const SOLDER_STEP = 1
/** A step along a stripboard's strip: the copper is there already. */
const STRIP_STEP = 0.05
/** A link costs this much, plus a little per hole it spans: worth it against about six solder steps. */
const LINK_COST = 6
const LINK_PER_HOLE = 0.1
/** The longest link, in holes. */
export const MAX_LINK = 24
/** The routing rounds: the first, and up to three more with the failed nets first. */
const ROUNDS = 4

const ACROSS: readonly Hole[] = [
  { col: 1, row: 0 },
  { col: -1, row: 0 },
  { col: 0, row: 1 },
  { col: 0, row: -1 },
]

/** A new record the router asks for: what is drawn, without an id. */
export type ProtoDraft = { t: "solder"; net: string; holes: string[] } | { t: "link"; net: string; from: string; to: string } | ({ t: "cut" } & CutDraft)

export interface ProtoUnrouted {
  net: string
  from: string
  to: string
  reason: string
}

export interface ProtoRouteReport {
  drafts: ProtoDraft[]
  unrouted: ProtoUnrouted[]
  /** The connections tried: joined and not. */
  total: number
  solder: number
  links: number
  cuts: number
  rounds: number
}

export interface ProtoRouteInput {
  grid: ProtoGrid
  parts: readonly PlacedFootprint[]
  records: readonly ProtoRecord[]
  /** The nets to route, by id; all when left out. */
  nets?: readonly string[]
}

interface Move {
  from: number
  to: number
  link: boolean
}

interface NetJob {
  net: string
  index: number
  pins: { key: number; pad: WorldPad }[]
  span: number
}

interface RoundResult {
  state: BoardState
  moves: Map<string, Move[][]>
  unrouted: ProtoUnrouted[]
  total: number
  links: number
  solder: number
}

const pinName = (pad: WorldPad) => pad.pin ?? `${pad.component}.pin${pad.number}`

/** The pins of each net to route, in holes, with their spread (half the box round them). */
function netJobs(input: ProtoRouteInput, nets: NetIndex): NetJob[] {
  const byNet = new Map<string, { key: number; pad: WorldPad }[]>()
  for (const [key, { pad }] of pinHoles(input.grid, input.parts)) {
    if (pad.net === undefined || (input.nets && !input.nets.includes(pad.net))) continue
    byNet.set(pad.net, [...(byNet.get(pad.net) ?? []), { key, pad }])
  }
  return [...byNet]
    .filter(([, pins]) => pins.length > 1)
    .map(([net, pins]) => {
      const holes = pins.map((pin) => holeOfKey(input.grid, pin.key))
      const span = Math.max(...holes.map((h) => h.col)) - Math.min(...holes.map((h) => h.col)) + Math.max(...holes.map((h) => h.row)) - Math.min(...holes.map((h) => h.row))
      return { net, index: nets.indexOf.get(net) as number, pins: pins.sort((a, b) => naturalCompare(a.pad.id, b.pad.id)), span }
    })
    .sort((a, b) => a.span - b.span || naturalCompare(a.net, b.net))
}

/** A min-heap of hole keys by cost. */
class Frontier {
  private readonly keys: number[] = []
  private readonly costs: number[] = []

  get size(): number {
    return this.keys.length
  }

  push(key: number, cost: number): void {
    let i = this.keys.length
    this.keys.push(key)
    this.costs.push(cost)
    while (i > 0) {
      const up = (i - 1) >> 1
      if (!this.before(i, up)) break
      this.swap(i, up)
      i = up
    }
  }

  pop(): { key: number; cost: number } {
    const top = { key: this.keys[0] as number, cost: this.costs[0] as number }
    const lastKey = this.keys.pop() as number
    const lastCost = this.costs.pop() as number
    if (this.keys.length > 0) {
      this.keys[0] = lastKey
      this.costs[0] = lastCost
      let i = 0
      for (;;) {
        const [l, r] = [2 * i + 1, 2 * i + 2]
        let best = i
        if (l < this.keys.length && this.before(l, best)) best = l
        if (r < this.keys.length && this.before(r, best)) best = r
        if (best === i) break
        this.swap(i, best)
        i = best
      }
    }
    return top
  }

  private before(a: number, b: number): boolean {
    const [ca, cb] = [this.costs[a] as number, this.costs[b] as number]
    return ca < cb || (ca === cb && (this.keys[a] as number) < (this.keys[b] as number))
  }

  private swap(a: number, b: number): void {
    ;[this.keys[a], this.keys[b]] = [this.keys[b] as number, this.keys[a] as number]
    ;[this.costs[a], this.costs[b]] = [this.costs[b] as number, this.costs[a] as number]
  }
}

const usable = (state: BoardState, key: number, net: number) => state.owner[key] === FREE || state.owner[key] === net

/** The holes one step away that a path of the net may take, and whether a link reaches them. */
function* moves(state: BoardState, key: number, net: number): Generator<Move & { cost: number }> {
  const { grid } = state
  const here = holeOfKey(grid, key)
  const strip = grid.kind === "stripboard"
  for (const dir of ACROSS) {
    const along = strip && (grid.strips === "columns" ? dir.col === 0 : dir.row === 0)
    const next = { col: here.col + dir.col, row: here.row + dir.row }
    if (inGrid(grid, next) && (!strip || along)) {
      const to = holeKey(grid, next)
      if (usable(state, to, net) && !(strip && partedAlong(state, key, to))) yield { from: key, to, link: false, cost: strip ? STRIP_STEP : SOLDER_STEP }
    }
    if (state.top[key] === 1 || (strip && along)) continue
    for (let k = 1; k <= MAX_LINK; k++) {
      const end = { col: here.col + dir.col * k, row: here.row + dir.row * k }
      if (!inGrid(grid, end)) break
      const to = holeKey(grid, end)
      if (state.top[to] === 1) break
      if (k >= (strip ? 1 : 2) && usable(state, to, net) && state.cutAt[to] === 0) yield { from: key, to, link: true, cost: LINK_COST + LINK_PER_HOLE * k }
    }
  }
}

/** The cheapest path from the source piece to any hole of the net outside it, as moves; undefined when none. */
function search(state: BoardState, net: number, source: number): Move[] | undefined {
  const size = state.owner.length
  const cost = new Float64Array(size).fill(Infinity)
  const came = new Array<Move | undefined>(size)
  const frontier = new Frontier()
  for (let key = 0; key < size; key++) {
    if (state.owner[key] === net && state.conn.find(key) === source) {
      cost[key] = 0
      frontier.push(key, 0)
    }
  }
  while (frontier.size > 0) {
    const { key, cost: at } = frontier.pop()
    if (at > (cost[key] as number)) continue
    if (state.owner[key] === net && state.conn.find(key) !== source) return pathTo(came, key)
    for (const move of moves(state, key, net)) {
      const next = at + move.cost
      if (next < (cost[move.to] as number)) {
        cost[move.to] = next
        came[move.to] = move
        frontier.push(move.to, next)
      }
    }
  }
  return undefined
}

function pathTo(came: readonly (Move | undefined)[], end: number): Move[] {
  const path: Move[] = []
  for (let move = came[end]; move !== undefined; move = came[move.from]) path.unshift(move)
  return path
}

/** Gives the path's holes to the net and joins them; a link takes the top side over its span. */
function claim(state: BoardState, net: number, path: readonly Move[]): void {
  const { grid } = state
  const strips = new Set<number>()
  for (const move of path) {
    for (const key of [move.from, move.to]) state.owner[key] = net
    state.conn.join(move.from, move.to)
    if (move.link) {
      const [a, b] = [holeOfKey(grid, move.from), holeOfKey(grid, move.to)]
      const steps = Math.abs(a.col - b.col) + Math.abs(a.row - b.row)
      for (let i = 0; i <= steps; i++) state.top[holeKey(grid, { col: a.col + Math.sign(b.col - a.col) * i, row: a.row + Math.sign(b.row - a.row) * i })] = 1
    }
    if (grid.kind === "stripboard") for (const key of [move.from, move.to]) strips.add(stripOf(grid, holeOfKey(grid, key)))
  }
  if (grid.kind !== "stripboard") return
  for (const move of path) for (const key of [move.from, move.to]) joinAlongStrip(state, key)
  for (const strip of strips) fillStrip(state, strip)
}

/** Routes one net's pieces together; the pins of pieces that cannot be reached are returned. */
function routeNet(state: BoardState, job: NetJob): { paths: Move[][]; failed: ProtoUnrouted[] } {
  const paths: Move[][] = []
  const first = job.pins[0] as NetJob["pins"][number]
  for (;;) {
    const source = state.conn.find(first.key)
    const away = job.pins.filter((pin) => state.conn.find(pin.key) !== source)
    if (away.length === 0) return { paths, failed: [] }
    const path = search(state, job.index, source)
    if (!path) {
      const pieces = new Map(away.map((pin) => [state.conn.find(pin.key), pin] as const))
      const reason = "no free path along the holes; move the parts apart or free a row for a link"
      return { paths, failed: [...pieces.values()].map((pin) => ({ net: job.net, from: pinName(first.pad), to: pinName(pin.pad), reason })) }
    }
    claim(state, job.index, path)
    paths.push(path)
  }
}

function runRound(start: BoardState, jobs: readonly NetJob[]): RoundResult {
  const state = cloneState(start)
  const moves = new Map<string, Move[][]>()
  const unrouted: ProtoUnrouted[] = []
  let total = 0
  for (const job of jobs) {
    total += new Set(job.pins.map((pin) => state.conn.find(pin.key))).size - 1
    const { paths, failed } = routeNet(state, job)
    moves.set(job.net, paths)
    unrouted.push(...failed)
  }
  const all = [...moves.values()].flat(2)
  const links = all.filter((move) => move.link).length
  const solder = start.grid.kind === "perfboard" ? all.length - links : 0
  return { state, moves, unrouted, total, links, solder }
}

const better = (a: RoundResult, b: RoundResult) => a.unrouted.length - b.unrouted.length || a.links - b.links || a.solder - b.solder

/** The runs of solder and the links one path makes, as drafts (stripboard steps are the strip and make none). */
function pathDrafts(grid: ProtoGrid, net: string, path: readonly Move[]): ProtoDraft[] {
  const drafts: ProtoDraft[] = []
  let run: number[] = []
  const close = () => {
    if (run.length >= 2 && grid.kind === "perfboard") drafts.push({ t: "solder", net, holes: run.map((key) => holeName(holeOfKey(grid, key))) })
    run = []
  }
  for (const move of path) {
    if (move.link) {
      close()
      drafts.push({ t: "link", net, from: holeName(holeOfKey(grid, move.from)), to: holeName(holeOfKey(grid, move.to)) })
      continue
    }
    if (run.length === 0) run.push(move.from)
    run.push(move.to)
  }
  close()
  return drafts
}

/** Routes the board: the drafts to write, what could not be joined, and the counts. */
export function routeProto(input: ProtoRouteInput, nameOf: (net: string) => string = (net) => net): ProtoRouteReport {
  const nets: NetIndex = { names: [], indexOf: new Map() }
  for (const part of input.parts) for (const pad of part.pads) if (pad.net !== undefined && !nets.indexOf.has(pad.net)) nets.indexOf.set(pad.net, nets.names.push(pad.net) - 1)
  const start = boardState(input.grid, input.parts, input.records, nets)
  let jobs = netJobs(input, nets)
  let best: RoundResult | undefined
  let rounds = 0
  for (; rounds < ROUNDS; rounds++) {
    const result = runRound(start, jobs)
    if (!best || better(result, best) < 0) best = result
    if (result.unrouted.length === 0) break
    const failed = new Set(result.unrouted.map((one) => one.net))
    jobs = [...jobs.filter((job) => failed.has(job.net)), ...jobs.filter((job) => !failed.has(job.net))]
  }
  const kept = best as RoundResult
  const drafts = [...kept.moves].flatMap(([net, paths]) => paths.flatMap((path) => pathDrafts(input.grid, nameOf(net), path)))
  const cuts = neededCuts(kept.state).map((cut): ProtoDraft => ({ t: "cut", ...cut }))
  return { drafts: [...drafts, ...cuts], unrouted: kept.unrouted.map((one) => ({ ...one, net: nameOf(one.net) })), total: kept.total, solder: kept.solder, links: kept.links, cuts: cuts.length, rounds: Math.min(rounds + 1, ROUNDS) }
}
