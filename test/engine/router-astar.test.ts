import { describe, expect, test } from "vitest"
import { COST_CAP, DIAGONAL, SearchBuffers, searchPath, STEP, TURN_45, VIA, type CellRef } from "../../src/engine/router/astar.js"
import { FREE, type RouterGrid } from "../../src/engine/router/grid.js"

/** A grid of `cols` × `rows` cells on top and bottom; `blocked` maps "layer:col,row" to a blocker name. */
function gridOf(cols: number, rows: number, blocked: Record<string, string> = {}, viaBlocked: string[] = []): RouterGrid {
  const blockers = [...new Set([...Object.values(blocked), "via"])]
  const track = [0, 1].map(() => new Int32Array(cols * rows).fill(FREE))
  for (const [key, name] of Object.entries(blocked)) {
    const [layer, at] = key.split(":") as [string, string]
    const [col, row] = at.split(",").map(Number) as [number, number]
    ;(track[Number(layer)] as Int32Array)[row * cols + col] = blockers.indexOf(name)
  }
  const via = new Int32Array(cols * rows).fill(FREE)
  for (const at of viaBlocked) {
    const [col, row] = at.split(",").map(Number) as [number, number]
    via[row * cols + col] = blockers.indexOf("via")
  }
  return { pitch: 0.25, originCol: 0, originRow: 0, cols, rows, layers: ["top", "bottom"], track, via, blockers }
}

const at = (grid: RouterGrid, layer: number, col: number, row: number): CellRef => ({ layer, cell: row * grid.cols + col })
const cellsOf = (grid: RouterGrid, steps: readonly CellRef[]) => steps.map(({ layer, cell }) => `${layer}:${cell % grid.cols},${Math.floor(cell / grid.cols)}`)
/** A wall across every row at `col` on the given layers, except the rows in `gaps`. */
function wall(rows: number, col: number, layers: number[], name: string, gaps: number[] = []): Record<string, string> {
  const cells: Record<string, string> = {}
  for (const layer of layers) for (let row = 0; row < rows; row++) if (!gaps.includes(row)) cells[`${layer}:${col},${row}`] = name
  return cells
}

