import { describe, expect, test } from "vitest"
import { splitCopper } from "../studio/src/pcb/delete-plan.js"
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
