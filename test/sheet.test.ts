import { describe, expect, test } from "vitest"
import { CANVAS_FONT_FAMILY } from "../studio/src/pcb/ctx.js"
import { drawSheetBorder, MIN_ZONE_LABEL_PX, showZoneLabels, ZONE_TEXT } from "../studio/src/pcb/sheet-draw.js"
import { drawingExtents } from "../studio/src/pcb/drawing-extents.js"
import { worldToScreen, type Box } from "../studio/src/pcb/geometry.js"
import { firstDrawing, keepSheet, SHEET_MARGIN, SHEET_SIZES, sheetArt, sheetDate, sheetFor, sheetHolds, titleBlock, zoneDividers, zoneLabels, ZONE_BAND } from "../studio/src/pcb/sheet.js"

const around = (w: number, h: number, x = 0, y = 0) => ({ minX: x, minY: y, maxX: x + w, maxY: y + h })
const VALUES = { project: "board", page: "Schematic", file: "a.circuit.ts", date: "2026-11-09", rev: "" }
const onGrid = (v: number) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9
const SCREEN = { width: 800, height: 600 }

/** Where a sheet's points land on screen with the sheet centred: y grows downwards there, as on the canvas. */
function onScreen(sheet: { outer: Box }) {
  const camera = { cx: (sheet.outer.minX + sheet.outer.maxX) / 2, cy: (sheet.outer.minY + sheet.outer.maxY) / 2, scale: 50 }
  const at = (x: number, y: number) => worldToScreen(camera, SCREEN, { x, y })
  /** A box's screen edges: top is the smaller y. */
  const edges = (box: Box) => ({ left: at(box.minX, 0).x, right: at(box.maxX, 0).x, top: at(0, box.maxY).y, bottom: at(0, box.minY).y })
  return { at, edges }
}

describe("sheetFor", () => {
  test("a small drawing gets A4", () => {
    expect(sheetFor(around(3, 2)).size.name).toBe("A4")
  })

  test("an empty sheet is A4 centred on the origin", () => {
    const sheet = sheetFor(undefined)
    expect(sheet.size.name).toBe("A4")
    expect(Math.abs((sheet.outer.minX + sheet.outer.maxX) / 2)).toBeLessThanOrEqual(0.05 + 1e-9)
  })

  test("the margin counts: A4 holds 10.69 x 7.27 and no more", () => {
    expect(sheetFor(around(11.69 - 2 * SHEET_MARGIN, 3)).size.name).toBe("A4")
    expect(sheetFor(around(11.7 - 2 * SHEET_MARGIN, 3)).size.name).toBe("A3")
    expect(sheetFor(around(3, 8.28 - 2 * SHEET_MARGIN)).size.name).toBe("A3")
  })

  test.each(SHEET_SIZES.map((s) => [s.name, s.width, s.height] as const))("%s is chosen for a wide and for a tall drawing that just fit", (name, w, h) => {
    expect(sheetFor(around(w - 2 * SHEET_MARGIN - 0.001, 3)).size.name).toBe(name)
    expect(sheetFor(around(3, h - 2 * SHEET_MARGIN - 0.001)).size.name).toBe(name)
  })

  test("a drawing larger than A0 still gets A0", () => {
    expect(sheetFor(around(60, 50)).size.name).toBe("A0")
  })

  test("the sheet is centred on the drawing, with its corner on the 0.1 grid", () => {
    const sheet = sheetFor(around(3, 2, 10.03, -4.07))
    expect(Math.abs((sheet.outer.minX + sheet.outer.maxX) / 2 - 11.53)).toBeLessThanOrEqual(0.05 + 1e-9)
    expect(Math.abs((sheet.outer.minY + sheet.outer.maxY) / 2 + 3.07)).toBeLessThanOrEqual(0.05 + 1e-9)
    expect(onGrid(sheet.outer.minX)).toBe(true)
    expect(onGrid(sheet.outer.minY)).toBe(true)
  })

  test("the sheet holds the drawing", () => {
    const e = around(10, 7, -3, 5)
    const { outer } = sheetFor(e)
    expect(outer.minX).toBeLessThanOrEqual(e.minX - SHEET_MARGIN + 0.05)
    expect(outer.maxX).toBeGreaterThanOrEqual(e.maxX + SHEET_MARGIN - 0.05)
  })

  test("the inner line is the band inside the outer one", () => {
    const { outer, inner } = sheetFor(around(3, 2))
    expect(inner.minX - outer.minX).toBeCloseTo(ZONE_BAND)
    expect(outer.maxY - inner.maxY).toBeCloseTo(ZONE_BAND)
  })
})

