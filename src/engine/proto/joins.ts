// What joins what on a perfboard or stripboard: one union-find over its holes. A solder run joins each hole to the
// next when they are neighbours; a link joins its two ends; on a stripboard each hole joins the next along its strip
// unless a cut is at either hole or between them. The pins in the holes then share an island when their holes do, and
// the ratsnest takes those islands as copper's. Pure.
import type { CutRecord, ProtoRecord } from "../../core/layout-proto.js"
import type { PlacedFootprint } from "../pcb.js"
import { alongStrip, holeKey, inGrid, neighbours, parseHole, type Hole, type ProtoGrid } from "./grid.js"
import { pinHoles } from "./placement.js"

/** Union-find over the hole keys. */
export class HoleSets {
  private readonly parent: Int32Array

  constructor(size: number) {
    this.parent = new Int32Array(size).map((_, i) => i)
  }

  find(key: number): number {
    let root = key
    while (this.parent[root] !== root) root = this.parent[root] as number
    let at = key
    while (this.parent[at] !== root) {
      const next = this.parent[at] as number
      this.parent[at] = root
      at = next
    }
    return root
  }

  join(a: number, b: number): void {
    const [ra, rb] = [this.find(a), this.find(b)]
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
}

/** A hole name inside the grid as a hole, or undefined. */
export function gridHole(grid: ProtoGrid, name: string): Hole | undefined {
  const hole = parseHole(name)
  return hole !== undefined && inGrid(grid, hole) ? hole : undefined
}

/** The cuts as keys: the holes drilled away, and the pairs of neighbouring holes cut between ("a|b", smaller key first). */
export function cutKeys(grid: ProtoGrid, cuts: readonly CutRecord[]): { at: Set<number>; between: Set<string> } {
  const at = new Set<number>()
  const between = new Set<string>()
  for (const cut of cuts) {
    if (cut.at !== undefined) {
      const hole = gridHole(grid, cut.at)
      if (hole) at.add(holeKey(grid, hole))
      continue
    }
    const [a, b] = (cut.between ?? []).map((name) => gridHole(grid, name))
    if (a && b) between.add(pairKey(holeKey(grid, a), holeKey(grid, b)))
  }
  return { at, between }
}

export const pairKey = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Joins each hole to the next along its strip where no cut parts them. */
export function joinStrips(grid: ProtoGrid, sets: HoleSets, cuts: { at: ReadonlySet<number>; between: ReadonlySet<string> }): void {
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.columns; col++) {
      const hole = { col, row }
      const next = alongStrip(grid, hole)
      if (next === undefined) continue
      const [a, b] = [holeKey(grid, hole), holeKey(grid, next)]
      if (cuts.at.has(a) || cuts.at.has(b) || cuts.between.has(pairKey(a, b))) continue
      sets.join(a, b)
    }
  }
}

/** Joins what the solder runs and links join; steps that are not to a neighbour, and holes off the grid, join nothing. */
export function joinRecords(grid: ProtoGrid, sets: HoleSets, records: readonly ProtoRecord[]): void {
  for (const record of records) {
    if (record.t === "solder") {
      const holes = record.holes.map((name) => gridHole(grid, name))
      for (let i = 1; i < holes.length; i++) {
        const [a, b] = [holes[i - 1], holes[i]]
        if (a && b && neighbours(a, b)) sets.join(holeKey(grid, a), holeKey(grid, b))
      }
    } else if (record.t === "link") {
      const [a, b] = [gridHole(grid, record.from), gridHole(grid, record.to)]
      if (a && b) sets.join(holeKey(grid, a), holeKey(grid, b))
    }
  }
}

/** The holes joined by the board's strips and the records. */
export function protoSets(grid: ProtoGrid, records: readonly ProtoRecord[]): HoleSets {
  const sets = new HoleSets(grid.columns * grid.rows)
  if (grid.kind === "stripboard") joinStrips(grid, sets, cutKeys(grid, records.filter((r): r is CutRecord => r.t === "cut")))
  joinRecords(grid, sets, records)
  return sets
}

/** Each pad in a hole, by pad id, with its hole's island; pads in one island are joined. */
export function protoIslands(grid: ProtoGrid, parts: readonly PlacedFootprint[], records: readonly ProtoRecord[]): Map<string, number> {
  const sets = protoSets(grid, records)
  const islands = new Map<string, number>()
  for (const [key, { pad }] of pinHoles(grid, parts)) islands.set(pad.id, sets.find(key))
  return islands
}
