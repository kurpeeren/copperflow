import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { designatorRows, instancePlaceholder, madeNote, makeSheetStart, portRows, type MakeSheetPreview } from "../studio/src/shell/make-sheet-form.js"
import { CUT_MAIN } from "./helpers/cut-fixture.js"

const PREVIEW: MakeSheetPreview = {
  file: "Filter.sheet.tsx",
  sheet: "Filter",
  instance: "Filter1",
  base: 100,
  ports: [{ name: "D[0:3]", bus: true }, { name: "VIN" }],
  connections: { "D[0:3]": "D[0:3]", VIN: "VIN" },
  mapping: [
    { from: "C3", to: "C1", flat: "C101" },
    { from: "R5", to: "R1", flat: "R101" },
  ],
}

describe("Edit → Make sub-sheet…", () => {
  test("opens for parts of one page, and says why not for nothing, an instance or no circuit", () => {
    const model = analyzeCircuit(CUT_MAIN)
    expect(makeSheetStart(model, ["R5", "C3", "R5"])).toEqual({ parts: ["R5", "C3"] })
    expect(makeSheetStart(model, [])).toEqual({ message: "Select the parts to move into the sub-sheet first." })
    expect(makeSheetStart(undefined, ["R5"])).toEqual({ message: "Wait for the circuit to load, then try again." })
    const withInstance = analyzeCircuit(`import Other from "./Other.sheet"\n${CUT_MAIN.replace("  </board>", `    <Other name="O1" connections={{}} />\n  </board>`)}`)
    expect(makeSheetStart(withInstance, ["O1"])).toEqual({ message: expect.stringMatching(/^O1 is a sub-sheet instance/) })
  })

  test("the dialog lists each port with what it joins, and each designator now, in the sheet and on the board", () => {
    expect(portRows(PREVIEW)).toEqual([
      { port: "D[0:3]", joins: "bus D[0:3]" },
      { port: "VIN", joins: "net VIN" },
    ])
    expect(designatorRows(PREVIEW)).toEqual([
      { now: "C3", sheet: "C1", board: "C101" },
      { now: "R5", sheet: "R1", board: "R101" },
    ])
    expect(madeNote(PREVIEW, 2)).toBe("Made Filter.sheet.tsx: Filter1 (base 100) replaces 2 parts")
  })
})

test("the instance name field shows the default the server takes, the sheet's name and 1", () => {
  expect(instancePlaceholder("Filter")).toBe("Filter1")
  expect(instancePlaceholder("  ")).toBe("PowerStage1")
})
