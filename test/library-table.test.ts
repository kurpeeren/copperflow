import { describe, expect, test } from "vitest"
import { PLACE_GAP_MS, allowPlace, clampActive, clickPlaces, filterRows, libraryRows, rowKey } from "../studio/src/library-table.js"
import type { PartsData } from "../studio/src/api.js"

const parts: PartsData = {
  library: [
    { id: "timer-1", title: "Timer IC", mpn: "NE555", footprint: "SOIC-8", component: "ic", verified: true, verifiedBy: "me" },
    { id: "x1", title: "Mystery part", footprint: "QFN-16", component: "ic", verified: false },
  ],
  builtin: ["resistor", "crystal", "connector"],
}

describe("library table rows", () => {
  const rows = libraryRows(parts)

  test("library parts come first with their stamp and title", () => {
    expect(rows[0]!).toMatchObject({ part: "timer-1", name: "NE555", value: "", footprint: "SOIC-8", description: "Timer IC", verified: "Verified", tooltip: "Timer IC (ic)", verifiedTip: "Checked by me" })
    expect(rows[1]!).toMatchObject({ part: "x1", name: "x1", verified: "Unverified", verifiedTip: "Not checked against the datasheet yet" })
  })

  test("built-ins take their starting value and footprint, with no stamp", () => {
    expect(rows[2]).toMatchObject({ part: "resistor", value: "10k", footprint: "0402", verified: "" })
    expect(rows[3]).toMatchObject({ part: "crystal", value: "16MHz", footprint: "hc49s" })
    expect(rows[4]).toMatchObject({ part: "connector", value: "", footprint: "" })
  })

  test("the filter looks in every column, ignoring case", () => {
    expect(filterRows(rows, "").length).toBe(5)
    expect(filterRows(rows, "SOIC").map((r) => r.part)).toEqual(["timer-1"])
    expect(filterRows(rows, "timer").map((r) => r.part)).toEqual(["timer-1"])
    expect(filterRows(rows, "16mhz").map((r) => r.part)).toEqual(["crystal"])
    expect(filterRows(rows, "unverified").map((r) => r.part)).toEqual(["x1"])
    expect(filterRows(rows, "verified").map((r) => r.part)).toEqual(["timer-1", "x1"])
    expect(filterRows(rows, "ne555").map((r) => r.part)).toEqual(["timer-1"])
    expect(filterRows(rows, "timer-1").map((r) => r.part)).toEqual(["timer-1"])
    expect(filterRows(rows, "ic").length).toBe(2)
    expect(filterRows(rows, "zzz")).toEqual([])
  })
})

describe("library table row keys", () => {
  test("arrows move and stop at the ends", () => {
    expect(rowKey("ArrowDown", 0, 3)).toEqual({ move: 1 })
    expect(rowKey("ArrowDown", 2, 3)).toEqual({ move: 2 })
    expect(rowKey("ArrowUp", 0, 3)).toEqual({ move: 0 })
    expect(rowKey("ArrowUp", 2, 3)).toEqual({ move: 1 })
    expect(rowKey("Home", 2, 3)).toEqual({ move: 0 })
    expect(rowKey("End", 0, 3)).toEqual({ move: 2 })
  })

  test("Enter places; other keys and empty tables do nothing", () => {
    expect(rowKey("Enter", 1, 3)).toEqual({ place: true })
    expect(rowKey("a", 1, 3)).toBeNull()
    expect(rowKey("Enter", 0, 0)).toBeNull()
  })
})

describe("one place per intent", () => {
  test("Enter held down does not repeat", () => {
    expect(rowKey("Enter", 0, 3, true)).toBeNull()
    expect(rowKey("Enter", 0, 3, false)).toEqual({ place: true })
  })

  test("a second request within the gap is dropped", () => {
    expect(allowPlace(null, 1000)).toBe(true)
    expect(allowPlace(1000, 1000 + PLACE_GAP_MS - 1)).toBe(false)
    expect(allowPlace(1000, 1000 + PLACE_GAP_MS)).toBe(true)
  })

  test("only the first click of a button sequence places", () => {
    expect(clickPlaces(0)).toBe(true)
    expect(clickPlaces(1)).toBe(true)
    expect(clickPlaces(2)).toBe(false)
  })

  test("the tab stop stays inside the rows", () => {
    expect(clampActive(5, 3)).toBe(2)
    expect(clampActive(1, 3)).toBe(1)
    expect(clampActive(2, 0)).toBe(0)
  })
})
