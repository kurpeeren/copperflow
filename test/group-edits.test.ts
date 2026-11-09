import { describe, expect, test } from "vitest"
import type { PartInfo } from "../src/core/types.js"
import { anchorLookup, inView, lockChange, moveEach, nudgeOffset, nudgePlan, rotateAbout, rotatePlan, selectionCentre, turnedAbout, nameList, removeEach, removeQuestion, rotateEach, sendGroupEdit, skippedNote, type GroupEditActions } from "../studio/src/pcb/group-edits.js"
import { moveBlocker, ZERO, type Anchor, type SourceCircuit, type View } from "../studio/src/pcb/positions.js"

const prop = (literal: string | number) => ({ literal, source: JSON.stringify(literal), editable: true })

function part(name: string, props: PartInfo["props"] = {}, extra: Partial<PartInfo> = {}): PartInfo {
  return { name, tag: "resistor", line: 1, props, editable: true, start: 0, end: 0, ...extra }
}

const circuit: SourceCircuit = {
  model: {
    parts: [
      part("R1", { pcbRotation: prop(90), schRotation: prop(270) }),
      part("R2"),
      part("C1", { pcbRotation: prop(270) }),
      part("U1", {}, { editable: false, readonlyReason: "inside a callback" }),
      part("D1", { pcbRotation: prop("quarter") }),
    ],
    traces: [],
    skipped: [],
    imports: [],
  },
}

const blockers = (locked: string[], view: View = "pcb") => (name: string) => moveBlocker(circuit, new Set(locked), name, view)

describe("rotateEach", () => {
  test("turns every part a quarter turn in place, in one change", () => {
    const plan = rotateEach(circuit, ["R1", "R2", "C1"], "pcb", blockers([]))
    expect(plan.edits).toEqual([
      { kind: "setProps", part: "R1", props: { pcbRotation: 180 } },
      { kind: "setProps", part: "R2", props: { pcbRotation: 90 } },
      { kind: "setProps", part: "C1", props: { pcbRotation: 0 } },
    ])
    expect(plan.summary).toBe("rotate R1, R2 and C1 by 90°")
    expect(plan.skipped).toEqual([])
  })

  test("in the schematic it turns the schematic rotation", () => {
    const plan = rotateEach(circuit, ["R1", "R2"], "schematic", blockers([], "schematic"))
    expect(plan.edits).toEqual([
      { kind: "setProps", part: "R1", props: { schRotation: 0 } },
      { kind: "setProps", part: "R2", props: { schRotation: 90 } },
    ])
    expect(plan.summary).toBe("rotate R1 and R2 in the schematic by 90°")
  })

  test("one part keeps today's summary", () => {
    expect(rotateEach(circuit, ["R1"], "pcb", blockers([])).summary).toBe("rotate R1 to 180°")
    expect(rotateEach(circuit, ["R1"], "schematic", blockers([], "schematic")).summary).toBe("rotate R1 in the schematic to 0°")
  })

  test("locked and read-only parts are left out and named, as a single rotate refuses them", () => {
    const plan = rotateEach(circuit, ["R1", "R2", "U1"], "pcb", blockers(["R2"]))
    expect(plan.parts).toEqual(["R1"])
    expect(plan.skipped).toEqual(["R2 is locked", "U1 is read-only (inside a callback)"])
    expect(plan.summary).toBe("rotate R1 to 180°")
  })

  test("a rotation that is not a number is left out with its reason", () => {
    const plan = rotateEach(circuit, ["D1", "R2"], "pcb", () => null)
    expect(plan.parts).toEqual(["R2"])
    expect(plan.skipped).toEqual(["D1.pcbRotation is not a number"])
  })
})

