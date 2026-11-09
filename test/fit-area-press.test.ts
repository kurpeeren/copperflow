import { describe, expect, test } from "vitest"
import { escapeDisarms } from "../studio/src/pcb/canvas-keys.js"
import { canPick } from "../studio/src/pcb/pick.js"
import { gestureStart, stillRelease } from "../studio/src/pcb/press.js"
import { Selection } from "../studio/src/selection.js"

const left = { button: 0, shiftKey: false, ctrlKey: false, metaKey: false }

describe("a press while the Fit area tool is armed", () => {
  test("every left press draws the zoom box, whatever is under it", () => {
    for (const under of ["part", "selectedPart", "label", "empty"] as const) expect(gestureStart(left, under, "zoom")).toBe("zoom")
    expect(gestureStart({ ...left, shiftKey: true }, "empty", "zoom")).toBe("zoom")
  })

  test("the middle button still pans and the right button still opens the menu or puts the tool away", () => {
    expect(gestureStart({ ...left, button: 1 }, "empty", "zoom")).toBe("pan")
    expect(gestureStart({ ...left, button: 2 }, "empty", "zoom")).toBe("rightPress")
    expect(stillRelease("rightPress", "zoom")).toBe("disarm")
    expect(stillRelease("rightPress", null)).toBe("menu")
  })

  test("nothing is picked under the tool, as under the Note box tool", () => {
    expect(canPick({ kind: "part", name: "R1" }, { selection: Selection.none, armed: "zoom" })).toBe(false)
    expect(canPick({ kind: "part", name: "R1" }, { selection: Selection.none, armed: null })).toBe(true)
  })

  test("Esc puts it away, unless a text field has the focus", () => {
    const esc = { key: "Escape", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, typing: false }
    expect(escapeDisarms(esc)).toBe(true)
    expect(escapeDisarms({ ...esc, typing: true })).toBe(false)
  })
})
