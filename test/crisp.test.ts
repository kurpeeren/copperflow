import { describe, expect, test } from "vitest"
import { drawGrid, drawSelectionBox, PCB_LOOK } from "../studio/src/pcb/overlays.js"
import { drawSchematicGrid } from "../studio/src/pcb/schematic-grid.js"
import { atLeastOnePixel, baselineAt, hairlineAt, hairlineWidth, squareAt, squareSide, strokeBoxAt } from "../studio/src/pcb/crisp.js"
import { planGrid } from "../studio/src/pcb/grid.js"

const RATIOS = [1, 1.1, 1.25, 1.5, 2]
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9

describe("crisp lines", () => {
  test.each(RATIOS)("a hairline is one device pixel wide at ratio %s", (ratio) => {
    expect(hairlineWidth(ratio)).toBeCloseTo(1 / ratio, 12)
  })

  test.each(RATIOS)("every hairline centre is k + 0.5 device pixels at ratio %s", (ratio) => {
    for (let v = -20; v < 300; v += 0.37) {
      const device = hairlineAt(v, ratio) * ratio
      expect(close(device - Math.floor(device), 0.5)).toBe(true)
    }
  })

  test.each(RATIOS)("a small square starts on a device pixel and is whole device pixels wide at ratio %s", (ratio) => {
    for (let v = -20; v < 300; v += 0.37) {
      const start = squareAt(v, ratio) * ratio
      expect(close(start, Math.round(start))).toBe(true)
    }
    for (const css of [1, 2, 6]) {
      const side = squareSide(css, ratio) * ratio
      expect(side).toBeGreaterThanOrEqual(1)
      expect(close(side, Math.round(side))).toBe(true)
    }
  })

  test.each(RATIOS)("a baseline lands on a device pixel row at ratio %s", (ratio) => {
    const device = baselineAt(41.37, ratio) * ratio
    expect(close(device, Math.round(device))).toBe(true)
  })

  test("a world-scaled width never draws thinner than one device pixel", () => {
    expect(atLeastOnePixel(0.2, 1.25)).toBeCloseTo(0.8, 12)
    expect(atLeastOnePixel(3, 1.25)).toBe(3)
  })

  test("a stroked box has hairline edges on device pixel centres", () => {
    const box = strokeBoxAt({ x: 10.2, y: 20.7 }, { x: 60.4, y: 41.1 }, 1.25)
    for (const v of [box.x, box.y, box.x + box.width, box.y + box.height]) {
      const device = v * 1.25
      expect(close(device - Math.floor(device), 0.5)).toBe(true)
    }
  })
})

describe("grid plan at ratio 1.1", () => {
  test("every line the plan draws lands on a hairline centre", () => {
    const plan = planGrid({ cx: 0.3, cy: 0.1, scale: 37 }, { width: 400, height: 300 }, 0.1)
    expect(plan).not.toBeNull()
    for (const i of plan?.columns ?? []) {
      const device = hairlineAt(200 + (i * (plan?.spacing ?? 0) - 0.3) * 37, 1.1) * 1.1
      expect(close(device - Math.floor(device), 0.5)).toBe(true)
    }
  })
})

describe("painters at ratio 1.1", () => {
  const RATIO = 1.1
  const size = { width: 400, height: 300 }
  const record = () => {
    const calls: { name: string; args: number[] }[] = []
    const set: Record<string, unknown> = {}
    const ctx = new Proxy(set, {
      get: (target, name: string) => (name in target ? target[name] : (...args: number[]) => void calls.push({ name, args })),
      set: (target, name: string, value) => ((target[name] = value), true),
    }) as unknown as CanvasRenderingContext2D
    return { ctx, calls, set }
  }
  const onCentre = (v: number) => close(((v * RATIO) % 1 + 1) % 1, 0.5)

  test("grid lines are one device pixel wide and sit on device pixel centres", () => {
    const { ctx, calls, set } = record()
    drawGrid(ctx, { cx: 0.3, cy: 0.1, scale: 37 }, size, { step: 0.1, style: "lines" }, RATIO)
    expect(set.lineWidth).toBeCloseTo(1 / RATIO, 12)
    const starts = calls.filter((c) => c.name === "moveTo")
    expect(starts.length).toBeGreaterThan(10)
    for (const c of starts) expect(c.args[1] === 0 ? onCentre(c.args[0] as number) : onCentre(c.args[1] as number)).toBe(true)
  })

  test("grid dots are whole device pixels on device pixel edges", () => {
    const { ctx, calls } = record()
    drawSchematicGrid(ctx, { cx: 0.3, cy: 0.1, scale: 100 }, size, { step: 0.1, style: "dots" }, RATIO)
    const squares = calls.filter((c) => c.name === "rect")
    expect(squares.length).toBeGreaterThan(100)
    for (const s of squares) {
      for (const v of [s.args[0], s.args[1], s.args[2], s.args[3]] as number[]) expect(close(v * RATIO, Math.round(v * RATIO))).toBe(true)
    }
  })

  test("the selection box edges are on device pixel centres", () => {
    const { ctx, calls } = record()
    drawSelectionBox(ctx, { x: 10.2, y: 20.7 }, { x: 60.4, y: 41.1 }, PCB_LOOK, "inside", RATIO)
    const stroke = calls.find((c) => c.name === "strokeRect")
    expect(stroke).toBeDefined()
    const [x, y, w, h] = stroke?.args as number[]
    for (const v of [x, y, (x as number) + (w as number), (y as number) + (h as number)]) expect(onCentre(v as number)).toBe(true)
  })
})
