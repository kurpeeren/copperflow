import { describe, expect, test } from "vitest"
import type { Board, Keepout, Point } from "../../src/engine/model.js"
import type { PcbLayout, PcbTrack, PcbVia, PlacedFootprint, WorldPad } from "../../src/engine/pcb.js"
import { cellsOnShape, centreReach, FREE, rasterise, rasteriseIn, routerPitch, routerWorld, type NetRule, type RouterGrid } from "../../src/engine/router/grid.js"
import { loadRules } from "../../src/engine/rules/load.js"
import { DEFAULT_CLASS } from "../../src/engine/rules/profiles.js"
import type { NetClass, Rules } from "../../src/engine/rules/schema.js"

const RULES = loadRules({}).rules
const RULE: NetRule = { net: "net.A", className: "default", width: 0.25, via: { drill: 0.3, diameter: 0.66 } }
const SOURCE = { file: "main.circuit.tsx", line: 1, column: 1, offset: 0 }

const square = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]

function pad(id: string, x: number, y: number, net?: string): WorldPad {
  return { number: "1", shape: "rect", x, y, width: 1, height: 1, rotation: 0, layers: "top", id, component: id.split("#")[0] ?? id, ...(net ? { net } : {}) }
}

function layoutOf(pads: WorldPad[], keepouts: Keepout[] = [], tracks: PcbTrack[] = [], vias: PcbVia[] = []): PcbLayout {
  const board: Board = { outline: square(-5, -5, 5, 5), layers: 2, thickness: 1.6, keepouts }
  const part: PlacedFootprint = { component: "X", x: 0, y: 0, rotation: 0, side: "top", autoPlaced: false, pads, courtyard: [], silkscreen: [], fabrication: [] }
  return { board, parts: [part], ratsnest: [], tracks, vias }
}

const asDefault = () => DEFAULT_CLASS.name
const cellAt = (grid: RouterGrid, x: number, y: number) => (Math.round(y / grid.pitch) - grid.originRow) * grid.cols + (Math.round(x / grid.pitch) - grid.originCol)
const trackBlocker = (grid: RouterGrid, layer: number, x: number, y: number) => {
  const index = grid.track[layer]?.[cellAt(grid, x, y)] ?? FREE
  return index === FREE ? undefined : grid.blockers[index]
}
const viaBlocker = (grid: RouterGrid, x: number, y: number) => {
  const index = grid.via[cellAt(grid, x, y)] ?? FREE
  return index === FREE ? undefined : grid.blockers[index]
}
const withClass = (netClass: Partial<NetClass>, fabrication: Partial<Rules["fabrication"]> = {}): Rules => ({
  ...RULES,
  fabrication: { ...RULES.fabrication, ...fabrication },
  classes: [{ ...DEFAULT_CLASS, name: "fine", patterns: ["X"], ...netClass }],
})

describe("the pitch rule", () => {
  test("the default class gives half of 0.25 + 0.2, rounded to 0.25 mm", () => {
    expect(routerPitch(RULES)).toBe(0.25)
  })

  test("the smallest class sets it, raised to the fabrication minimums and kept within 0.05–0.25 mm", () => {
    expect(routerPitch(withClass({ trackWidth: 0.1, clearance: 0.1 }))).toBe(0.1)
    expect(routerPitch(withClass({ trackWidth: 0.02, clearance: 0.02 }))).toBe(0.1)
    expect(routerPitch(withClass({ trackWidth: 0.02, clearance: 0.02 }, { minTrackWidth: 0.02, minClearance: 0.02 }))).toBe(0.05)
    expect(routerPitch(withClass({ trackWidth: 2, clearance: 2 }))).toBe(0.25)
  })

  test("a free centre keeps the needed gap plus room for a diagonal move", () => {
    expect(centreReach(0.325, 0.25)).toBeCloseTo(Math.sqrt(0.325 ** 2 + 0.25 ** 2 / 2), 12)
  })
})