describe("removeEach", () => {
  test("removes every part, one edit each, in one change", () => {
    const plan = removeEach(["R1", "R2", "C1"], blockers([]))
    expect(plan.edits).toEqual([
      { kind: "removePart", part: "R1" },
      { kind: "removePart", part: "R2" },
      { kind: "removePart", part: "C1" },
    ])
    expect(plan.summary).toBe("remove R1, R2 and C1")
  })

  test("one part keeps today's summary", () => {
    expect(removeEach(["R2"], blockers([]))).toEqual({ edits: [{ kind: "removePart", part: "R2" }], summary: "remove R2", parts: ["R2"], skipped: [], done: "removed" })
  })

  test("locked parts stay, and are named", () => {
    const plan = removeEach(["R1", "R2"], blockers(["R1"]))
    expect(plan.edits).toEqual([{ kind: "removePart", part: "R2" }])
    expect(plan.skipped).toEqual(["R1 is locked"])
  })

  test("the question names the parts", () => {
    expect(removeQuestion(["R1"])).toBe("Remove R1 and its connections?")
    expect(removeQuestion(["R1", "R2", "C1"])).toBe("Remove 3 parts (R1, R2 and C1) and their connections?")
  })
})

describe("skippedNote", () => {
  test("says nothing when every part was done", () => {
    expect(skippedNote(removeEach(["R1"], blockers([])))).toBeUndefined()
  })

  test("with nothing done it is the reason alone, as for one part today", () => {
    expect(skippedNote(removeEach(["R1"], blockers(["R1"])))).toBe("R1 is locked")
    expect(skippedNote(removeEach(["R1", "R2"], blockers(["R1", "R2"])))).toBe("R1 is locked; R2 is locked")
  })

  test("with some done it names the ones left out and what was not done to them", () => {
    expect(skippedNote(removeEach(["R1", "R2"], blockers(["R1"])))).toBe("Not removed: R1 is locked")
    expect(skippedNote(rotateEach(circuit, ["R1", "R2"], "pcb", blockers(["R1"])))).toBe("Not rotated: R1 is locked")
  })
})

describe("lockChange", () => {
  test("locks every selected part not locked yet, in one call", () => {
    expect(lockChange(["R1", "R2", "C1"], new Set(["R2"]), true)).toEqual({ parts: ["R1", "C1"] })
  })

  test("unlocks the locked ones", () => {
    expect(lockChange(["R1", "R2", "C1"], new Set(["R2", "C1"]), false)).toEqual({ parts: ["R2", "C1"] })
  })

  test("says so when there is nothing to change", () => {
    expect(lockChange(["R1"], new Set(["R1"]), true)).toEqual({ message: "R1 is already locked." })
    expect(lockChange(["R1", "R2"], new Set(), false)).toEqual({ message: "R1 and R2 are not locked." })
    expect(lockChange([], new Set(), true)).toEqual({ message: "Select a part first." })
  })

  test("locks again a locked part that was changed outside the editor, which accepts the change (the banner's remedy)", () => {
    expect(lockChange(["R1", "R2", "C1"], new Set(["R1", "R2"]), true, new Set(["R1"]))).toEqual({ parts: ["R1", "C1"] })
    expect(lockChange(["R1"], new Set(["R1"]), true, new Set(["R1"]))).toEqual({ parts: ["R1"] })
  })

  test("a locked part with no outside change is still already locked; Unlock ignores outside changes", () => {
    expect(lockChange(["R2"], new Set(["R1", "R2"]), true, new Set(["R1"]))).toEqual({ message: "R2 is already locked." })
    expect(lockChange(["R1", "C1"], new Set(["R1"]), false, new Set(["R1"]))).toEqual({ parts: ["R1"] })
  })
})

describe("sendGroupEdit", () => {
  function recorder(result: boolean) {
    const calls: string[] = []
    const actions: GroupEditActions = {
      edit: async (edits, summary) => {
        calls.push(`edit ${edits.length}: ${summary}`)
        return result
      },
      notify: (text) => void calls.push(`notify ${text}`),
    }
    return { calls, actions }
  }

  test("sends the edits as one change and names the parts left out once it has gone through", async () => {
    const { calls, actions } = recorder(true)
    expect(await sendGroupEdit(removeEach(["R1", "R2"], blockers(["R1"])), actions)).toBe(true)
    expect(calls).toEqual(["edit 1: remove R2", "notify Not removed: R1 is locked"])
  })

  test("a failed edit keeps its own message: the parts left out are not told over it", async () => {
    const { calls, actions } = recorder(false)
    expect(await sendGroupEdit(removeEach(["R1", "R2"], blockers(["R1"])), actions)).toBe(false)
    expect(calls).toEqual(["edit 1: remove R2"])
  })

  test("with nothing to send it only gives the reasons", async () => {
    const { calls, actions } = recorder(true)
    expect(await sendGroupEdit(rotateEach(circuit, ["R1"], "pcb", blockers(["R1"])), actions)).toBe(false)
    expect(calls).toEqual(["notify R1 is locked"])
  })

  test("says nothing more when every part was done", async () => {
    const { calls, actions } = recorder(true)
    await sendGroupEdit(rotateEach(circuit, ["R2"], "pcb", blockers([])), actions)
    expect(calls).toEqual(["edit 1: rotate R2 to 90°"])
  })
})

