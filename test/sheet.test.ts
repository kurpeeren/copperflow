import { describe, expect, test } from "vitest"
import { MIN_ZONE_LABEL_PX, showZoneLabels, ZONE_TEXT } from "../studio/src/pcb/sheet-draw.js"
import { SHEET_MARGIN, SHEET_SIZES, sheetDate, sheetFor, titleBlock, zoneDividers, zoneLabels, ZONE_BAND } from "../studio/src/pcb/sheet.js"

const around = (w: number, h: number, x = 0, y = 0) => ({ minX: x, minY: y, maxX: x + w, maxY: y + h })
const VALUES = { project: "board", page: "Schematic", file: "a.circuit.ts", date: "2026-11-09", rev: "" }
const onGrid = (v: number) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9

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

  test.each(SHEET_SIZES.map((s) => [s.name, s.width - 1, s.height - 1] as const))("%s is chosen for a drawing that just fits", (name, w, h) => {
    expect(sheetFor(around(w - 0.001, h - 0.001)).size.name).toBe(name)
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

  test("labels run 1.. across the top and bottom and A.. down the sides", () => {
    const sheet = sheetFor(around(3, 2))
    const labels = zoneLabels(sheet)
    expect(labels).toHaveLength(2 * 6 + 2 * 4)
    const top = labels.filter((l) => l.y < sheet.inner.minY)
    expect(top.map((l) => l.text)).toEqual(["1", "2", "3", "4", "5", "6"])
    expect(labels.filter((l) => l.x < sheet.inner.minX).map((l) => l.text)).toEqual(["A", "B", "C", "D"])
    expect(labels.filter((l) => l.x > sheet.inner.maxX).map((l) => l.text)).toEqual(["A", "B", "C", "D"])
  })

  test("labels sit in the middle of the band and of their zone", () => {
    const sheet = sheetFor(around(3, 2))
    const first = zoneLabels(sheet)[0]
    expect(first?.y).toBeCloseTo(sheet.outer.minY + ZONE_BAND / 2)
    expect(first?.x).toBeCloseTo(sheet.inner.minX + (sheet.inner.maxX - sheet.inner.minX) / 12)
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

  test("it is 4.0 x 1.2 in the bottom-right corner of the inner line", () => {
    expect(block.box.maxX).toBeCloseTo(sheet.inner.maxX)
    expect(block.box.maxY).toBeCloseTo(sheet.inner.maxY)
    expect(block.box.maxX - block.box.minX).toBeCloseTo(4.0)
    expect(block.box.maxY - block.box.minY).toBeCloseTo(1.2)
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
