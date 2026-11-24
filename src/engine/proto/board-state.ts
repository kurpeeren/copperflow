// What the proto router knows about each hole while it works: which net owns it, whether a lead is in it, whether the
// top side over it is taken (a leg or a link), where the strips are cut, and which holes are joined so far. Built from
// the placed parts and the records already in the layout file; copied for each routing round. Pure.
import type { CutRecord, ProtoRecord } from "../../core/layout-proto.js"
import type { PlacedFootprint } from "../pcb.js"
import { alongStrip, holeKey, holeOfKey, inGrid, linkSpan, type Hole, type ProtoGrid } from "./grid.js"
import { cutKeys, gridHole, HoleSets, joinRecords, pairKey, protoSets } from "./joins.js"
import { pinHoles } from "./placement.js"

/** A hole no net may take: a cut drilled there, or copper that already joins two nets. */
export const BLOCKED = -2
export const FREE = -1

export interface BoardState {
  grid: ProtoGrid
  /** The net index owning each hole, FREE or BLOCKED. */
  owner: Int32Array
  /** 1 where a lead is in the hole. */
  pin: Uint8Array
  /** 1 where the top side over the hole is taken: a leg, or a link's end or span. */
  top: Uint8Array
  /** 1 where a cut is drilled. */
  cutAt: Uint8Array
  /** Neighbouring holes cut between, as pairKey. */
  cutBetween: Set<string>
  /** The holes joined so far: by the records, the routes and (stripboard) the strips between holes of one net. */
  conn: HoleSets
}

/** Net ids by index: the circuit's nets in order, then one name per pin with no net, so no strip joins it to a net. */
export interface NetIndex {
  names: string[]
  indexOf: Map<string, number>
}

export function cloneState(state: BoardState): BoardState {
  return { ...state, owner: state.owner.slice(), pin: state.pin.slice(), top: state.top.slice(), cutAt: state.cutAt.slice(), cutBetween: new Set(state.cutBetween), conn: state.conn.clone() }
}

/** The holes of one strip in order: a row (strips along rows) or a column. */
export function stripHoles(grid: ProtoGrid, strip: number): Hole[] {
  return grid.strips === "columns" ? Array.from({ length: grid.rows }, (_, row) => ({ col: strip, row })) : Array.from({ length: grid.columns }, (_, col) => ({ col, row: strip }))
}

export const stripOf = (grid: ProtoGrid, hole: Hole): number => (grid.strips === "columns" ? hole.col : hole.row)
export const stripCount = (grid: ProtoGrid): number => (grid.strips === "columns" ? grid.columns : grid.rows)

/** Whether two holes next to each other along a strip are parted by a cut. */
export function partedAlong(state: BoardState, a: number, b: number): boolean {
  return state.cutAt[a] === 1 || state.cutAt[b] === 1 || state.cutBetween.has(pairKey(a, b))
}

/**
 * On a stripboard the strip carries a net between two of its holes when nothing parts them: those free holes take
 * the net, and the holes are joined. Done for one strip, segment by segment between the cuts.
 */
export function fillStrip(state: BoardState, strip: number): void {
  const keys = stripHoles(state.grid, strip).map((hole) => holeKey(state.grid, hole))
  let last = -1
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as number
    if (i > 0 && partedAlong(state, keys[i - 1] as number, key)) last = -1
    const owner = state.owner[key] as number
    if (owner === FREE || owner === BLOCKED) continue
    if (last >= 0 && state.owner[keys[last] as number] === owner) {
      for (let j = last + 1; j <= i; j++) {
        state.owner[keys[j] as number] = owner
        state.conn.join(keys[j - 1] as number, keys[j] as number)
      }
    }
    last = i
  }
}

/** The board as the records leave it, with the nets indexed. */
export function boardState(grid: ProtoGrid, parts: readonly PlacedFootprint[], records: readonly ProtoRecord[], nets: NetIndex): BoardState {
  const size = grid.columns * grid.rows
  const cuts = cutKeys(grid, records.filter((r): r is CutRecord => r.t === "cut"))
  const state: BoardState = { grid, owner: new Int32Array(size).fill(FREE), pin: new Uint8Array(size), top: new Uint8Array(size), cutAt: new Uint8Array(size), cutBetween: cuts.between, conn: new HoleSets(size) }
  const pinNet = new Map<number, number>()
  for (const [key, { pad }] of pinHoles(grid, parts)) {
    const net = pad.net ?? `pin:${pad.id}`
    if (!nets.indexOf.has(net)) {
      nets.indexOf.set(net, nets.names.length)
      nets.names.push(net)
    }
    pinNet.set(key, nets.indexOf.get(net) as number)
    state.owner[key] = nets.indexOf.get(net) as number
    state.pin[key] = 1
    state.top[key] = 1
  }
  for (const key of cuts.at) {
    state.cutAt[key] = 1
    state.owner[key] = BLOCKED
  }
  claimRecords(state, records, pinNet, nets)
  joinRecords(grid, state.conn, records)
  if (grid.kind === "stripboard") for (let strip = 0; strip < stripCount(grid); strip++) fillStrip(state, strip)
  return state
}

/** The holes the existing solder and links use take the net of the pins they join; a link's span takes the top side. */
function claimRecords(state: BoardState, records: readonly ProtoRecord[], pinNet: Map<number, number>, nets: NetIndex): void {
  const { grid } = state
  const sets = protoSets(grid, records)
  const owners = new Map<number, number>()
  for (const [key, net] of pinNet) {
    const island = sets.find(key)
    const before = owners.get(island)
    owners.set(island, before === undefined || before === net ? net : BLOCKED)
  }
  const claim = (hole: Hole | undefined, named: string | undefined) => {
    if (!hole) return
    const key = holeKey(grid, hole)
    if (state.cutAt[key] === 1) return
    const fromPins = owners.get(sets.find(key))
    const byName = named === undefined ? undefined : (nets.indexOf.get(named) ?? nets.indexOf.get(`net.${named}`))
    state.owner[key] = fromPins ?? byName ?? BLOCKED
  }
  for (const record of records) {
    if (record.t === "solder") record.holes.forEach((name) => claim(gridHole(grid, name), record.net))
    if (record.t !== "link") continue
    const [from, to] = [gridHole(grid, record.from), gridHole(grid, record.to)]
    claim(from, record.net)
    claim(to, record.net)
    if (!from || !to) continue
    for (const hole of [from, to, ...(linkSpan(from, to) ?? [])]) state.top[holeKey(grid, hole)] = 1
  }
}

/** The holes joined along a strip to this one where both have the same net and nothing parts them (stripboard). */
export function joinAlongStrip(state: BoardState, key: number): void {
  const { grid } = state
  const hole = holeOfKey(grid, key)
  const before = grid.strips === "columns" ? { col: hole.col, row: hole.row - 1 } : { col: hole.col - 1, row: hole.row }
  for (const other of [before, alongStrip(grid, hole)]) {
    if (!other || !inGrid(grid, other)) continue
    const near = holeKey(grid, other)
    if (state.owner[near] === state.owner[key] && !partedAlong(state, key, near)) state.conn.join(key, near)
  }
}
