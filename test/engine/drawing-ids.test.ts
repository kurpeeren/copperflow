import { describe, expect, test } from "vitest"
import { drawingIds, drawingName } from "../../src/engine/drawing-ids.js"

describe("drawingName", () => {
  test("any non-empty string names a drawing; a bus needs a name that names its nets", () => {
    expect(drawingName("rect", "G1")).toBe("G1")
    expect(drawingName("text", "Power in")).toBe("Power in")
    expect(drawingName("bus", "D[0:7]")).toBe("D[0:7]")
    expect(drawingName("bus", "CLK")).toBe("CLK")
  })

  test("anything else leaves the drawing unnamed", () => {
    for (const value of ["", 5, true, undefined, null, { name: "G1" }]) expect(drawingName("rect", value)).toBeUndefined()
    expect(drawingName("bus", "D[3]")).toBeUndefined()
    expect(drawingName("bus", "two words")).toBeUndefined()
  })
})

describe("drawingIds", () => {
  test("a name is the id; an unnamed drawing gets its kind and its place among that kind's tags", () => {
    const ids = drawingIds(
      [
        { kind: "rect", name: undefined },
        { kind: "circle", name: undefined },
        { kind: "rect", name: "Box" },
        { kind: "rect", name: undefined },
      ],
      [],
    )
    expect(ids.map((d) => d.id)).toEqual(["drawing:rect:1", "drawing:circle:1", "Box", "drawing:rect:3"])
    expect(ids.every((d) => d.repeat === undefined)).toBe(true)
  })

  test("a repeated name gets ~2, ~3 in order, and a part keeps its name", () => {
    const ids = drawingIds(
      [
        { kind: "rect", name: "G1" },
        { kind: "circle", name: "G1" },
        { kind: "text", name: "R1" },
      ],
      ["R1"],
    )
    expect(ids).toEqual([
      { id: "G1", base: "G1" },
      { id: "G1~2", base: "G1", repeat: "duplicate" },
      { id: "R1~2", base: "R1", repeat: "duplicate" },
    ])
  })

  test("a bus repeating an earlier bus's name is a piece of it", () => {
    const ids = drawingIds(
      [
        { kind: "bus", name: "D[0:7]" },
        { kind: "bus", name: "D[0:7]" },
        { kind: "text", name: "D[0:7]" },
      ],
      [],
    )
    expect(ids.map((d) => [d.id, d.repeat])).toEqual([
      ["D[0:7]", undefined],
      ["D[0:7]~2", "piece"],
      ["D[0:7]~3", "duplicate"],
    ])
  })

  test("a bus named like a part is no piece, so its repeats are duplicates", () => {
    const ids = drawingIds(
      [
        { kind: "bus", name: "CLK" },
        { kind: "bus", name: "CLK" },
      ],
      ["CLK"],
    )
    expect(ids.map((d) => [d.id, d.repeat])).toEqual([
      ["CLK~2", "duplicate"],
      ["CLK~3", "duplicate"],
    ])
  })

  test("a numbered id skips one a name has taken", () => {
    const ids = drawingIds(
      [
        { kind: "rect", name: "G1~2" },
        { kind: "rect", name: "G1" },
        { kind: "rect", name: "G1" },
      ],
      [],
    )
    expect(ids.map((d) => d.id)).toEqual(["G1~2", "G1", "G1~3"])
  })
})
