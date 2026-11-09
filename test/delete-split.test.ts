import { describe, expect, test } from "vitest"
import { restBlocked, splitCopper } from "../studio/src/pcb/delete-plan.js"
import { Selection } from "../studio/src/selection.js"

describe("splitCopper", () => {
  test("copper alone leaves nothing else to ask about", () => {
    expect(splitCopper(Selection.none.addCopper(["t0001"]), true)).toEqual({ copper: ["t0001"], rest: undefined })
  })

  test("with parts, the rest goes through the parts' plan (and its question) first", () => {
    const mixed = Selection.none.all(["R1"]).addCopper(["t0001", "v0001"])
    const split = splitCopper(mixed, true)
    expect(split.copper).toEqual(["t0001", "v0001"])
    expect(split.rest?.names).toEqual(["R1"])
    expect(split.rest?.copper).toEqual([])
  })

  test("a canvas without copper (the schematic) keeps the selection as it is", () => {
    const mixed = Selection.none.all(["R1"]).addCopper(["t0001"])
    expect(splitCopper(mixed, false)).toEqual({ copper: [], rest: mixed })
  })
})

describe("restBlocked", () => {
  test("when no part of a mixed selection may go, the copper still goes and the reason is told", () => {
    expect(restBlocked(2, "R1 is locked", true)).toEqual({ removeCopper: true, notice: "R1 is locked" })
  })

  test("with no copper, the key stays quiet as before and a command says why", () => {
    expect(restBlocked(0, "R1 is locked", true)).toEqual({ removeCopper: false })
    expect(restBlocked(0, "R1 is locked", false)).toEqual({ removeCopper: false, notice: "R1 is locked" })
  })
})
