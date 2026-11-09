import { describe, expect, test } from "vitest"
import { drawGrid } from "../studio/src/pcb/overlays.js"
import { INITIAL_GRID_STEPS, INITIAL_GRID_STYLES, PCB_DEFAULT_STEP, PCB_GRID_STEPS, SHEET_DEFAULT_STEP, SHEET_GRID_STEPS, gridStepOptions, nextGridStyle, planGrid, setGridStep, toggleGridStyle } from "../studio/src/pcb/grid.js"
import { drawSchematicGrid, SHEET_DOT_PX } from "../studio/src/pcb/schematic-grid.js"
import { schematicTheme } from "../studio/src/pcb/schematic-theme.js"
import { gridStepLabel } from "../studio/src/pcb/units.js"

const SIZE = { width: 400, height: 300 }
const MINOR = "rgb(255 255 255 / 30%)"
const FIFTH = "rgb(255 255 255 / 50%)"

interface Rec {
  name: string
  args: unknown[]
  style: string
}

/** A canvas context that records the calls and the stroke or fill colour at each. */
function recorder() {
  const records: Rec[] = []
  let stroke = ""
  let fill = ""
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_, name: string) => (...args: unknown[]) => void records.push({ name, args, style: name === "fill" || name === "fillRect" || name === "rect" ? fill : stroke }),
    set: (_, name: string, value: string) => {
      if (name === "strokeStyle") stroke = value
      if (name === "fillStyle") fill = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, records }
}

describe("grid steps", () => {
  test("the PCB steps are the EasyEDA mil steps and today's mm ones, smallest first", () => {
    expect(PCB_GRID_STEPS).toEqual([0.0508, 0.1, 0.127, 0.254, 0.5, 0.508, 0.635, 1, 1.27, 2.54])
    expect(PCB_DEFAULT_STEP).toBe(0.5)
  })

  test("the schematic steps are 0.05, 0.1 and 0.2 in, the default 0.1", () => {
    expect(SHEET_GRID_STEPS).toEqual([0.05, 0.1, 0.2])
    expect(SHEET_DEFAULT_STEP).toBe(0.1)
  })

  test("PCB labels in mm", () => {
    expect(gridStepOptions("pcb", "mm").map((o) => o.label)).toEqual(["0.0508 mm", "0.1 mm", "0.127 mm", "0.254 mm", "0.5 mm", "0.508 mm", "0.635 mm", "1 mm", "1.27 mm", "2.54 mm"])
  })

  test("PCB labels in mil", () => {
    expect(gridStepOptions("pcb", "mil").map((o) => o.label)).toEqual(["2 mil", "3.94 mil", "5 mil", "10 mil", "19.69 mil", "20 mil", "25 mil", "39.37 mil", "50 mil", "100 mil"])
  })

  test("the option values are the steps in mm, and the labels follow gridStepLabel", () => {
    const options = gridStepOptions("pcb", "mil")
    expect(options.map((o) => o.value)).toEqual([...PCB_GRID_STEPS])
    expect(options[1]?.label).toBe(gridStepLabel(0.1, "mil"))
  })

  test("the schematic takes no unit: its labels are always in inches", () => {
    expect(gridStepOptions("schematic").map((o) => o.label)).toEqual(["0.05 in", "0.1 in", "0.2 in"])
    expect(gridStepOptions("schematic").map((o) => o.value)).toEqual([...SHEET_GRID_STEPS])
  })
})

describe("grid style", () => {
  test("lines and dots swap", () => {
    expect(nextGridStyle("lines")).toBe("dots")
    expect(nextGridStyle("dots")).toBe("lines")
  })

  test("each document has its own style, and toggling one leaves the other and the input alone", () => {
    expect(INITIAL_GRID_STYLES).toEqual({ schematic: "lines", pcb: "lines" })
    const dotted = toggleGridStyle(INITIAL_GRID_STYLES, "pcb")
    expect(dotted).toEqual({ schematic: "lines", pcb: "dots" })
    expect(INITIAL_GRID_STYLES.pcb).toBe("lines")
    expect(toggleGridStyle(dotted, "pcb")).toEqual(INITIAL_GRID_STYLES)
  })
})

describe("grid step per document", () => {
  test("each document starts at its default and keeps its own step", () => {
    expect(INITIAL_GRID_STEPS).toEqual({ schematic: 0.1, pcb: 0.5 })
    const changed = setGridStep(INITIAL_GRID_STEPS, "pcb", 0.127)
    expect(changed).toEqual({ schematic: 0.1, pcb: 0.127 })
    expect(INITIAL_GRID_STEPS.pcb).toBe(0.5)
  })

  test("setting one view's step, in any order, leaves the other view's step as it was", () => {
    let steps = setGridStep(INITIAL_GRID_STEPS, "pcb", 0.254)
    steps = setGridStep(steps, "schematic", 0.2)
    expect([steps.pcb, steps.schematic]).toEqual([0.254, 0.2])
    expect(setGridStep(steps, "schematic", 0.05).pcb).toBe(0.254)
  })
})

