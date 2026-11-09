import { describe, expect, test } from "vitest"
import type { PartInfo } from "../src/core/types.js"
import { lockChange, nameList, removeEach, removeQuestion, rotateEach, sendGroupEdit, skippedNote, type GroupEditActions } from "../studio/src/pcb/group-edits.js"
import { moveBlocker, type SourceCircuit, type View } from "../studio/src/pcb/positions.js"

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
    expect(removeEach(["R2"], blockers([]))).toEqual({ edits: [{ kind: "removePart", part: "R2" }], summary: "remove R2", parts: ["R2"], skipped: [] })
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

  test("with some done it names the ones left out", () => {
    expect(skippedNote(removeEach(["R1", "R2"], blockers(["R1"])))).toBe("Skipped: R1 is locked")
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
    expect(calls).toEqual(["edit 1: remove R2", "notify Skipped: R1 is locked"])
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