describe("rasterising the board for one net", () => {
  const grid = rasterise(layoutOf([pad("B#1", 0, 0, "net.B"), pad("A#1", -3, 0, "net.A")]), RULES, asDefault, RULE)

  test("the grid covers the board at the rule's pitch on the board's layers", () => {
    expect([grid.pitch, grid.cols, grid.rows, grid.originCol, grid.originRow]).toEqual([0.25, 41, 41, -20, -20])
    expect(grid.layers).toEqual(["top", "bottom"])
  })

  test("another net's pad keeps track centres out by the gap, half the width and the diagonal margin", () => {
    expect(trackBlocker(grid, 0, 0, 0)).toBe("B#1")
    expect(trackBlocker(grid, 0, 0.75, 0)).toBe("B#1")
    expect(trackBlocker(grid, 0, 0.75, 0.75)).toBe("B#1")
    expect(trackBlocker(grid, 0, 1, 0)).toBeUndefined()
    expect(trackBlocker(grid, 1, 0, 0)).toBeUndefined()
  })

  test("vias keep the gap plus their radius, from pads of every layer", () => {
    expect(viaBlocker(grid, 1, 0)).toBe("B#1")
    expect(viaBlocker(grid, 1.25, 0)).toBeUndefined()
  })

  test("the net's own pad is open to tracks but not to vias", () => {
    expect(trackBlocker(grid, 0, -3, 0)).toBeUndefined()
    expect(viaBlocker(grid, -3, 0)).toBe("A#1")
  })

  test("the board edge keeps centres out by the edge minimum and half the width", () => {
    expect(trackBlocker(grid, 0, 4.75, 0)).toBe("board edge")
    expect(trackBlocker(grid, 1, 5, 2)).toBe("board edge")
    expect(trackBlocker(grid, 0, 4.5, 0)).toBeUndefined()
  })

  test("a keepout closes its own layer to tracks and every layer to vias", () => {
    const keepout: Keepout = { id: "keepout:1", outline: square(2, 2, 3, 3), layers: "top", source: SOURCE }
    const kept = rasterise(layoutOf([], [keepout]), RULES, asDefault, RULE)
    expect(trackBlocker(kept, 0, 2.5, 2.5)).toBe("keepout:1")
    expect(trackBlocker(kept, 0, 2, 2.5)).toBe("keepout:1")
    expect(trackBlocker(kept, 0, 1.75, 2.5)).toBeUndefined()
    expect(trackBlocker(kept, 1, 2.5, 2.5)).toBeUndefined()
    expect(viaBlocker(kept, 2.5, 2.5)).toBe("keepout:1")
    expect(viaBlocker(kept, 1.75, 2.5)).toBe("keepout:1")
  })

  test("another net's track blocks its layer; the net's own track does not", () => {
    const track = (id: string, net: string, y: number): PcbTrack => ({ id, net, layer: "bottom", width: 0.25, points: [{ x: -4, y }, { x: 4, y }], locked: false, by: "human", pads: [] })
    const crossed = rasterise(layoutOf([], [], [track("t0001", "net.B", 1), track("t0002", "net.A", -1)]), RULES, asDefault, RULE)
    expect(trackBlocker(crossed, 1, 0, 1.25)).toBe("t0001")
    expect(trackBlocker(crossed, 0, 0, 1.25)).toBeUndefined()
    expect(trackBlocker(crossed, 1, 0, -1)).toBeUndefined()
  })

  test("the cells on a shape are those whose centre lies on its copper", () => {
    expect(cellsOnShape(grid, { core: [{ x: 0, y: 0 }], radius: 0.3 })).toEqual([cellAt(grid, 0, -0.25), cellAt(grid, -0.25, 0), cellAt(grid, 0, 0), cellAt(grid, 0.25, 0), cellAt(grid, 0, 0.25)])
  })
})

describe("what the router keeps out besides copper clearance", () => {
  test("a pad of a shape the checks do not know is an obstacle over its whole box", () => {
    const odd = { ...pad("B#1", 0, 0, "net.B"), shape: "star", width: 2, height: 1 } as unknown as WorldPad
    const grid = rasterise(layoutOf([odd]), RULES, asDefault, RULE)
    expect(trackBlocker(grid, 0, 0, 0)).toBe("B#1")
    expect(trackBlocker(grid, 0, 1.25, 0)).toBe("B#1")
    expect(trackBlocker(grid, 0, 1.5, 0)).toBeUndefined()
    expect(viaBlocker(grid, 1.5, 0)).toBe("B#1")
    expect(viaBlocker(grid, 1.75, 0)).toBeUndefined()
  })

  test("a via keeps the hole spacing from a through pad and a via of its own net", () => {
    const through: WorldPad = { ...pad("A#1", -2, 0, "net.A"), shape: "circle", width: 1.2, height: 1.2, layers: "through", drill: { width: 1, height: 1 } }
    const via: PcbVia = { id: "v0001", net: "net.A", at: { x: 2, y: 2 }, drill: 0.3, diameter: 0.6, layers: ["top", "bottom"], locked: false, by: "human" } as PcbVia
    const grid = rasterise(layoutOf([through], [], [], [via]), RULES, asDefault, RULE)
    expect(trackBlocker(grid, 0, -2, 0)).toBeUndefined()
    expect(viaBlocker(grid, -1, 0)).toBe("A#1")
    expect(viaBlocker(grid, -0.75, 0)).toBeUndefined()
    expect(trackBlocker(grid, 0, 2, 2)).toBeUndefined()
    expect(viaBlocker(grid, 2.5, 2)).toBe("v0001")
    expect(viaBlocker(grid, 2.75, 2)).toBeUndefined()
  })

  test("a window of the board is the same grid over its own cells", () => {
    const layout = layoutOf([pad("B#1", 0, 0, "net.B"), pad("A#1", -3, 0, "net.A")])
    const world = routerWorld(layout, RULES, asDefault)
    const full = rasteriseIn(world, RULE)
    const part = rasteriseIn(world, RULE, { col0: 5, row0: 12, col1: 30, row1: 25 })
    expect([part.originCol, part.originRow, part.cols, part.rows]).toEqual([full.originCol + 5, full.originRow + 12, 26, 14])
    for (let row = 0; row < part.rows; row++) {
      for (let col = 0; col < part.cols; col++) {
        const [mine, whole] = [row * part.cols + col, (row + 12) * full.cols + col + 5]
        const name = (grid: RouterGrid, map: Int32Array, cell: number) => (map[cell] === FREE ? undefined : grid.blockers[map[cell] as number])
        expect(name(part, part.track[0] as Int32Array, mine)).toBe(name(full, full.track[0] as Int32Array, whole))
        expect(name(part, part.via, mine)).toBe(name(full, full.via, whole))
      }
    }
  })

  test("copper added for the run blocks like the layout's own, by the name it is given", () => {
    const world = routerWorld(layoutOf([]), RULES, asDefault)
    const extra = { id: "net.B", kind: "track" as const, net: "net.B", className: "default", layers: ["top" as const], shapes: [{ core: [{ x: -4, y: 1 }, { x: 4, y: 1 }], radius: 0.125 }], at: { x: -4, y: 1 }, box: { minX: -4.125, minY: 0.875, maxX: 4.125, maxY: 1.125 } }
    const grid = rasteriseIn(world, RULE, undefined, [extra])
    expect(trackBlocker(grid, 0, 0, 1.25)).toBe("net.B")
    expect(trackBlocker(grid, 1, 0, 1.25)).toBeUndefined()
  })
})