describe("nameList", () => {
  test("names up to three parts and counts the rest", () => {
    expect(nameList(["R1"])).toBe("R1")
    expect(nameList(["R1", "R2"])).toBe("R1 and R2")
    expect(nameList(["R1", "R2", "C1"])).toBe("R1, R2 and C1")
    expect(nameList(["R1", "R2", "C1", "C2", "C3"])).toBe("R1, R2, C1 and 2 more")
  })
})

describe("moveEach", () => {
  const placed: SourceCircuit = {
    model: {
      parts: [
        part("R1", { pcbX: prop(1), pcbY: prop(2), schX: prop(3), schY: prop(4) }),
        part("R2", { pcbX: prop(-1), pcbY: prop(0) }),
        part("C1"),
        part("U1", {}, { editable: false, readonlyReason: "inside a callback" }),
      ],
      traces: [],
      skipped: [],
      imports: [],
    },
  }
  const anchors: Record<string, Pick<Anchor, "origin" | "group">> = {
    R1: { origin: { x: 1, y: 2 }, group: ZERO },
    R2: { origin: { x: -1, y: 0 }, group: ZERO },
    // No literal position: where it sits, less what its group adds.
    C1: { origin: { x: 5, y: 5 }, group: { x: 1, y: 0 } },
    U1: { origin: { x: 0, y: 0 }, group: ZERO },
  }
  const anchorOf = (name: string) => anchors[name] ?? { origin: ZERO, group: ZERO }
  const movers = (locked: string[], view: View = "pcb") => (name: string) => moveBlocker(placed, new Set(locked), name, view)
  const by = { x: 0.5, y: -1 }

  test("moves every part by the same offset, as one change", () => {
    const plan = moveEach(placed, ["R1", "R2", "C1"], "pcb", anchorOf, by, movers([]))
    expect(plan.edits).toEqual([
      { kind: "setProps", part: "R1", props: { pcbX: 1.5, pcbY: 1 } },
      { kind: "setProps", part: "R2", props: { pcbX: -0.5, pcbY: -1 } },
      { kind: "setProps", part: "C1", props: { pcbX: 4.5, pcbY: 4 } },
    ])
    expect(plan.summary).toBe("move R1, R2 and C1 by (0.5, -1)")
    expect(plan.parts).toEqual(["R1", "R2", "C1"])
    expect(plan.skipped).toEqual([])
  })

  test("in the schematic it writes the schematic position", () => {
    const plan = moveEach(placed, ["R1", "C1"], "schematic", anchorOf, by, movers([], "schematic"))
    expect(plan.edits).toEqual([
      { kind: "setProps", part: "R1", props: { schX: 3.5, schY: 3 } },
      { kind: "setProps", part: "C1", props: { schX: 4.5, schY: 4 } },
    ])
    expect(plan.summary).toBe("move R1 and C1 in the schematic by (0.5, -1)")
  })

  test("one part keeps the summary a single drag writes", () => {
    expect(moveEach(placed, ["R1"], "pcb", anchorOf, by, movers([])).summary).toBe("move R1 to (1.5, 1)")
    expect(moveEach(placed, ["R1"], "schematic", anchorOf, by, movers([], "schematic")).summary).toBe("move R1 in the schematic to (3.5, 3)")
  })

  test("locked and read-only parts stay where they are and are named", () => {
    const plan = moveEach(placed, ["R1", "U1", "R2"], "pcb", anchorOf, by, movers(["R2"]))
    expect(plan.edits).toEqual([{ kind: "setProps", part: "R1", props: { pcbX: 1.5, pcbY: 1 } }])
    expect(plan.parts).toEqual(["R1"])
    expect(plan.skipped).toEqual(["U1 is read-only (inside a callback)", "R2 is locked"])
    expect(skippedNote(plan)).toBe("Not moved: U1 is read-only (inside a callback); R2 is locked")
  })

  test("with every part locked nothing is sent and the reason is today's message", () => {
    const plan = moveEach(placed, ["R1"], "pcb", anchorOf, by, movers(["R1"]))
    expect(plan.edits).toEqual([])
    expect(skippedNote(plan)).toBe("R1 is locked")
  })

  test("positions are written to 4 decimals", () => {
    const plan = moveEach(placed, ["R1"], "pcb", anchorOf, { x: 0.1 + 0.2, y: 0.0508 }, movers([]))
    expect(plan.edits).toEqual([{ kind: "setProps", part: "R1", props: { pcbX: 1.3, pcbY: 2.0508 } }])
  })

  test("the group goes to the server in one edit call, then names the parts left out", async () => {
    const calls: string[] = []
    const actions: GroupEditActions = {
      edit: async (edits, summary) => {
        calls.push(`edit ${edits.length}: ${summary}`)
        return true
      },
      notify: (text) => void calls.push(`notify ${text}`),
    }
    await sendGroupEdit(moveEach(placed, ["R1", "R2", "C1", "U1"], "pcb", anchorOf, by, movers([])), actions)
    expect(calls).toEqual(["edit 3: move R1, R2 and C1 by (0.5, -1)", "notify Not moved: U1 is read-only (inside a callback)"])
  })
})

