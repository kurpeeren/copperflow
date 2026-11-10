import { describe, expect, test } from "vitest"
import { boardLockButton, selectionLockChange } from "../studio/src/pcb/pour-props.js"
import { Selection } from "../studio/src/selection.js"

const none = new Set<string>()

describe("Layout → Lock and Unlock on a selected pour or hole", () => {
  test("Lock sends the selected pour's id, with any selected parts", () => {
    const pour = Selection.none.toggleBoard("copperpour:1")
    expect(selectionLockChange(pour, none, true)).toEqual({ parts: ["copperpour:1"] })
    const both = pour.toggle("R1").toggleBoard("hole:2")
    expect(selectionLockChange(both, none, true)).toEqual({ parts: ["R1", "copperpour:1", "hole:2"] })
  })

  test("Unlock sends only the locked ones, and says so when none is", () => {
    const pour = Selection.none.toggleBoard("copperpour:1").toggleBoard("hole:1")
    expect(selectionLockChange(pour, new Set(["hole:1"]), false)).toEqual({ parts: ["hole:1"] })
    expect(selectionLockChange(pour, new Set(["copperpour:1", "hole:1"]), true)).toEqual({ message: "copperpour:1 and hole:1 are already locked." })
  })

  test("a part lock does not lock the pour", () => {
    const pour = Selection.none.toggleBoard("copperpour:1")
    expect(selectionLockChange(pour, new Set(["R1"]), false)).toEqual({ message: "copperpour:1 is not locked." })
  })
})

describe("the lock in a pour's or hole's Properties", () => {
  const locks = (locked: string[], violated: string[] = []) => ({ locked: new Set(locked), violated: new Set(violated) })

  test("an unlocked pour offers Lock, a locked one shows Locked and unlocks, a changed one offers Lock again", () => {
    expect(boardLockButton("copperpour:1", locks([]))).toEqual({ command: "lock", label: "Lock", pressed: false, title: "Lock this copper pour, so the agent cannot change or remove it" })
    expect(boardLockButton("hole:1", locks(["hole:1"]))).toEqual({ command: "unlock", label: "Locked", pressed: true, title: "Unlock this hole" })
    expect(boardLockButton("hole:1", locks(["hole:1"], ["hole:1"]))).toMatchObject({ command: "lock", label: "Lock again", pressed: true })
  })
})
