import { describe, expect, test } from "vitest"
import type { Point } from "../studio/src/pcb/geometry.js"
import { ALL_PICKABLE } from "../studio/src/pcb/pick-filter.js"
import { cornerHandleAt, draggedPath, followReshape, gripOf, handleReach, handleUnder, liveShapes, startReshape, withShapes, type WireDrag } from "../studio/src/pcb/wire-drag.js"
import { Selection } from "../studio/src/selection.js"

const p = (x: number, y: number): Point => ({ x, y })
// A U: up from (0.5, 0), across at y = 1, down to (2.5, 0).
const U = [p(0.5, 0), p(0.5, 1), p(2.5, 1), p(2.5, 0)]
// A Z: across from (0, 0), down at x = 1, across to (3, 2).
const Z = [p(0, 0), p(1, 0), p(1, 2), p(3, 2)]
const SNAP = { step: 0.1, snap: true }
const FREE = { step: 0.1, snap: false }

function tools(lines: Record<string, readonly Point[]>, blocked: Record<string, string> = {}): WireDrag & { commits: [string, readonly Point[]][] } {
  const commits: [string, readonly Point[]][] = []
  return {
    commits,
    points: (id) => lines[id],
    blocker: (id) => blocked[id] ?? null,
    commit: (id, path) => void commits.push([id, path]),
  }
}

describe("the path a drag gives", () => {
  test("a segment dragged with Snap on lands on a grid line, its neighbours stretching", () => {
    expect(draggedPath(U, { kind: "segment", index: 1 }, p(0.3, 0.53), SNAP)).toEqual([p(0.5, 0), p(0.5, 1.5), p(2.5, 1.5), p(2.5, 0)])
  })

  test("Snap puts the moved segment on the grid, not the distance moved: an off-grid segment snaps on a small move", () => {
    const off = [p(0, 0), p(0, 1.05), p(2, 1.05), p(2, 0)]
    expect(draggedPath(off, { kind: "segment", index: 1 }, p(0, 0.02), SNAP)).toEqual([p(0, 0), p(0, 1.1), p(2, 1.1), p(2, 0)])
  })

  test("with Snap off the segment goes where the pointer puts it, rounded to 4 decimals", () => {
    expect(draggedPath(U, { kind: "segment", index: 1 }, p(0, 0.533333), FREE)).toEqual([p(0.5, 0), p(0.5, 1.5333), p(2.5, 1.5333), p(2.5, 0)])
  })

  test("a segment touching an end of the wire gets a jog there, so the end stays on its pin", () => {
    expect(draggedPath(U, { kind: "segment", index: 0 }, p(-0.31, 0.2), SNAP)).toEqual([p(0.5, 0), p(0.2, 0), p(0.2, 1), p(2.5, 1), p(2.5, 0)])
  })

  test("a corner dragged with Snap on lands on a grid point; both its segments stay square", () => {
    expect(draggedPath(Z, { kind: "corner", index: 1 }, p(0.26, 0.04), SNAP)).toEqual([p(0, 0), p(1.3, 0), p(1.3, 2), p(3, 2)])
    expect(draggedPath(Z, { kind: "corner", index: 1 }, p(0.26, 0.37), SNAP)).toEqual([p(0, 0), p(0, 0.4), p(1.3, 0.4), p(1.3, 2), p(3, 2)])
  })

  test("a corner dragged with Snap off is only rounded", () => {
    expect(draggedPath(Z, { kind: "corner", index: 2 }, p(0.123456, 0), FREE)).toEqual([p(0, 0), p(1.1235, 0), p(1.1235, 2), p(3, 2)])
  })
})

describe("what a press grabs", () => {
  // At 10 px a unit, the wire reach is 6 px (0.6) and a handle's half side 3 px (0.3).
  const SCALE = 10

  test("the segment under the pointer, within the wire's reach", () => {
    expect(gripOf(U, p(1.5, 1.2), SCALE)).toEqual({ kind: "segment", index: 1 })
    expect(gripOf(U, p(0.6, 0.4), SCALE)).toEqual({ kind: "segment", index: 0 })
    expect(gripOf(U, p(1.5, 2), SCALE)).toBeUndefined()
  })

  test("the corner handle pressed, when there is one", () => {
    expect(gripOf(U, p(0.5, 1), SCALE, 1)).toEqual({ kind: "corner", index: 1 })
  })

  test("a corner handle is that of the selected wire only, within the handle's square", () => {
    const drag = tools({ "wire:A": U })
    expect(handleReach(SCALE)).toBeCloseTo(0.3)
    expect(cornerHandleAt(drag, "wire:A", p(2.7, 1.2), SCALE)).toEqual({ id: "wire:A", index: 2 })
    expect(cornerHandleAt(drag, "wire:A", p(2.9, 1), SCALE)).toBeUndefined()
    expect(cornerHandleAt(drag, "wire:A", p(0.5, 0), SCALE)).toBeUndefined()
    expect(cornerHandleAt(drag, undefined, p(2.5, 1), SCALE)).toBeUndefined()
    expect(cornerHandleAt(undefined, "wire:A", p(2.5, 1), SCALE)).toBeUndefined()
  })
})