const anchorsAt = (points: Record<string, [number, number]>) => (name: string): Pick<Anchor, "origin" | "group"> => ({
  origin: { x: points[name]?.[0] ?? 0, y: points[name]?.[1] ?? 0 },
  group: ZERO,
})

describe("nudgeOffset", () => {
  test("is the step times the count along the direction, rounded", () => {
    expect(nudgeOffset({ dx: 1, dy: 0 }, 0.5, 1)).toEqual({ x: 0.5, y: 0 })
    expect(nudgeOffset({ dx: 0, dy: -1 }, 0.0508, 10)).toEqual({ x: 0, y: -0.508 })
    expect(nudgeOffset({ dx: 0, dy: 1 }, 0.1, 3)).toEqual({ x: 0, y: 0.3 })
  })

  test("moves the whole selection in one change and leaves a locked part, named", () => {
    const where = anchorsAt({ R1: [1, 1], R2: [3, 1], C1: [5, 5] })
    const plan = moveEach(circuit, ["R1", "R2", "C1"], "pcb", where, nudgeOffset({ dx: 1, dy: 0 }, 0.5, 10), blockers(["R2"]))
    expect(plan.parts).toEqual(["R1", "C1"])
    expect(plan.edits).toEqual([
      { kind: "setProps", part: "R1", props: { pcbX: 6, pcbY: 1 } },
      { kind: "setProps", part: "C1", props: { pcbX: 10, pcbY: 5 } },
    ])
    expect(plan.skipped).toEqual(["R2 is locked"])
    expect(skippedNote(plan)).toBe("Not moved: R2 is locked")
  })

  test("a locked part alone is refused with its reason", () => {
    const plan = moveEach(circuit, ["R1"], "pcb", anchorsAt({ R1: [1, 1] }), nudgeOffset({ dx: 0, dy: 1 }, 0.5, 1), blockers(["R1"]))
    expect(plan.edits).toEqual([])
    expect(skippedNote(plan)).toBe("R1 is locked")
  })
})