describe("zones", () => {
  test.each([
    ["A4", 6, 4],
    ["A3", 8, 6],
    ["A2", 12, 8],
    ["A1", 16, 12],
    ["A0", 24, 16],
  ])("%s has %i x %i zones", (name, across, down) => {
    const size = SHEET_SIZES.find((s) => s.name === name)
    expect(size && [size.zonesX, size.zonesY]).toEqual([across, down])
  })

  test("on screen, numbers run 1.. left to right in the top and the bottom band", () => {
    const sheet = sheetFor(around(3, 2))
    const { at, edges } = onScreen(sheet)
    const inner = edges(sheet.inner)
    const labels = zoneLabels(sheet).map((l) => ({ text: l.text, ...at(l.x, l.y) }))
    expect(labels).toHaveLength(2 * 6 + 2 * 4)
    const leftToRight = (row: typeof labels) => [...row].sort((a, b) => a.x - b.x).map((l) => l.text)
    expect(leftToRight(labels.filter((l) => l.y < inner.top))).toEqual(["1", "2", "3", "4", "5", "6"])
    expect(leftToRight(labels.filter((l) => l.y > inner.bottom))).toEqual(["1", "2", "3", "4", "5", "6"])
  })

  test("on screen, letters run A.. from the top down the left and the right side", () => {
    const sheet = sheetFor(around(3, 2))
    const { at, edges } = onScreen(sheet)
    const inner = edges(sheet.inner)
    const labels = zoneLabels(sheet).map((l) => ({ text: l.text, ...at(l.x, l.y) }))
    const topDown = (column: typeof labels) => [...column].sort((a, b) => a.y - b.y).map((l) => l.text)
    expect(topDown(labels.filter((l) => l.x < inner.left))).toEqual(["A", "B", "C", "D"])
    expect(topDown(labels.filter((l) => l.x > inner.right))).toEqual(["A", "B", "C", "D"])
    const zoneHeight = (inner.bottom - inner.top) / 4
    for (const a of labels.filter((l) => l.text === "A")) {
      expect(a.y).toBeGreaterThan(inner.top)
      expect(a.y).toBeLessThan(inner.top + zoneHeight)
    }
  })

  test("labels sit in the middle of the band and of their zone", () => {
    const sheet = sheetFor(around(3, 2))
    const first = zoneLabels(sheet)[0]
    expect(first?.text).toBe("1")
    expect(first?.y).toBeCloseTo(sheet.outer.maxY - ZONE_BAND / 2)
    expect(first?.x).toBeCloseTo(sheet.inner.minX + (sheet.inner.maxX - sheet.inner.minX) / 12)
    const a = zoneLabels(sheet).find((l) => l.text === "A")
    expect(a?.y).toBeCloseTo(sheet.inner.maxY - (sheet.inner.maxY - sheet.inner.minY) / 8)
    expect(a?.x).toBeCloseTo(sheet.outer.minX + ZONE_BAND / 2)
  })

  test("a large sheet labels up to 24 across and P down", () => {
    const labels = zoneLabels(sheetFor(around(40, 30)))
    expect(labels.some((l) => l.text === "P")).toBe(true)
    expect(labels.some((l) => l.text === "24")).toBe(true)
  })

  test("dividers split the inner line into equal zones", () => {
    const sheet = sheetFor(around(3, 2))
    const { xs, ys } = zoneDividers(sheet)
    expect(xs).toHaveLength(5)
    expect(ys).toHaveLength(3)
    expect(xs[0]).toBeCloseTo(sheet.inner.minX + (sheet.inner.maxX - sheet.inner.minX) / 6)
  })

  test("zone labels are skipped when they would draw under 6 px", () => {
    expect(showZoneLabels(MIN_ZONE_LABEL_PX / ZONE_TEXT)).toBe(true)
    expect(showZoneLabels(MIN_ZONE_LABEL_PX / ZONE_TEXT - 1)).toBe(false)
  })
})

