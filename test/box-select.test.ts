import { describe, expect, test } from "vitest"
import { boxMode, boxSelection, partsInBox } from "../studio/src/pcb/box-select.js"
import type { PartBox } from "../studio/src/pcb/geometry.js"
import { Selection } from "../studio/src/selection.js"

const partBox = (name: string, minX: number, minY: number, maxX: number, maxY: number): PartBox => ({
  name,
  pcbComponentId: name,
  center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  box: { minX, minY, maxX, maxY },
})

// R1 inside the box (0,0)-(10,10); C1 half in; U1 outside; D1 exactly on the box's edge.
const BOXES = [partBox("R1", 2, 2, 4, 4), partBox("C1", 8, 8, 12, 12), partBox("U1", 20, 20, 22, 22), partBox("D1", 0, 0, 10, 10)]

describe("the selection box's direction", () => {
  test("dragged left to right it takes what is inside; right to left, what it touches", () => {
    expect(boxMode({ x: 10, y: 10 }, { x: 50, y: 40 })).toBe("inside")
    expect(boxMode({ x: 10, y: 40 }, { x: 50, y: 10 })).toBe("inside")
    expect(boxMode({ x: 50, y: 10 }, { x: 10, y: 40 })).toBe("touching")
    expect(boxMode({ x: 50, y: 40 }, { x: 10, y: 10 })).toBe("touching")
  })

  test("straight up or down counts as left to right", () => {
    expect(boxMode({ x: 10, y: 10 }, { x: 10, y: 40 })).toBe("inside")
  })
})

describe("the parts a box takes", () => {
  test("inside: only the parts wholly within it, edges included", () => {
    expect(partsInBox(BOXES, { x: 0, y: 0 }, { x: 10, y: 10 }, "inside")).toEqual(["R1", "D1"])
  })

  test("touching: every part it overlaps, even by an edge", () => {
    expect(partsInBox(BOXES, { x: 0, y: 0 }, { x: 10, y: 10 }, "touching")).toEqual(["R1", "C1", "D1"])
  })

  test("the corners may be given in any order", () => {
    expect(partsInBox(BOXES, { x: 10, y: 0 }, { x: 0, y: 10 }, "inside")).toEqual(["R1", "D1"])
    expect(partsInBox(BOXES, { x: 10, y: 10 }, { x: 0, y: 0 }, "touching")).toEqual(["R1", "C1", "D1"])
  })

  test("a box over nothing takes nothing", () => {
    expect(partsInBox(BOXES, { x: 30, y: 30 }, { x: 40, y: 40 }, "touching")).toEqual([])
  })
})

describe("the selection after a box", () => {
  const before = Selection.none.add(["U1"])

  test("without Shift or Ctrl it becomes just the parts in the box", () => {
    expect(boxSelection(["R1", "D1"], false)(before).names).toEqual(["R1", "D1"])
  })

  test("with Shift or Ctrl it adds them to what was selected", () => {
    expect(boxSelection(["R1", "U1"], true)(before).names).toEqual(["U1", "R1"])
  })

  test("an empty box without Shift or Ctrl clears the selection; with them it changes nothing", () => {
    expect(boxSelection([], false)(before)).toBe(Selection.none)
    expect(boxSelection([], true)(before)).toBe(before)
  })
})