describe("selectionCentre and turnedAbout", () => {
  test("the centre is the middle of the boxes, snapped to the step", () => {
    const boxes = [
      { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      { minX: 4, minY: 1, maxX: 6.2, maxY: 3 },
    ]
    expect(selectionCentre(boxes, 0.5)).toEqual({ x: 3, y: 1.5 })
    expect(selectionCentre(boxes, 1)).toEqual({ x: 3, y: 2 })
    expect(selectionCentre([], 1)).toBeUndefined()
  })

  test("a quarter turn counter-clockwise sends east to north, in a y-up world", () => {
    expect(turnedAbout({ x: 3, y: 1 }, { x: 1, y: 1 })).toEqual({ x: 1, y: 3 })
    expect(turnedAbout({ x: 1, y: 3 }, { x: 1, y: 1 })).toEqual({ x: -1, y: 1 })
  })
})

describe("rotateAbout", () => {
  const centre = { x: 2, y: 1 }

  test("moves each part round the centre and adds 90 degrees to its rotation, in one change", () => {
    const where = anchorsAt({ R1: [1, 1], R2: [3, 1] })
    const plan = rotateAbout(circuit, ["R1", "R2"], "pcb", where, centre, blockers([]))
    expect(plan.edits).toEqual([
      { kind: "setProps", part: "R1", props: { pcbX: 2, pcbY: 0, pcbRotation: 180 } },
      { kind: "setProps", part: "R2", props: { pcbX: 2, pcbY: 2, pcbRotation: 90 } },
    ])
    expect(plan.summary).toBe("rotate R1 and R2 by 90°")
    expect(plan.skipped).toEqual([])
  })

  test("uses the schematic's props in the schematic", () => {
    const where = anchorsAt({ R1: [1, 1], R2: [3, 1] })
    const plan = rotateAbout(circuit, ["R1", "R2"], "schematic", where, centre, blockers([], "schematic"))
    expect(plan.edits[0]).toEqual({ kind: "setProps", part: "R1", props: { schX: 2, schY: 0, schRotation: 0 } })
    expect(plan.summary).toBe("rotate R1 and R2 in the schematic by 90°")
  })

  test("rounds the new positions to four decimals", () => {
    const where = anchorsAt({ R1: [0.1, 0.2], R2: [0.30000000000000004, 0.2] })
    const plan = rotateAbout(circuit, ["R1", "R2"], "pcb", where, { x: 0.2, y: 0.2 }, blockers([]))
    expect(plan.edits[0]).toMatchObject({ props: { pcbX: 0.2, pcbY: 0.1 } })
    expect(plan.edits[1]).toMatchObject({ props: { pcbX: 0.2, pcbY: 0.3 } })
  })

  test("a locked member stays where it is and is named", () => {
    const where = anchorsAt({ R1: [1, 1], R2: [3, 1], C1: [2, 3] })
    const plan = rotateAbout(circuit, ["R1", "R2", "C1"], "pcb", where, centre, blockers(["R2"]))
    expect(plan.parts).toEqual(["R1", "C1"])
    expect(plan.edits.map((edit) => (edit.kind === "setProps" ? edit.part : ""))).toEqual(["R1", "C1"])
    expect(skippedNote(plan)).toBe("Not rotated: R2 is locked")
  })

  test("a part with a non-numeric rotation is left out with the reason", () => {
    const plan = rotateAbout(circuit, ["R1", "D1"], "pcb", anchorsAt({ R1: [1, 1], D1: [3, 1] }), centre, blockers([]))
    expect(plan.parts).toEqual(["R1"])
    expect(plan.skipped).toEqual(["D1.pcbRotation is not a number"])
  })

  test("one part turns in place, as rotateEach does", () => {
    const plan = rotateAbout(circuit, ["R1"], "pcb", anchorsAt({ R1: [1, 1] }), centre, blockers([]))
    expect(plan).toEqual(rotateEach(circuit, ["R1"], "pcb", blockers([])))
    expect(plan.edits).toEqual([{ kind: "setProps", part: "R1", props: { pcbRotation: 180 } }])
  })
})

describe("anchorLookup", () => {
  test("falls back to the centre of the part's box", () => {
    const box = { minX: 0, minY: 0, maxX: 2, maxY: 2 }
    const lookup = anchorLookup(new Map(), [{ name: "R1", pcbComponentId: "x", center: { x: 1, y: 1 }, box }])
    expect(lookup("R1")).toEqual({ origin: { x: 1, y: 1 }, group: ZERO })
    expect(lookup("R9")).toEqual({ origin: ZERO, group: ZERO })
  })
})

describe("rotatePlan and parts outside the view", () => {
  const box = (name: string, x: number, y: number) => ({ name, pcbComponentId: name, center: { x, y }, box: { minX: x - 0.5, minY: y - 0.5, maxX: x + 0.5, maxY: y + 0.5 } })
  const anchors = new Map<string, Anchor>([
    ["R1", { origin: { x: 1, y: 1 }, group: ZERO, autoPlaced: false }],
    ["R2", { origin: { x: 3, y: 1 }, group: ZERO, autoPlaced: false }],
  ])
  const layout = { anchors, boxes: [box("R1", 1, 1), box("R2", 3, 1)], step: 1 }

  test("a selected part with no box in this view is skipped and named, not turned from the origin", () => {
    const plan = rotatePlan(circuit, ["R1", "R2", "C1"], "pcb", layout, blockers([]))
    if ("message" in plan) throw new Error(plan.message)
    expect(plan.parts).toEqual(["R1", "R2"])
    expect(plan.skipped).toEqual(["C1 is not in this view"])
    expect(skippedNote(plan)).toBe("Not rotated: C1 is not in this view")
  })

  test("with none of the selected parts in the view it gives a message", () => {
    expect(rotatePlan(circuit, ["C1", "D1"], "pcb", layout, blockers([]))).toEqual({ message: "None of the selected parts is in this view." })
  })

  test("one part turns in place, in the open view's own rotation prop", () => {
    const plan = rotatePlan(circuit, ["R1"], "schematic", layout, blockers([], "schematic"))
    if ("message" in plan) throw new Error(plan.message)
    expect(plan.edits).toEqual([{ kind: "setProps", part: "R1", props: { schRotation: 0 } }])
    const pcb = rotatePlan(circuit, ["R1"], "pcb", layout, blockers([]))
    if ("message" in pcb) throw new Error(pcb.message)
    expect(pcb.edits).toEqual([{ kind: "setProps", part: "R1", props: { pcbRotation: 180 } }])
  })
})

describe("nudgePlan and parts outside the view", () => {
  const box = (name: string, x: number, y: number) => ({ name, pcbComponentId: name, center: { x, y }, box: { minX: x - 0.5, minY: y - 0.5, maxX: x + 0.5, maxY: y + 0.5 } })
  const anchors = new Map<string, Anchor>([["R1", { origin: { x: 1, y: 1 }, group: ZERO, autoPlaced: false }]])
  // R2 has a box but no anchor, C1 neither: C1 is not drawn in this view.
  const layout = { anchors, boxes: [box("R1", 1, 1), box("R2", 3, 1)] }

  test("a part is in the view when it has a box or an anchor there", () => {
    const drawn = inView(layout)
    expect(["R1", "R2", "C1"].map(drawn)).toEqual([true, true, false])
  })

  test("moves the drawn parts and names the ones the view does not draw, instead of moving them from the origin", () => {
    const plan = nudgePlan(circuit, ["R1", "C1", "R2"], "pcb", layout, { x: 1, y: 0 }, blockers([]))
    expect(plan.parts).toEqual(["R1", "R2"])
    expect(plan.edits).toEqual([
      { kind: "setProps", part: "R1", props: { pcbX: 2, pcbY: 1 } },
      { kind: "setProps", part: "R2", props: { pcbX: 4, pcbY: 1 } },
    ])
    expect(skippedNote(plan)).toBe("Not moved: C1 is not in this view")
  })

  test("names the parts not in the view before the locked ones; with none left nothing is sent", () => {
    const plan = nudgePlan(circuit, ["R1", "C1"], "pcb", layout, { x: 1, y: 0 }, blockers(["R1"]))
    expect(plan.edits).toEqual([])
    expect(skippedNote(plan)).toBe("C1 is not in this view; R1 is locked")
  })
})

describe("Rotate right", () => {
  const centre = { x: 2, y: 1 }
  const where = anchorsAt({ R1: [1, 1], R2: [3, 1] })

  test("turns the point clockwise about the centre, in a y-up world: east goes to south", () => {
    expect(turnedAbout({ x: 3, y: 1 }, { x: 1, y: 1 }, -90)).toEqual({ x: 1, y: -1 })
    expect(turnedAbout({ x: 1, y: 3 }, { x: 1, y: 1 }, -90)).toEqual({ x: 3, y: 1 })
  })

  test("a clockwise turn undoes a counter-clockwise one", () => {
    const there = turnedAbout({ x: 5, y: 2 }, centre, 90)
    expect(turnedAbout(there, centre, -90)).toEqual({ x: 5, y: 2 })
  })

  test("moves each part clockwise round the centre and takes 90 degrees off its rotation, in one change", () => {
    const plan = rotateAbout(circuit, ["R1", "R2"], "pcb", where, centre, blockers([]), () => true, -90)
    expect(plan.edits).toEqual([
      { kind: "setProps", part: "R1", props: { pcbX: 2, pcbY: 2, pcbRotation: 0 } },
      { kind: "setProps", part: "R2", props: { pcbX: 2, pcbY: 0, pcbRotation: 270 } },
    ])
    expect(plan.summary).toBe("rotate R1 and R2 by -90°")
  })

  test("a locked member stays where it is and is named; a part without a numeric rotation is named too", () => {
    const three = anchorsAt({ R1: [1, 1], R2: [3, 1], C1: [2, 3] })
    const plan = rotateAbout(circuit, ["R1", "R2", "C1"], "pcb", three, centre, blockers(["R2"]), () => true, -90)
    expect(plan.parts).toEqual(["R1", "C1"])
    expect(plan.skipped).toEqual(["R2 is locked"])
    const odd = rotateAbout(circuit, ["R1", "D1"], "pcb", anchorsAt({ R1: [1, 1], D1: [3, 1] }), centre, blockers([]), () => true, -90)
    expect(odd.parts).toEqual(["R1"])
    expect(odd.skipped).toEqual(["D1.pcbRotation is not a number"])
  })

  test("one part turns in place, clockwise, with the summary a single rotate writes", () => {
    const plan = rotateEach(circuit, ["R1"], "pcb", blockers([]), -90)
    expect(plan.edits).toEqual([{ kind: "setProps", part: "R1", props: { pcbRotation: 0 } }])
    expect(plan.summary).toBe("rotate R1 to 0°")
    expect(rotateEach(circuit, ["R2"], "pcb", blockers([]), -90).edits).toEqual([{ kind: "setProps", part: "R2", props: { pcbRotation: 270 } }])
  })

  test("rotatePlan turns about the selection's centre, clockwise, and says so when none is in the view", () => {
    const layout = {
      anchors: new Map([
        ["R1", { origin: { x: 1, y: 1 }, group: ZERO, autoPlaced: false }],
        ["R2", { origin: { x: 3, y: 1 }, group: ZERO, autoPlaced: false }],
      ]),
      boxes: [
        { name: "R1", pcbComponentId: "R1", center: { x: 1, y: 1 }, box: { minX: 0.5, minY: 0.5, maxX: 1.5, maxY: 1.5 } },
        { name: "R2", pcbComponentId: "R2", center: { x: 3, y: 1 }, box: { minX: 2.5, minY: 0.5, maxX: 3.5, maxY: 1.5 } },
      ],
      step: 1,
    }
    const plan = rotatePlan(circuit, ["R1", "R2"], "pcb", layout, blockers([]), -90)
    expect("edits" in plan && plan.edits).toEqual([
      { kind: "setProps", part: "R1", props: { pcbX: 2, pcbY: 2, pcbRotation: 0 } },
      { kind: "setProps", part: "R2", props: { pcbX: 2, pcbY: 0, pcbRotation: 270 } },
    ])
    expect(rotatePlan(circuit, ["R1", "R2"], "pcb", { ...layout, anchors: new Map(), boxes: [] }, blockers([]), -90)).toEqual({ message: "None of the selected parts is in this view." })
  })
})

describe("nudgeOffset with snap off", () => {
  test("moves a tenth of a grid step, rounded to four decimals", () => {
    expect(nudgeOffset({ dx: 1, dy: 0 }, 0.5, 1, false)).toEqual({ x: 0.05, y: 0 })
    expect(nudgeOffset({ dx: 0, dy: -1 }, 0.0508, 10, false)).toEqual({ x: 0, y: -0.0508 })
    expect(nudgeOffset({ dx: 1, dy: 0 }, 0.0508, 1, false)).toEqual({ x: 0.0051, y: 0 })
  })

  test("on, or when snap is not said, it is the whole step", () => {
    expect(nudgeOffset({ dx: 1, dy: 0 }, 0.5, 1, true)).toEqual({ x: 0.5, y: 0 })
    expect(nudgeOffset({ dx: 1, dy: 0 }, 0.5, 1)).toEqual({ x: 0.5, y: 0 })
  })
})
