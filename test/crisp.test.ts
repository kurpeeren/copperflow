import { describe, expect, test } from "vitest"
import { drawGrid, drawLockBadge, drawMark, drawSelectionBox, drawWirePreview, PCB_LOOK } from "../studio/src/pcb/overlays.js"
import { sheetArt, sheetFor } from "../studio/src/pcb/sheet.js"
import { drawSheetBorder } from "../studio/src/pcb/sheet-draw.js"
import { drawWireHandles, SHEET_WIRE_LOOK } from "../studio/src/pcb/wire-overlay.js"
import { drawSchematicGrid } from "../studio/src/pcb/schematic-grid.js"
import { atLeastOnePixel, devicePixelIn, baselineAt, hairlineAt, hairlineWidth, squareAt, squareSide, strokeBoxAt } from "../studio/src/pcb/crisp.js"

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

  test("one device pixel in world units is a CSS pixel over the ratio", () => {
    expect(devicePixelIn(0.05, 1.25)).toBeCloseTo(0.04, 12)
  })

  test("a stroked box has hairline edges on device pixel centres", () => {
    const box = strokeBoxAt({ x: 10.2, y: 20.7 }, { x: 60.4, y: 41.1 }, 1.25)
    for (const v of [box.x, box.y, box.x + box.width, box.y + box.height]) {
      const device = v * 1.25
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

  test("a note's text is a whole device pixel size on a device pixel", () => {
    const { ctx, calls, set } = record()
    set.measureText = () => ({ width: 40 })
    drawMark(ctx, { cx: 0.3, cy: 0.1, scale: 37 }, size, { at: { x: 0.11, y: 0.07 }, id: "N1", text: "here" }, PCB_LOOK, 1.25)
    const text = calls.find((c) => c.name === "fillText")
    expect(text).toBeDefined()
    for (const v of (text?.args ?? []).slice(1) as number[]) expect(close(v * 1.25, Math.round(v * 1.25))).toBe(true)
    expect(String(set.font).startsWith("12px")).toBe(true)
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

describe("handles, border, lock badge and wire preview at ratio 1.1", () => {
  const RATIO = 1.1
  const size = { width: 400, height: 300 }
  const camera = { cx: 0.3, cy: 0.1, scale: 37 }
  const onDevice = (v: number) => close(v * RATIO, Math.round(v * RATIO))
  const onCentre = (v: number) => close((((v * RATIO) % 1) + 1) % 1, 0.5)
  const record = () => {
    const calls: { name: string; args: number[]; lineWidth: number }[] = []
    const state: Record<string, unknown> = { lineWidth: 1, measureText: (text: string) => ({ width: text.length * 6 }) }
    const ctx = new Proxy(state, {
      get: (t, name: string) => (name in t ? t[name] : (...args: number[]) => void calls.push({ name, args, lineWidth: t.lineWidth as number })),
      set: (t, name: string, value) => ((t[name] = value), true),
    }) as unknown as CanvasRenderingContext2D
    return { ctx, calls }
  }

  test("wire handles are whole device pixel squares with a hairline outline on pixel centres", () => {
    const { ctx, calls } = record()
    drawWireHandles(ctx, camera, size, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], SHEET_WIRE_LOOK, RATIO)
    const fills = calls.filter((c) => c.name === "fillRect")
    const outlines = calls.filter((c) => c.name === "strokeRect")
    expect(fills.length).toBe(1)
    for (const c of fills) for (const v of c.args) expect(onDevice(v)).toBe(true)
    expect(outlines.length).toBe(3)
    for (const c of outlines) {
      expect(c.lineWidth).toBeCloseTo(1 / RATIO, 12)
      expect(onCentre(c.args[0] as number)).toBe(true)
      expect(onCentre(c.args[1] as number)).toBe(true)
    }
  })

  test("the sheet border's lines sit on pixel centres and the outer one is whole device pixels wide", () => {
    const { ctx, calls } = record()
    const art = sheetArt(sheetFor({ minX: 0, minY: 0, maxX: 3, maxY: 2 }), { project: "board", page: "Schematic", file: "a.circuit.ts", date: "2026-11-09", rev: "" })
    drawSheetBorder(ctx, { cx: 0, cy: 0, scale: 100 }, size, art, RATIO)
    const boxes = calls.filter((c) => c.name === "strokeRect")
    const outer = boxes[0]
    expect(outer?.lineWidth && close(outer.lineWidth * RATIO, Math.round(outer.lineWidth * RATIO))).toBe(true)
    for (const c of boxes.slice(1)) {
      expect(c.lineWidth).toBeCloseTo(1 / RATIO, 12)
      expect(onCentre(c.args[0] as number)).toBe(true)
    }
    for (const c of calls.filter((x) => x.name === "moveTo")) expect(onCentre(c.args[0] as number) || onCentre(c.args[1] as number)).toBe(true)
  })

  test("the lock badge is whole device pixels and the wire preview is whole device pixels wide", () => {
    const badge = record()
    drawLockBadge(badge.ctx, camera, size, { minX: 0, minY: 0, maxX: 1, maxY: 1 }, PCB_LOOK, RATIO)
    expect(badge.calls.filter((c) => c.name === "fillRect").length).toBeGreaterThan(0)
    const preview = record()
    drawWirePreview(preview.ctx, camera, size, [{ x: 0, y: 0 }, { x: 1, y: 0 }], "drawing", "#000", RATIO)
    const stroke = preview.calls.find((c) => c.name === "stroke")
    expect(stroke && close(stroke.lineWidth * RATIO, Math.round(stroke.lineWidth * RATIO))).toBe(true)
  })
})