describe("A* on the router grid", () => {
  test("a straight run costs one step per cell", () => {
    const grid = gridOf(6, 3)
    const result = searchPath(grid, [at(grid, 0, 0, 1)], [at(grid, 0, 5, 1)])
    expect(result.found && cellsOf(grid, result.steps)).toEqual(["0:0,1", "0:1,1", "0:2,1", "0:3,1", "0:4,1", "0:5,1"])
    expect(result.found && result.cost).toBe(5 * STEP)
  })

  test("an offset target is reached with one diagonal and one 45° corner", () => {
    const grid = gridOf(6, 3)
    const result = searchPath(grid, [at(grid, 0, 0, 0)], [at(grid, 0, 5, 1)])
    expect(result.found && result.cost).toBe(4 * STEP + DIAGONAL + TURN_45)
  })

  test("a wall with a gap is passed through the gap, on the same layer", () => {
    const grid = gridOf(7, 7, wall(7, 3, [0, 1], "U1#1", [6]))
    const result = searchPath(grid, [at(grid, 0, 0, 3)], [at(grid, 0, 6, 3)])
    expect(result.found).toBe(true)
    if (!result.found) return
    expect(cellsOf(grid, result.steps)).toContain("0:3,6")
    expect(result.steps.every((step) => step.layer === 0)).toBe(true)
  })

  test("a wall on top only is passed under with one via down and one up", () => {
    const grid = gridOf(9, 5, wall(5, 4, [0], "keepout:1"))
    const result = searchPath(grid, [at(grid, 0, 0, 2)], [at(grid, 0, 8, 2)])
    expect(result.found).toBe(true)
    if (!result.found) return
    const layers = result.steps.map((step) => step.layer)
    expect(layers.filter((layer, i) => i > 0 && layer !== layers[i - 1])).toHaveLength(2)
    expect(result.cost).toBe(8 * STEP + 2 * VIA)
  })

  test("a via never lands where vias are blocked", () => {
    const viaBlocked = ["0,2", "1,2", "2,2", "3,2"]
    const grid = gridOf(9, 5, wall(5, 4, [0], "keepout:1"), viaBlocked)
    const result = searchPath(grid, [at(grid, 0, 0, 2)], [at(grid, 0, 8, 2)])
    expect(result.found).toBe(true)
    if (!result.found) return
    const viaCells = result.steps.filter((step, i) => i > 0 && step.layer !== result.steps[i - 1]?.layer)
    expect(cellsOf(grid, viaCells).map((cell) => cell.slice(2))).not.toContain("3,2")
    expect(viaCells.every(({ cell }) => grid.via[cell] === FREE)).toBe(true)
  })

  test("a target on the other layer only costs one via", () => {
    const grid = gridOf(5, 3)
    const result = searchPath(grid, [at(grid, 0, 0, 1)], [at(grid, 1, 4, 1)])
    expect(result.found && result.cost).toBe(4 * STEP + VIA)
  })

  test("with every way closed there is no path, and the reason names what closed it", () => {
    const grid = gridOf(7, 5, { ...wall(5, 3, [0, 1], "keepout:1"), "0:0,0": "board edge" })
    const result = searchPath(grid, [at(grid, 0, 0, 2)], [at(grid, 0, 6, 2)])
    expect(result).toEqual({ found: false, reason: "no-path", expanded: expect.any(Number), blockers: ["keepout:1"] })
  })

  test("the search stops at its bound", () => {
    const grid = gridOf(40, 40)
    const result = searchPath(grid, [at(grid, 0, 0, 0)], [at(grid, 0, 39, 39)], { maxExpansions: 5 })
    expect(result).toEqual({ found: false, reason: "limit", expanded: 5, blockers: [] })
  })

  test("blocked sources and targets are left out, and with none left there is no path", () => {
    const grid = gridOf(5, 3, { "0:4,1": "U1#1" })
    expect(searchPath(grid, [at(grid, 0, 0, 1)], [at(grid, 0, 4, 1)]).found).toBe(false)
  })

  test("the same grid gives the same path", () => {
    const grid = gridOf(20, 20, { ...wall(20, 10, [0], "keepout:1", [3, 15]) })
    const run = () => searchPath(grid, [at(grid, 0, 0, 9), at(grid, 0, 0, 10)], [at(grid, 0, 19, 9), at(grid, 0, 19, 10)])
    expect(run()).toEqual(run())
  })
  test("penalties steer the path off costly cells when a way round is cheaper", () => {
    const grid = gridOf(9, 5)
    const cells = grid.cols * grid.rows
    const track = [new Int32Array(cells), new Int32Array(cells)]
    for (let row = 0; row < 4; row++) (track[0] as Int32Array)[row * grid.cols + 4] = 1000
    const result = searchPath(grid, [at(grid, 0, 0, 1)], [at(grid, 0, 8, 1)], { penalties: { track, via: new Int32Array(cells) } })
    expect(result.found).toBe(true)
    if (!result.found) return
    expect(cellsOf(grid, result.steps)).toContain("0:4,4")
    expect(result.steps.every((step) => step.layer === 0)).toBe(true)
  })

  test("a costly via place is avoided, and penalties add to the cost", () => {
    const grid = gridOf(5, 1, wall(1, 2, [0], "keepout:1"))
    const cells = grid.cols * grid.rows
    const via = new Int32Array(cells)
    via[0] = 500
    via[1] = 500
    const result = searchPath(grid, [at(grid, 0, 0, 0)], [at(grid, 0, 4, 0)], { penalties: { track: [new Int32Array(cells), new Int32Array(cells)], via } })
    expect(result.found && result.cost).toBe(2 * VIA + 4 * STEP + 500)
  })

  test("a start and an end may carry a cost of their own, as an off-grid leg does", () => {
    const grid = gridOf(6, 3)
    const result = searchPath(grid, [{ ...at(grid, 0, 0, 1), cost: 7 }, { ...at(grid, 0, 0, 0), cost: 100 }], [{ ...at(grid, 0, 5, 1), cost: 3 }])
    expect(result.found && result.cost).toBe(5 * STEP + 10)
    expect(result.found && cellsOf(grid, result.steps)[0]).toBe("0:0,1")
  })

  test("buffers reused across searches give the same paths as fresh ones", () => {
    const buffers = new SearchBuffers()
    const big = gridOf(20, 20, { ...wall(20, 10, [0], "keepout:1", [3, 15]) })
    const small = gridOf(6, 3)
    const runBig = (options = {}) => searchPath(big, [at(big, 0, 0, 9)], [at(big, 0, 19, 9)], options)
    const runSmall = (options = {}) => searchPath(small, [at(small, 0, 0, 0)], [at(small, 0, 5, 2)], options)
    expect(runBig({ buffers })).toEqual(runBig())
    expect(runSmall({ buffers })).toEqual(runSmall())
    expect(runBig({ buffers })).toEqual(runBig())
  })
  test("a path over many costly cells stops at the cost cap and never wraps", () => {
    const grid = gridOf(3000, 1)
    const cells = grid.cols * grid.rows
    const track = [new Int32Array(cells).fill(2 ** 20), new Int32Array(cells).fill(2 ** 20)]
    const result = searchPath(grid, [at(grid, 0, 0, 0)], [at(grid, 0, 2999, 0)], { penalties: { track, via: new Int32Array(cells) } })
    expect(result.found && result.cost).toBe(COST_CAP)
  })
})
