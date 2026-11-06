import { describe, expect, test } from "vitest"
import { keyAction, type KeyInput, type KeyState } from "../studio/src/pcb/canvas-keys.js"

const SCHEMATIC: KeyState = { view: "schematic" }
const PCB: KeyState = { view: "pcb" }

function key(name: string, extra: Partial<KeyInput> = {}): KeyInput {
  return { key: name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, typing: false, ...extra }
}

describe("keyAction", () => {
  test("Alt+W starts the wire tool on the schematic and prevents the default", () => {
    expect(keyAction(key("w", { altKey: true, code: "KeyW" }), SCHEMATIC)).toEqual({ action: "wire", preventDefault: true })
  })

  test("Alt+W is found by its physical key where Alt changes the character", () => {
    expect(keyAction(key("∑", { altKey: true, code: "KeyW" }), SCHEMATIC)?.action).toBe("wire")
  })

  test("W alone still starts the wire tool, and only on the schematic", () => {
    expect(keyAction(key("w"), SCHEMATIC)).toEqual({ action: "wire", preventDefault: false })
    expect(keyAction(key("W", { shiftKey: true }), SCHEMATIC)?.action).toBe("wire")
    expect(keyAction(key("w"), PCB)).toBeNull()
    expect(keyAction(key("w", { altKey: true, code: "KeyW" }), PCB)).toBeNull()
  })

  test("Alt+N arms the net label tool on the schematic only", () => {
    expect(keyAction(key("n", { altKey: true, code: "KeyN" }), SCHEMATIC)).toEqual({ action: "armNetLabel", preventDefault: true })
    expect(keyAction(key("n", { altKey: true, code: "KeyN" }), PCB)).toBeNull()
  })

  test("Space rotates and prevents the default in both views", () => {
    for (const state of [SCHEMATIC, PCB]) expect(keyAction(key(" "), state)).toEqual({ action: "rotate", preventDefault: true })
  })

  test("Space does nothing while the wire tool is drawing", () => {
    expect(keyAction(key(" "), { view: "schematic", drawing: true })).toBeNull()
  })

  test("Space on a focused button is left to the button", () => {
    expect(keyAction(key(" ", { onButton: true }), PCB)).toBeNull()
  })

  test("R rotates without preventing the default", () => {
    expect(keyAction(key("r"), PCB)).toEqual({ action: "rotate", preventDefault: false })
    expect(keyAction(key("R", { shiftKey: true }), PCB)?.action).toBe("rotate")
  })

  test("F and K fit; a capital F typed with Caps Lock still fits", () => {
    expect(keyAction(key("f"), PCB)?.action).toBe("fit")
    expect(keyAction(key("F"), PCB)?.action).toBe("fit")
    expect(keyAction(key("k"), SCHEMATIC)?.action).toBe("fit")
  })

  test("H highlights and Shift+H clears, in both views", () => {
    for (const state of [SCHEMATIC, PCB]) {
      expect(keyAction(key("h"), state)?.action).toBe("highlight")
      expect(keyAction(key("H", { shiftKey: true }), state)?.action).toBe("clearHighlight")
    }
  })

  test("Q switches the unit on the PCB only", () => {
    expect(keyAction(key("q"), PCB)?.action).toBe("toggleUnit")
    expect(keyAction(key("q"), SCHEMATIC)).toBeNull()
  })

  test("[ and ] toggle the left and right panels", () => {
    expect(keyAction(key("["), PCB)?.action).toBe("toggleLeftPanel")
    expect(keyAction(key("]"), SCHEMATIC)?.action).toBe("toggleRightPanel")
  })

  test("Shift+F opens the library", () => {
    expect(keyAction(key("F", { shiftKey: true }), PCB)?.action).toBe("openLibrary")
    expect(keyAction(key("F", { shiftKey: true }), SCHEMATIC)?.action).toBe("openLibrary")
  })

  test("backslash is reserved and bound to nothing", () => {
    expect(keyAction(key("\\"), PCB)).toBeNull()
  })

  test("every key is ignored while typing in a field", () => {
    for (const name of ["w", " ", "k", "h", "q", "[", "]", "f", "r"]) expect(keyAction(key(name, { typing: true }), SCHEMATIC)).toBeNull()
    expect(keyAction(key("w", { altKey: true, code: "KeyW", typing: true }), SCHEMATIC)).toBeNull()
  })

  test("browser shortcuts with Ctrl or Meta are left alone", () => {
    expect(keyAction(key("r", { ctrlKey: true }), PCB)).toBeNull()
    expect(keyAction(key("k", { metaKey: true }), PCB)).toBeNull()
  })

  test("other Alt combinations are ignored", () => {
    expect(keyAction(key("h", { altKey: true, code: "KeyH" }), PCB)).toBeNull()
    expect(keyAction(key("w", { altKey: true, shiftKey: true, code: "KeyW" }), SCHEMATIC)).toBeNull()
  })
})
