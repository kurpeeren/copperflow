import { describe, expect, test } from "vitest"
import { filterRows, libraryRows, rowKey } from "../studio/src/library-table.js"
import type { PartsData } from "../studio/src/api.js"

const parts: PartsData = {
  library: [
    { id: "ne555", title: "Timer IC", mpn: "NE555", footprint: "SOIC-8", component: "ic", verified: true, verifiedBy: "me" },
    { id: "x1", title: "Mystery part", footprint: "QFN-16", component: "ic", verified: false },
  ],
  builtin: ["resistor", "crystal", "connector"],
}

describe("library table rows", () => {
  const rows = libraryRows(parts)

  test("library parts come first with their stamp and title", () => {
    expect(rows[0]!).toEqual({ part: "ne555", name: "ne555", value: "", footprint: "SOIC-8", description: "Timer IC", verified: "Verified" })
    expect(rows[1]!.verified).toBe("Not verified")
  })

  test("built-ins take their starting value and footprint, with no stamp", () => {
    expect(rows[2]).toMatchObject({ part: "resistor", value: "10k", footprint: "0402", verified: "" })
    expect(rows[3]).toMatchObject({ part: "crystal", value: "16MHz", footprint: "" })
    expect(rows[4]).toMatchObject({ part: "connector", value: "", footprint: "" })
  })

  test("the filter looks in every column, ignoring case", () => {
    expect(filterRows(rows, "").length).toBe(5)
    expect(filterRows(rows, "SOIC").map((r) => r.part)).toEqual(["ne555"])
    expect(filterRows(rows, "timer").map((r) => r.part)).toEqual(["ne555"])
    expect(filterRows(rows, "16mhz").map((r) => r.part)).toEqual(["crystal"])
    expect(filterRows(rows, "not verified").map((r) => r.part)).toEqual(["x1"])
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
