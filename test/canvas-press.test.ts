import { describe, expect, test } from "vitest"
import { gestureStart, hasMoved, opensOnDoubleClick, stillRelease, type GestureStart, type Press, type Under } from "../studio/src/pcb/press.js"

const press = (held: Partial<Press> = {}): Press => ({ button: 0, shiftKey: false, ctrlKey: false, metaKey: false, ...held })
const UNDER: readonly Under[] = ["part", "selectedPart", "label", "empty"]
const MODIFIERS = [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true, ctrlKey: true }]

describe("what a press on the canvas starts", () => {
  test("a left press on a part selects it alone and drags it; on a selected part it drags the whole selection", () => {
    expect(gestureStart(press(), "part", null)).toBe("move")
    expect(gestureStart(press(), "selectedPart", null)).toBe("moveGroup")
  })

  test("a left press on a net label drags the label", () => {
    expect(gestureStart(press(), "label", null)).toBe("label")
  })

  test("a left press on empty canvas draws a selection box instead of panning", () => {
    expect(gestureStart(press(), "empty", null)).toBe("box")
  })

  test("Shift or Ctrl (Cmd on a Mac) on a part toggles it; anywhere else the box adds to the selection", () => {
    for (const held of MODIFIERS) {
      expect(gestureStart(press(held), "part", null)).toBe("toggle")
      expect(gestureStart(press(held), "selectedPart", null)).toBe("toggle")
      expect(gestureStart(press(held), "empty", null)).toBe("addBox")
      expect(gestureStart(press(held), "label", null)).toBe("addBox")
    }
  })

  test("Shift-drag no longer draws a note box", () => {
    expect(gestureStart(press({ shiftKey: true }), "empty", null)).not.toBe("note")
  })

  test("the middle button pans and the right button starts a right press, over anything and with any modifier", () => {
    for (const under of UNDER) {
      for (const held of [{}, ...MODIFIERS]) {
        expect(gestureStart(press({ button: 1, ...held }), under, null)).toBe("pan")
        expect(gestureStart(press({ button: 2, ...held }), under, null)).toBe("rightPress")
      }
    }
  })

  test("with the Note box tool armed, a left press anywhere draws the note box; the other buttons keep their work", () => {
    for (const under of UNDER) {
      expect(gestureStart(press(), under, "note")).toBe("note")
      expect(gestureStart(press({ shiftKey: true }), under, "note")).toBe("note")
      expect(gestureStart(press({ button: 1 }), under, "note")).toBe("pan")
      expect(gestureStart(press({ button: 2 }), under, "note")).toBe("rightPress")
    }
  })

  test("with a Place tool armed, a left drag on empty canvas pans as before; parts and labels keep their press", () => {
    expect(gestureStart(press(), "empty", "place")).toBe("pan")
    expect(gestureStart(press({ shiftKey: true }), "empty", "place")).toBe("pan")
    expect(gestureStart(press(), "part", "place")).toBe("move")
    expect(gestureStart(press(), "selectedPart", "place")).toBe("moveGroup")
    expect(gestureStart(press(), "label", "place")).toBe("label")
    expect(gestureStart(press({ ctrlKey: true }), "part", "place")).toBe("toggle")
  })

  test("the back and forward buttons start nothing", () => {
    for (const button of [3, 4]) expect(gestureStart(press({ button }), "part", null)).toBe("none")
  })
})

describe("a release that did not move", () => {
  const cases: [GestureStart, ReturnType<typeof stillRelease>][] = [
    ["moveGroup", "selectAlone"],
    ["move", "none"],
    ["toggle", "none"],
    ["box", "clear"],
    ["addBox", "none"],
    ["rightPress", "menu"],
    ["pan", "none"],
    ["label", "none"],
    ["note", "none"],
  ]
  test.each(cases)("after %s does %s", (start, expected) => {
    expect(stillRelease(start, null)).toBe(expected)
  })

  test("a still right press opens the context menu, or puts the armed tool away", () => {
    expect(stillRelease("rightPress", null)).toBe("menu")
    expect(stillRelease("rightPress", "note")).toBe("disarm")
  })

  test("with a Place tool armed, a still click on empty canvas leaves the selection alone", () => {
    expect(stillRelease(gestureStart(press(), "empty", "place"), "place")).toBe("none")
  })

  test("a Shift or Ctrl press on a selected part toggles it and does not then select it alone", () => {
    const start = gestureStart(press({ ctrlKey: true }), "selectedPart", null)
    expect(stillRelease(start, null)).toBe("none")
  })
})

describe("how far the pointer must go to count as moved", () => {
  test("less than 3 px is still; 3 px or more is a drag", () => {
    const at = { x: 10, y: 10 }
    expect(hasMoved(at, { x: 12, y: 10 })).toBe(false)
    expect(hasMoved(at, { x: 12, y: 12 })).toBe(false)
    expect(hasMoved(at, { x: 13, y: 10 })).toBe(true)
    expect(hasMoved(at, { x: 10, y: 6 })).toBe(true)
  })
})

describe("which double clicks open Properties or rename a net", () => {
  /** A stand-in for the element clicked: `inControl` says whether it sits in a field or a button. */
  const target = (inControl: boolean, asked: string[] = []) => ({
    closest: (selector: string) => {
      asked.push(selector)
      return inControl ? {} : null
    },
  })

  test("one on the drawing does, whichever element carries the handlers", () => {
    expect(opensOnDoubleClick({ button: 0, target: target(false) })).toBe(true)
  })

  test("one in the label's name input, another field or a button does not", () => {
    const asked: string[] = []
    expect(opensOnDoubleClick({ button: 0, target: target(true, asked) })).toBe(false)
    for (const tag of ["input", "textarea", "select", "form", "button"]) expect([tag, asked[0]?.includes(tag)]).toEqual([tag, true])
  })

  test("only the left button counts", () => {
    expect(opensOnDoubleClick({ button: 2, target: target(false) })).toBe(false)
  })

  test("a target that is not an element counts as the drawing", () => {
    expect(opensOnDoubleClick({ button: 0, target: null })).toBe(true)
  })
})