describe("titleBlock", () => {
  const sheet = sheetFor(around(3, 2))
  const block = titleBlock(sheet, VALUES)

  test("on screen, it is 4.0 x 1.2 in the bottom-right corner of the inner line", () => {
    const { edges } = onScreen(sheet)
    const box = edges(block.box)
    const inner = edges(sheet.inner)
    expect(box.bottom).toBeCloseTo(inner.bottom)
    expect(box.right).toBeCloseTo(inner.right)
    expect(box.top).toBeGreaterThan((inner.top + inner.bottom) / 2)
    expect(block.box.maxX - block.box.minX).toBeCloseTo(4.0)
    expect(block.box.maxY - block.box.minY).toBeCloseTo(1.2)
  })

  test("on screen, its rows read Project, Page, File, Date and Rev from the top down", () => {
    const { edges } = onScreen(sheet)
    const labels = block.cells.filter((c) => c.kind === "label").map((c) => ({ text: c.text, top: edges(c.box).top }))
    expect([...labels].sort((a, b) => a.top - b.top).map((l) => l.text)).toEqual(["Project", "Page", "File", "Date", "Rev"])
    expect(labels[0]?.top).toBeCloseTo(edges(block.box).top)
  })

  test("it has five rows with the project, page, file, date and an empty Rev", () => {
    expect(block.cells.filter((c) => c.kind === "value").map((c) => c.text)).toEqual(["board", "Schematic", "a.circuit.ts", "2026-11-09", ""])
    expect(block.cells.filter((c) => c.kind === "label").map((c) => c.text)).toEqual(["Project", "Page", "File", "Date", "Rev"])
  })

  test("the cells tile the block without gaps", () => {
    const area = block.cells.reduce((sum, c) => sum + (c.box.maxX - c.box.minX) * (c.box.maxY - c.box.minY), 0)
    expect(area).toBeCloseTo(4.0 * 1.2)
    for (const c of block.cells) {
      expect(c.box.minX).toBeGreaterThanOrEqual(block.box.minX - 1e-9)
      expect(c.box.maxX).toBeLessThanOrEqual(block.box.maxX + 1e-9)
      expect(c.box.minY).toBeGreaterThanOrEqual(block.box.minY - 1e-9)
      expect(c.box.maxY).toBeLessThanOrEqual(block.box.maxY + 1e-9)
    }
  })
})

describe("sheetDate", () => {
  test("takes the day from an ISO time", () => {
    expect(sheetDate("2026-11-09T10:20:30.000Z")).toBe("2026-11-09")
  })

  test("is empty without a build or with a stray string", () => {
    expect(sheetDate(undefined)).toBe("")
    expect(sheetDate("yesterday")).toBe("")
  })
})

describe("sheet size boundary", () => {
  test("an exact fit stays on its size despite float noise", () => {
    const a4 = SHEET_SIZES[0]!
    expect(sheetFor(around(a4.width - 2 * SHEET_MARGIN + 1e-9, 3)).size.name).toBe("A4")
    expect(sheetFor(around(a4.width - 2 * SHEET_MARGIN + 1e-3, 3)).size.name).toBe("A3")
  })
})

describe("keepSheet", () => {
  test("the sheet is held while the drawing fits", () => {
    const first = sheetFor(around(3, 2))
    expect(keepSheet(first, around(3.4, 2.6, 0.2, 0.3))).toBe(first)
  })

  test("a part leaving the sheet re-chooses it", () => {
    const first = sheetFor(around(3, 2))
    const next = keepSheet(first, around(3, 2, 30, 0))
    expect(next).not.toBe(first)
    expect(sheetHolds(next, around(3, 2, 30, 0))).toBe(true)
  })

  test("a drawing that outgrows A4 gets A3", () => {
    const first = sheetFor(around(3, 2))
    expect(keepSheet(first, around(12, 5)).size.name).toBe("A3")
  })

  test("it never shrinks while open", () => {
    const big = sheetFor(around(12, 5))
    const small = keepSheet(big, around(3, 2, 100, 100))
    expect(small.size.name).toBe("A3")
  })

  test("a drawing under the title block, in the bottom-right corner, is not held", () => {
    const first = sheetFor(around(3, 2))
    const under = { minX: first.inner.maxX - 2, minY: first.inner.minY + 0.2, maxX: first.inner.maxX - 1, maxY: first.inner.minY + 0.5 }
    expect(sheetHolds(first, under)).toBe(false)
    expect(keepSheet(first, under)).not.toBe(first)
  })

  test("the top-right corner is free paper", () => {
    const first = sheetFor(around(3, 2))
    const corner = { minX: first.inner.maxX - 2, minY: first.inner.maxY - 1, maxX: first.inner.maxX - 1, maxY: first.inner.maxY - 0.6 }
    expect(sheetHolds(first, corner)).toBe(true)
    expect(keepSheet(first, corner)).toBe(first)
  })

  test("without a drawing the previous sheet stays, or an empty A4 appears", () => {
    const first = sheetFor(around(3, 2))
    expect(keepSheet(first, undefined)).toBe(first)
    expect(keepSheet(undefined, undefined).empty).toBe(true)
  })

  test("the first parts replace the empty placeholder", () => {
    const empty = keepSheet(undefined, undefined)
    const next = keepSheet(empty, around(3, 2, 40, 40))
    expect(next.empty).toBe(false)
    expect(sheetHolds(next, around(3, 2, 40, 40))).toBe(true)
    expect(firstDrawing(empty, next)).toBe(true)
    expect(firstDrawing(next, keepSheet(next, around(4, 2, 40, 40)))).toBe(false)
    expect(firstDrawing(undefined, next)).toBe(false)
  })
})

