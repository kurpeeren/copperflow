// Where a stripboard's strips must be cut once the nets have their holes: along each strip, between two holes of
// different nets that no cut parts yet, one cut. It is drilled at the free hole nearest the middle of the gap, or made
// with a knife between the two holes when they are neighbours. Cuts already there are kept and counted. Pure.
import { holeKey, holeName, type Hole } from "./grid.js"
import { FREE, partedAlong, stripCount, stripHoles, type BoardState } from "./board-state.js"

/** A cut to add: at a hole, or between two neighbouring holes. */
export type CutDraft = { at: string } | { between: [string, string] }

/** The free hole nearest the middle of the holes strictly between `from` and `to` along a strip, or undefined. */
function middleFree(state: BoardState, keys: readonly number[], from: number, to: number): number | undefined {
  const middle = (from + to) / 2
  let best: number | undefined
  for (let i = from + 1; i < to; i++) {
    if (state.owner[keys[i] as number] !== FREE) continue
    if (best === undefined || Math.abs(i - middle) < Math.abs(best - middle)) best = i
  }
  return best
}

/** The cuts one strip needs, in order along it. */
function stripCuts(state: BoardState, holes: readonly Hole[]): CutDraft[] {
  const keys = holes.map((hole) => holeKey(state.grid, hole))
  const cuts: CutDraft[] = []
  let last = -1
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as number
    if (i > 0 && partedAlong(state, keys[i - 1] as number, key)) last = -1
    const owner = state.owner[key] as number
    if (owner < 0) continue
    if (last >= 0 && state.owner[keys[last] as number] !== owner) {
      const at = middleFree(state, keys, last, i)
      cuts.push(at === undefined ? { between: [holeName(holes[i - 1] as Hole), holeName(holes[i] as Hole)] } : { at: holeName(holes[at] as Hole) })
    }
    last = i
  }
  return cuts
}

/** Every cut the board still needs so that no strip joins two nets, strip by strip. */
export function neededCuts(state: BoardState): CutDraft[] {
  if (state.grid.kind !== "stripboard") return []
  return Array.from({ length: stripCount(state.grid) }, (_, strip) => stripCuts(state, stripHoles(state.grid, strip))).flat()
}
