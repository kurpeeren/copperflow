import { describe, expect, test } from "vitest"
import { copperDragShapes, endCopperDrag, followCopperDrag, groupParts, startCopperDrag, startGroupDrag } from "../studio/src/pcb/copper-gesture.js"
import type { CopperRecords } from "../studio/src/pcb/copper-edits.js"

const p = (x: number, y: number) => ({ x, y })
const records = (locked: string[] = []): CopperRecords => ({
  tracks: [
    { id: "t0001", layer: "top", points: [p(0, 0), p(10, 0)], locked: locked.includes("t0001") },
    { id: "t0002", layer: "top", points: [p(10, 0), p(10, 10)], locked: locked.includes("t0002") },
  ],
  vias: [{ id: "v0001", at: p(10, 0), diameter: 0.6, locked: locked.includes("v0001") }],
})
const widths = { t0001: 0.25, t0002: 0.25 }
const noPad = () => false
const GRID = { step: 1, snap: true }
const SCALE = 10
const START = p(100, 100)

describe("a track's drag", () => {
  test("a press on a segment grabs it; the move gives the live path; the release one setTrack", () => {
    const drag = startCopperDrag({ kind: "track", id: "t0001" }, records(), { world: p(5, 0.1), point: START, scale: SCALE, sole: false, width: widths.t0001 })
    expect(drag).toMatchObject({ kind: "track", id: "t0001", grip: { kind: "segment", index: 0 }, moved: false, blocker: null })
    if (!drag) throw new Error("no drag")
    const moved = followCopperDrag(drag, p(0.2, 2.2), GRID, () => undefined)
    expect(moved.path).toEqual([p(0, 0), p(0, 2), p(10, 2), p(10, 0)])
    expect(copperDragShapes(moved, records(), noPad).tracks.get("t0001")).toEqual(moved.path)
    expect(endCopperDrag(moved, records(), noPad)).toEqual({
      edits: [{ kind: "setTrack", id: "t0001", points: [p(0, 0), p(0, 2), p(10, 2), p(10, 0)] }],
      summary: "Reshape track t0001",
      shapes: { tracks: new Map([["t0001", moved.path]]), vias: new Map() },
    })
  })

  test("a press off the track's segments grabs nothing", () => {
    expect(startCopperDrag({ kind: "track", id: "t0001" }, records(), { world: p(5, 5), point: START, scale: SCALE, sole: false, width: 0.25 })).toBeUndefined()
  })

  test("a locked track says why once, does not move, and writes nothing", () => {
    const told: string[] = []
    const drag = startCopperDrag({ kind: "track", id: "t0001" }, records(["t0001"]), { world: p(5, 0), point: START, scale: SCALE, sole: false, width: 0.25 })
    if (!drag) throw new Error("no drag")
    const once = followCopperDrag(drag, p(0, 2), GRID, (text) => told.push(text))
    const twice = followCopperDrag(once, p(0, 3), GRID, (text) => told.push(text))
    expect(told).toEqual(["t0001 is locked"])
    expect(twice.path).toBeUndefined()
    expect(endCopperDrag(twice, records(["t0001"]), noPad)).toBeUndefined()
  })

  test("a release that did not move writes nothing", () => {
    const drag = startCopperDrag({ kind: "track", id: "t0001" }, records(), { world: p(5, 0), point: START, scale: SCALE, sole: false, width: 0.25 })
    if (!drag) throw new Error("no drag")
    expect(endCopperDrag(drag, records(), noPad)).toBeUndefined()
  })
})

describe("a via's drag", () => {
  test("the via's centre lands on the grid, and the tracks on it follow, in one change", () => {
    const drag = startCopperDrag({ kind: "via", id: "v0001" }, records(), { world: p(10, 0), point: START, scale: SCALE, sole: true, width: 0 })
    if (!drag) throw new Error("no drag")
    const moved = followCopperDrag(drag, p(1.2, 0.9), GRID, () => undefined)
    expect(moved.offset).toEqual(p(1, 1))
    const end = endCopperDrag(moved, records(), noPad)
    expect(end).toMatchObject({
      summary: "Move via v0001 to (11, 1)",
      edits: [
        { kind: "setVia", id: "v0001", at: p(11, 1) },
        { kind: "setTrack", id: "t0001", points: [p(0, 0), p(11, 1)] },
        { kind: "setTrack", id: "t0002", points: [p(11, 1), p(10, 10)] },
      ],
    })
  })

  test("a via holding a locked track's end stays and says why at the release", () => {
    const drag = startCopperDrag({ kind: "via", id: "v0001" }, records(["t0002"]), { world: p(10, 0), point: START, scale: SCALE, sole: true, width: 0 })
    if (!drag) throw new Error("no drag")
    const moved = followCopperDrag(drag, p(1, 1), GRID, () => undefined)
    expect(endCopperDrag(moved, records(["t0002"]), noPad)).toEqual({ message: "v0001 has the locked track t0002 on it" })
  })
})

describe("a drag of parts and copper together", () => {
  test("pressed on copper, the offset is whole grid steps; the copper moves by it in one change, the parts are named for theirs", () => {
    const drag = startGroupDrag({ names: ["R1"], copper: ["v0001"], start: p(10, 0) })
    const moved = followCopperDrag(drag, p(1.3, -0.6), GRID, () => undefined)
    expect(moved.offset).toEqual(p(1, -1))
    expect(copperDragShapes(moved, records(), noPad).vias.get("v0001")).toEqual(p(11, -1))
    expect(groupParts(moved)).toEqual({ names: ["R1"], offset: p(1, -1) })
    const end = endCopperDrag(moved, records(), noPad)
    expect(end).toMatchObject({ summary: "Move v0001 by (1, -1)" })
    expect(end && "edits" in end ? end.edits.map((edit) => ("id" in edit ? edit.id : "")) : []).toEqual(["v0001", "t0001", "t0002"])
  })

  test("pressed on a part, the part's origin lands on the grid", () => {
    const drag = startGroupDrag({ names: ["R1"], copper: ["t0001"], start: p(0, 0), origin: p(0.25, 0) })
    expect(followCopperDrag(drag, p(1, 0), GRID, () => undefined).offset).toEqual(p(0.75, 0))
  })

  test("not moved, nothing is written for either", () => {
    const drag = startGroupDrag({ names: ["R1"], copper: ["v0001"], start: p(0, 0) })
    expect(groupParts(drag)).toBeUndefined()
    expect(endCopperDrag(drag, records(), noPad)).toBeUndefined()
  })
})