describe("drawingExtents", () => {
  const layout = (over: object) => ({ symbols: [], wires: [], labels: [], junctions: [], drawings: [], ...over }) as never

  test("an empty schematic has none", () => {
    expect(drawingExtents(layout({}))).toBeUndefined()
  })

  test("wires, junctions and labels count", () => {
    const e = drawingExtents(
      layout({
        wires: [{ id: "w", net: "n", points: [{ x: 1, y: 1 }, { x: 5, y: 1 }] }],
        junctions: [{ x: 2, y: -3 }],
        labels: [{ id: "l", net: "n", text: "GND", at: { x: 8, y: 6 }, side: "right", style: "ground" }],
      }),
    )
    expect(e).toBeDefined()
    expect(e!.minX).toBeLessThanOrEqual(1)
    expect(e!.minY).toBeLessThanOrEqual(-3)
    expect(e!.maxX).toBeGreaterThanOrEqual(8)
    expect(e!.maxY).toBeGreaterThanOrEqual(6)
  })

  const at = { groupOffset: { x: 0, y: 0 }, source: { file: "a.circuit.tsx", line: 1, column: 1, offset: 0 } }

  test("drawings count by their whole shape, lines by half their width beyond it", () => {
    const line = (strokeWidth: number) => ({ strokeWidth, lineStyle: "solid", ...at })
    const e = drawingExtents(
      layout({
        drawings: [
          { id: "G1", kind: "circle", x: 10, y: 10, radius: 2, filled: false, ...line(0.5) },
          { id: "G2", kind: "rect", x: -4, y: -5, width: 1, height: 1, filled: false, ...line(0) },
        ],
      }),
    )
    expect(e).toEqual({ minX: -4, minY: -5, maxX: 12.25, maxY: 12.25 })
  })

  test("texts and buses count by their shape alone", () => {
    const e = drawingExtents(
      layout({
        drawings: [
          { id: "T", kind: "text", x: 0, y: 0, text: "AB", fontSize: 0.5, anchor: "left", ...at },
          { id: "CLK", kind: "bus", name: "CLK", members: ["CLK"], points: [{ x: 0, y: -2 }, { x: 3, y: -2 }], ...at },
        ],
      }),
    )
    expect(e).toEqual({ minX: 0, minY: -2, maxX: 3, maxY: 0.25 })
  })
})

describe("drawSheetBorder", () => {
  /** A context that keeps every font set and every string drawn. */
  function textRecorder() {
    const fonts: string[] = []
    const texts: string[] = []
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_, name: string) => (name === "fillText" ? (value: string) => void texts.push(value) : () => undefined),
      set: (_, name: string, value: string) => {
        if (name === "font") fonts.push(value)
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    return { ctx, fonts, texts }
  }
  const sheet = sheetFor(around(3, 2))
  const art = sheetArt(sheet, VALUES)
  const camera = { cx: 0, cy: 0, scale: 100 }

  test("sets the font once per text size, in the canvas font family", () => {
    const { ctx, fonts, texts } = textRecorder()
    drawSheetBorder(ctx, camera, SCREEN, art, 1)
    expect(texts).toHaveLength(20 + 9)
    expect(fonts).toHaveLength(3)
    expect(new Set(fonts).size).toBe(3)
    for (const font of fonts) expect(font.endsWith(CANVAS_FONT_FAMILY)).toBe(true)
  })

  test("text too small to read is left out, and so is its font", () => {
    const { ctx, fonts, texts } = textRecorder()
    drawSheetBorder(ctx, { ...camera, scale: 10 }, SCREEN, art, 1)
    expect(texts).toHaveLength(0)
    expect(fonts).toHaveLength(0)
  })
})

describe("sheetArt", () => {
  test("holds the geometry built once", () => {
    const sheet = sheetFor(around(3, 2))
    const art = sheetArt(sheet, VALUES)
    expect(art.labels).toHaveLength(20)
    expect(art.block.cells).toHaveLength(10)
    expect(art.dividers.xs).toHaveLength(5)
  })
})