describe("a reshape gesture", () => {
  const start = p(100, 100)

  test("starts from the wire's points as shown, with its blocker", () => {
    expect(startReshape(tools({ "wire:A": U }, { "wire:A": "R1 is locked" }), "wire:A", { kind: "segment", index: 1 }, start)).toEqual({
      kind: "reshape",
      wire: "wire:A",
      grip: { kind: "segment", index: 1 },
      points: U,
      path: U,
      start,
      moved: false,
      blocker: "R1 is locked",
    })
    expect(startReshape(tools({}), "wire:A", { kind: "segment", index: 1 }, start)).toBeUndefined()
  })

  test("follows the pointer from the points it started with", () => {
    const begun = startReshape(tools({ "wire:A": U }), "wire:A", { kind: "segment", index: 1 }, start)
    if (!begun) throw new Error("no gesture")
    const told: string[] = []
    const once = followReshape(begun, p(0, 0.33), SNAP, (text) => told.push(text))
    const twice = followReshape(once, p(0, 0.53), SNAP, (text) => told.push(text))
    expect(twice.path).toEqual([p(0.5, 0), p(0.5, 1.5), p(2.5, 1.5), p(2.5, 0)])
    expect(twice).toMatchObject({ moved: true, points: U })
    expect(told).toEqual([])
  })

  test("a blocked wire does not move; its reason is told once, on the first move", () => {
    const begun = startReshape(tools({ "wire:A": U }, { "wire:A": "R1 is locked" }), "wire:A", { kind: "segment", index: 1 }, start)
    if (!begun) throw new Error("no gesture")
    const told: string[] = []
    let gesture = begun
    for (const y of [0.2, 0.4, 0.6]) gesture = followReshape(gesture, p(0, y), SNAP, (text) => told.push(text))
    expect(told).toEqual(["R1 is locked"])
    expect(gesture.path).toEqual(U)
    expect(gesture.moved).toBe(true)
  })
})

describe("the selected wire's corner handle, as a pick", () => {
  const drag = tools({ "wire:A": U })
  const selected = Selection.none.onlyWire("wire:A")

  test("is found while wires may be picked", () => {
    expect(handleUnder(drag, { selection: selected, armed: null }, p(2.5, 1), 10)).toEqual({ id: "wire:A", index: 2 })
    expect(handleUnder(drag, { selection: Selection.none, armed: null }, p(2.5, 1), 10)).toBeUndefined()
  })

  test("is not, while the wire is selected with parts or other wires: handles are for a wire selected alone", () => {
    expect(handleUnder(drag, { selection: selected.add(["R1"]), armed: null }, p(2.5, 1), 10)).toBeUndefined()
    expect(handleUnder(drag, { selection: selected.addWires(["wire:B"]), armed: null }, p(2.5, 1), 10)).toBeUndefined()
  })

  test("is not, with Wires off in the Filter or the Note box or Fit area tool armed", () => {
    expect(handleUnder(drag, { selection: selected, armed: null, filter: { ...ALL_PICKABLE, wires: false } }, p(2.5, 1), 10)).toBeUndefined()
    expect(handleUnder(drag, { selection: selected, armed: "note" }, p(2.5, 1), 10)).toBeUndefined()
    expect(handleUnder(drag, { selection: selected, armed: "zoom" }, p(2.5, 1), 10)).toBeUndefined()
  })
})

describe("the shapes drawn in place of the wires' own", () => {
  const begun = startReshape(tools({ "wire:A": U, "wire:B": Z }), "wire:A", { kind: "segment", index: 1 }, p(0, 0))
  if (!begun) throw new Error("no gesture")
  const moved = followReshape(begun, p(0, 0.5), SNAP, () => undefined)
  const waiting = [{ id: "wire:A", points: Z }, { id: "wire:B", points: U }]

  test("the wire being dragged first, then those sent and waiting for their build", () => {
    expect(liveShapes(moved, waiting)).toEqual([{ id: "wire:A", points: moved.path }, { id: "wire:B", points: U }])
  })

  test("a press that has not moved, or a blocked drag, draws nothing new", () => {
    expect(liveShapes(begun, waiting)).toBe(waiting)
    expect(liveShapes({ ...moved, blocker: "R1 is locked" }, waiting)).toBe(waiting)
    expect(liveShapes(undefined, waiting)).toBe(waiting)
  })
})

describe("wires drawn in a shape waiting for its build", () => {
  test("take the new points; the others stay as they are", () => {
    const wires = [{ id: "a", points: U, net: "n" }, { id: "b", points: Z, net: "n" }]
    const shown = withShapes(wires, [{ id: "b", points: U }])
    expect(shown).toEqual([{ id: "a", points: U, net: "n" }, { id: "b", points: U, net: "n" }])
    expect(withShapes(wires, [])).toBe(wires)
  })
})
