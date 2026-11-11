import { describe, expect, test } from "vitest"
import { type PlaceEvent, isPlacing, placedMark, placeProgressText, placeSummary } from "../src/studio/place-events.js"

const file = "main.circuit.tsx"

describe("place events", () => {
  test("the summary names the scope and the parts", () => {
    expect(placeSummary({ kind: "all" }, 12)).toBe("Autoplace the board: 12 parts")
    expect(placeSummary({ kind: "parts", parts: ["R1"] }, 1)).toBe("Autoplace R1: 1 part")
    expect(placeSummary({ kind: "instance", instance: "PS1" }, 3)).toBe("Autoplace instance PS1: 3 parts")
  })

  test("the status line while it runs and when it ends", () => {
    expect(placeProgressText({ file, state: "started", scope: { kind: "all" } })).toBe("Autoplacing…")
    expect(placeProgressText({ file, state: "running", stage: "construct", done: 3, total: 12 })).toBe("Autoplacing: 3 of 12 parts")
    expect(placeProgressText({ file, state: "running", stage: "refine", done: 50, total: 200 })).toBe("Autoplacing: refining, 25%")
    const done: PlaceEvent = { file, state: "done", placed: 12, wireLength: 184.2, before: 411.7, unplaced: [{ name: "J1", reason: "no room" }], notes: [], board: { width: 42, height: 28 }, entryId: "c0003", writeMark: 9 }
    expect(placeProgressText(done)).toBe("Placed 12 parts; wire length 184 mm (was 412); board 42 × 28 mm; 1 not placed (J1)")
    expect(placeProgressText({ file, state: "cancelled" })).toBe("Autoplacing cancelled; nothing was written")
    expect(isPlacing({ file, state: "running", stage: "refine", done: 1, total: 2 })).toBe(true)
    expect(isPlacing(done)).toBe(false)
    expect(placedMark(done)).toBe(9)
    expect(placedMark({ ...done, entryId: undefined } as never)).toBeUndefined()
  })
})
