import { describe, expect, test } from "vitest"
import { pressKind, type Press } from "../studio/src/pcb/press.js"

const press = (held: Partial<Press> = {}): Press => ({ button: 0, shiftKey: false, ctrlKey: false, metaKey: false, ...held })

describe("a press on the canvas", () => {
  test("on a part selects it alone and drags it; elsewhere it is left to a label or a pan", () => {
    expect(pressKind(press(), true)).toBe("part")
    expect(pressKind(press(), false)).toBe("empty")
  })

  test("with Shift or Ctrl (Cmd on a Mac) on a part toggles it, rather than starting a note box", () => {
    for (const held of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true, ctrlKey: true }]) {
      expect(pressKind(press(held), true)).toBe("toggle")
    }
  })

  test("with Shift on empty canvas still draws a note box; Ctrl there is a plain press", () => {
    expect(pressKind(press({ shiftKey: true }), false)).toBe("note")
    expect(pressKind(press({ ctrlKey: true }), false)).toBe("empty")
  })

  test("with the middle or right button pans, even over a part and with a modifier", () => {
    for (const button of [1, 2]) {
      expect(pressKind(press({ button }), true)).toBe("pan")
      expect(pressKind(press({ button, shiftKey: true }), true)).toBe("pan")
    }
  })
})
