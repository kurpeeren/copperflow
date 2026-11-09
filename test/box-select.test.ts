import { describe, expect, test } from "vitest"
import { boxMode, boxSelection, labelsInBox, partsInBox, wiresInBox } from "../studio/src/pcb/box-select.js"
import type { PartBox } from "../studio/src/pcb/geometry.js"
import { ALL_PICKABLE } from "../studio/src/pcb/pick-filter.js"
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

const p = (x: number, y: number) => ({ x, y })
// Against the box (0,0)-(10,10): IN lies wholly inside, EDGE on its edge, ACROSS crosses it with no point inside,
// HALF has one end inside, OUT runs beside it, SLANT (an old file's slanted segment) passes its corner without touching.
const WIRES = [
  { id: "IN", points: [p(1, 1), p(1, 5), p(6, 5)] },
  { id: "EDGE", points: [p(0, 10), p(10, 10)] },
  { id: "ACROSS", points: [p(-5, 3), p(15, 3)] },
  { id: "HALF", points: [p(5, 5), p(5, 15), p(20, 15)] },
  { id: "OUT", points: [p(-5, -1), p(15, -1)] },
  { id: "SLANT", points: [p(9, 12), p(12, 9)] },
]

describe("the wires a box takes", () => {
  test("left to right: only the wires wholly inside it, edges included", () => {
    expect(wiresInBox(WIRES, p(0, 0), p(10, 10), "inside")).toEqual(["IN", "EDGE"])
  })

  test("right to left: every wire it touches, by a point or across a segment", () => {
    expect(wiresInBox(WIRES, p(10, 10), p(0, 0), "touching")).toEqual(["IN", "EDGE", "ACROSS", "HALF"])
  })

  test("a slanted segment that only passes near the box is not touched; one through its corner is", () => {
    expect(wiresInBox([{ id: "THROUGH", points: [p(8, 12), p(12, 8)] }], p(0, 0), p(10, 10), "touching")).toEqual(["THROUGH"])
    expect(wiresInBox(WIRES.filter((wire) => wire.id === "SLANT"), p(0, 0), p(10, 10), "touching")).toEqual([])
  })
})

describe("the selection after a box", () => {
  const before = Selection.none.add(["U1"]).addWires(["OLD"])

  test("without Shift or Ctrl it becomes just the parts and wires in the box", () => {
    expect(boxSelection({ parts: ["R1", "D1"] }, false)(before)).toMatchObject({ names: ["R1", "D1"], wires: [] })
    expect(boxSelection({ parts: ["R1"], wires: ["IN", "EDGE"] }, false)(before)).toMatchObject({ names: ["R1"], wires: ["IN", "EDGE"] })
  })

  test("with Shift or Ctrl it adds them to what was selected", () => {
    expect(boxSelection({ parts: ["R1", "U1"], wires: ["IN", "OLD"] }, true)(before)).toMatchObject({ names: ["U1", "R1"], wires: ["OLD", "IN"] })
  })

  test("an empty box without Shift or Ctrl clears the selection; with them it changes nothing", () => {
    expect(boxSelection({ parts: [] }, false)(before)).toBe(Selection.none)
    expect(boxSelection({ parts: [], wires: [] }, true)(before)).toBe(before)
  })

  test("the Filter tab's Wires row off leaves the wires out, as Parts off leaves the parts", () => {
    const found = { parts: ["R1"], wires: ["IN"] }
    expect(boxSelection(found, false, null, undefined, { ...ALL_PICKABLE, wires: false })(before)).toMatchObject({ names: ["R1"], wires: [] })
    expect(boxSelection(found, false, null, undefined, { ...ALL_PICKABLE, parts: false })(before)).toMatchObject({ names: [], wires: ["IN"] })
  })
})

describe("the net labels and flags a box takes", () => {
  const LABELS = [
    { id: "label:IN", box: { minX: 1, minY: 1, maxX: 2, maxY: 1.2 } },
    { id: "label:HALF", box: { minX: 9, minY: 1, maxX: 11, maxY: 1.2 } },
    { id: "label:OUT", box: { minX: 20, minY: 20, maxX: 21, maxY: 20.2 } },
  ]

  test("left to right takes the labels wholly inside; right to left every label it touches", () => {
    expect(labelsInBox(LABELS, p(0, 0), p(10, 10), "inside")).toEqual(["label:IN"])
    expect(labelsInBox(LABELS, p(10, 10), p(0, 0), "touching")).toEqual(["label:IN", "label:HALF"])
  })

  test("the selection after a box holds its labels, added with Shift or Ctrl, left out while the Filter's labels row is off", () => {
    const before = Selection.none.addLabels(["label:OLD"])
    expect(boxSelection({ parts: ["R1"], labels: ["label:IN"] }, false)(before)).toMatchObject({ names: ["R1"], labels: ["label:IN"] })
    expect(boxSelection({ parts: [], labels: ["label:IN", "label:OLD"] }, true)(before).labels).toEqual(["label:OLD", "label:IN"])
    expect(boxSelection({ parts: ["R1"], labels: ["label:IN"] }, false, null, undefined, { ...ALL_PICKABLE, labels: false })(before)).toMatchObject({ names: ["R1"], labels: [] })
    expect(boxSelection({ parts: [], labels: ["label:IN"] }, false, "note")(before)).toBe(Selection.none)
  })
})
