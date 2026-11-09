import { describe, expect, test } from "vitest"
import { armBoxTool, boxToolCommand, boxToolHint, FIT_AREA_HINT, NOTE_HINT } from "../studio/src/pcb/box-tool.js"
import { commandDisabledReason, SELECT_A_PART } from "../studio/src/pcb/selection-rules.js"

describe("commandDisabledReason", () => {
  test("Fit selection and Rotate right need one part", () => {
    for (const command of ["fitSelection", "rotateRight"]) {
      expect(commandDisabledReason(command, 0)).toBe(SELECT_A_PART)
      expect(commandDisabledReason(command, 1)).toBeNull()
      expect(commandDisabledReason(command, 5)).toBeNull()
    }
  })

  test("the align commands keep their own counts", () => {
    expect(commandDisabledReason("alignLeft", 1)).toBe("Select two or more parts")
    expect(commandDisabledReason("distributeH", 2)).toBe("Select three or more parts")
  })

  test("other commands do not depend on the selection", () => {
    for (const command of ["fit", "fitArea", "snap", "rotate", "undo"]) expect(commandDisabledReason(command, 0)).toBeNull()
  })
})

describe("the box tools", () => {
  test("arming one puts the other away", () => {
    expect(armBoxTool("zoom")).toBe("zoom")
    expect(armBoxTool("zoom")).toBe("zoom")
    expect(armBoxTool("note")).toBe("note")
  })

  test("each has its hint, and only Fit area shows pressed on the toolbar", () => {
    expect(boxToolHint("zoom")).toBe(FIT_AREA_HINT)
    expect(boxToolHint("note")).toBe(NOTE_HINT)
    expect(boxToolHint(null)).toBeUndefined()
    expect(boxToolCommand("zoom")).toBe("fitArea")
    expect(boxToolCommand("note")).toBeNull()
    expect(boxToolCommand(null)).toBeNull()
  })
})
