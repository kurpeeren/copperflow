import { describe, expect, test } from "vitest"
import type { Board, Point } from "../../src/engine/model.js"
import type { PcbLayout } from "../../src/engine/pcb.js"
import type { CellRef } from "../../src/engine/router/astar.js"
import { Congestion, placeRoute } from "../../src/engine/router/congestion.js"
import { rasteriseIn, routerWorld, wholeBoard, type NetRule } from "../../src/engine/router/grid.js"
import type { RoutedCopper } from "../../src/engine/router/path.js"
import { loadRules } from "../../src/engine/rules/load.js"
import { DEFAULT_CLASS } from "../../src/engine/rules/profiles.js"

const RULES = loadRules({}).rules
const board: Board = { outline: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }], layers: 2, thickness: 1.6, keepouts: [] }
const layout: PcbLayout = { board, parts: [], ratsnest: [], tracks: [], vias: [] }
const rule = (net: string): NetRule => ({ net, className: DEFAULT_CLASS.name, width: 0.25, via: { drill: 0.3, diameter: 0.6 } })
const across = (net: string, y: number): RoutedCopper => ({ net, tracks: [{ layer: "top", width: 0.25, points: [{ x: -3, y }, { x: 3, y }] }], vias: [] })

describe("negotiated congestion", () => {
  test("a route over a cell two other nets hold is in conflict with both", () => {
    const world = routerWorld(layout, RULES, () => DEFAULT_CLASS.name)
    const window = wholeBoard(world)
    const congestion = new Congestion(world)
    const grid = rasteriseIn(world, rule("net.C"), window)
    const cellAt = (p: Point) => (Math.round(p.y / grid.pitch) - grid.originRow) * grid.cols + Math.round(p.x / grid.pitch) - grid.originCol
    congestion.placed.set(0, placeRoute(world, 0, across("net.A", 0), DEFAULT_CLASS.name, [], grid, window, {}))
    congestion.placed.set(1, placeRoute(world, 1, across("net.B", 0.25), DEFAULT_CLASS.name, [], grid, window, {}))
    const occupancy = congestion.costs(rule("net.C"), grid, window, 1)
    const steps: CellRef[] = [-1, -0.75, -0.5].map((x) => ({ layer: 0, cell: cellAt({ x, y: 0 }) }))
    const mine = placeRoute(world, 2, { net: "net.C", tracks: [{ layer: "top", width: 0.25, points: [{ x: -1, y: 0 }, { x: -0.5, y: 0 }] }], vias: [] }, DEFAULT_CLASS.name, steps, grid, window, {})
    expect([...congestion.conflicts(world, rule("net.C"), mine, occupancy, grid, window)].sort()).toEqual([0, 1])
  })
})