describe("grid spacing at a chosen step", () => {
  test("the chosen step sets the spacing when it is 8 px or more", () => {
    expect(planGrid({ cx: 0, cy: 0, scale: 20 }, SIZE, 0.5)?.spacing).toBe(0.5)
    expect(planGrid({ cx: 0, cy: 0, scale: 20 }, SIZE, 1.27)?.spacing).toBe(1.27)
  })

  test("a closer step is stepped up by 5, up to 25 steps, then the grid is hidden", () => {
    expect(planGrid({ cx: 0, cy: 0, scale: 20 }, SIZE, 0.1)?.spacing).toBeCloseTo(0.5)
    expect(planGrid({ cx: 0, cy: 0, scale: 4 }, SIZE, 0.1)?.spacing).toBeCloseTo(2.5)
    expect(planGrid({ cx: 0, cy: 0, scale: 0.5 }, SIZE, 0.1)).toBeNull()
  })

  test("the lines are whole multiples of the spacing and cover the view", () => {
    const plan = planGrid({ cx: 0, cy: 0, scale: 20 }, SIZE, 1.27)
    expect(plan?.columns[0]).toBeLessThanOrEqual(-Math.floor(10 / 1.27))
    expect(plan?.columns.at(-1)).toBeGreaterThanOrEqual(Math.floor(10 / 1.27))
    expect(plan?.columns).toContain(0)
  })
})

describe("PCB grid painting", () => {
  const camera = { cx: 0, cy: 0, scale: 20 }

  test("lines: minor lines 30%, every fifth line 50%, at the chosen step", () => {
    const { ctx, records } = recorder()
    drawGrid(ctx, camera, SIZE, { step: 1, style: "lines" })
    const verticals = records.filter((r) => r.name === "moveTo" && r.args[1] === 0)
    const xs = verticals.map((r) => (r.args[0] as number) - 0.5).sort((a, b) => a - b)
    expect((xs[1] as number) - (xs[0] as number)).toBeCloseTo(20)
    const strong = verticals.filter((r) => r.style === FIFTH).map((r) => (r.args[0] as number) - 0.5 - 200)
    expect(strong).toContain(0)
    for (const x of strong) expect(Math.abs(x / 100 - Math.round(x / 100))).toBeLessThan(0.01)
    expect(verticals.filter((r) => r.style === MINOR).length).toBeGreaterThan(strong.length)
  })

  test("dots: 1px squares at the crossings, no lines, the 50% ones on fifth crossings only", () => {
    const { ctx, records } = recorder()
    drawGrid(ctx, camera, SIZE, { step: 1, style: "dots" })
    expect(records.some((r) => r.name === "moveTo" || r.name === "lineTo")).toBe(false)
    const squares = records.filter((r) => r.name === "rect")
    expect(squares.length).toBeGreaterThan(100)
    for (const s of squares) expect([s.args[2], s.args[3]]).toEqual([1, 1])
    expect(new Set(records.filter((r) => r.name === "fill").map((r) => r.style))).toEqual(new Set([MINOR, FIFTH]))
    const strong = records.filter((r) => r.name === "rect" && r.style === FIFTH)
    expect(strong.length).toBeGreaterThan(0)
    expect(strong.length).toBeLessThan(squares.length / 10)
    for (const s of strong) {
      expect(Math.abs((((s.args[0] as number) - 200) / 100) % 1)).toBeLessThan(0.01)
      expect(Math.abs((((s.args[1] as number) - 150) / 100) % 1)).toBeLessThan(0.01)
    }
  })

  test("dots: one square per crossing and one path per colour", () => {
    const { ctx, records } = recorder()
    drawGrid(ctx, camera, SIZE, { step: 1, style: "dots" })
    const plan = planGrid(camera, SIZE, 1)
    const squares = records.filter((r) => r.name === "rect")
    expect(squares).toHaveLength((plan?.columns.length ?? 0) * (plan?.rows.length ?? 0))
    expect(new Set(squares.map((s) => `${s.args[0]},${s.args[1]}`)).size).toBe(squares.length)
    expect(records.filter((r) => r.name === "beginPath")).toHaveLength(2)
    expect(records.filter((r) => r.name === "fill")).toHaveLength(2)
  })
})

describe("schematic grid painting", () => {
  const camera = { cx: 0, cy: 0, scale: 100 }

  test("the chosen step sets the line spacing", () => {
    const { ctx, records } = recorder()
    drawSchematicGrid(ctx, camera, SIZE, { step: 0.2, style: "lines" })
    const xs = records.filter((r) => r.name === "moveTo" && r.args[1] === 0).map((r) => r.args[0] as number).sort((a, b) => a - b)
    expect((xs[1] as number) - (xs[0] as number)).toBeCloseTo(20)
  })

  test("dots are 2 x 2 px squares in #D9D9D2, in one path (R20)", () => {
    const { ctx, records } = recorder()
    drawSchematicGrid(ctx, camera, SIZE, { step: 0.1, style: "dots" })
    expect(records.some((r) => r.name === "lineTo")).toBe(false)
    const squares = records.filter((r) => r.name === "rect")
    expect(squares.length).toBeGreaterThan(100)
    expect(SHEET_DOT_PX).toBe(2)
    for (const s of squares) expect([s.args[2], s.args[3], s.style]).toEqual([2, 2, "#D9D9D2"])
    expect(records.filter((r) => r.name === "fill").map((r) => r.style)).toEqual(["#D9D9D2"])
  })

  test("the lines stay #F0F0EB, the dots' darker tint is for dots only", () => {
    const { ctx, records } = recorder()
    drawSchematicGrid(ctx, camera, SIZE, { step: 0.1, style: "lines" })
    expect(new Set(records.filter((r) => r.name === "stroke").map((r) => r.style))).toEqual(new Set(["#F0F0EB"]))
    expect(schematicTheme.grid).toBe("#F0F0EB")
  })
})
