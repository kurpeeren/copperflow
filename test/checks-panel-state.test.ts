import { describe, expect, test } from "vitest"
import type { CheckRow } from "../studio/src/checks-list.js"
import { blursAfterClick, checkPick, opensOnBuild } from "../studio/src/checks-panel-state.js"

describe("blursAfterClick", () => {
  test("a pointer click on a row gives up focus, so keys go back to the canvas", () => {
    expect(blursAfterClick({ detail: 1 })).toBe(true)
    expect(blursAfterClick({ detail: 2 })).toBe(true)
  })

  test("Enter or Space on a row (a click with detail 0) keeps focus on the row", () => {
    expect(blursAfterClick({ detail: 0 })).toBe(false)
  })
})

const row = (extra: Partial<CheckRow>): CheckRow => ({ id: "x", severity: "error", code: "x", message: "", items: [], view: "pcb", ...extra })

describe("opensOnBuild", () => {
  test("opens when a build reports errors after a clean build", () => {
    expect(opensOnBuild(0, 2)).toBe(true)
  })

  test("stays as it is while the errors go on, so a manual close holds", () => {
    expect(opensOnBuild(1, 3)).toBe(false)
    expect(opensOnBuild(3, 3)).toBe(false)
  })

  test("does not open for the first build, a clean build or a fix", () => {
    expect(opensOnBuild(undefined, 2)).toBe(false)
    expect(opensOnBuild(0, 0)).toBe(false)
    expect(opensOnBuild(2, 0)).toBe(false)
  })
})

describe("checkPick", () => {
  test("a board row with a position switches to the PCB, centres on it and selects its part", () => {
    const at = { x: 1, y: 2 }
    expect(checkPick(row({ view: "pcb", at, part: "R1" }))).toEqual({ tab: "pcb", focus: { view: "pcb", at }, select: "R1" })
  })

  test("a schematic row without a position switches view and selects, without centring", () => {
    expect(checkPick(row({ view: "schematic", part: "U1" }))).toEqual({ tab: "schematic", select: "U1" })
  })

  test("a code row keeps the view and selects the part it names", () => {
    expect(checkPick(row({ view: "code", part: "U1" }))).toEqual({ select: "U1" })
  })

  test("a row that names no part leaves the selection alone", () => {
    expect(checkPick(row({ view: "pcb" }))).toEqual({ tab: "pcb" })
    expect(checkPick(row({ view: "code" }))).toEqual({})
  })
})
