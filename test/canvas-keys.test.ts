import { describe, expect, test } from "vitest"
import { escapeDisarms, keyAction, nudgeDirection, type KeyInput, type KeyState } from "../studio/src/pcb/canvas-keys.js"
import { claimsKey } from "../studio/src/pcb/key-burst.js"

const SCHEMATIC: KeyState = { view: "schematic" }
const PCB: KeyState = { view: "pcb" }

function key(name: string, extra: Partial<KeyInput> = {}): KeyInput {
  return { key: name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, typing: false, ...extra }
}

describe("keyAction", () => {
  test("Ctrl+Z undoes and Ctrl+O opens the file list, by the character the key produces", () => {
    expect(keyAction(key("z", { ctrlKey: true, code: "KeyY" }), PCB)).toEqual({ action: "undo", preventDefault: true })
    expect(keyAction(key("Z", { metaKey: true }), SCHEMATIC)?.action).toBe("undo")
    expect(keyAction(key("o", { ctrlKey: true }), PCB)).toEqual({ action: "openFile", preventDefault: true })
    // A German keyboard's Z key gives y: by the character, that is Ctrl+Y, which redoes.
    expect(keyAction(key("y", { ctrlKey: true, code: "KeyZ" }), PCB)?.action).toBe("redo")
  })

  test("Ctrl+Y and Ctrl+Shift+Z redo in both views, by the character the key produces", () => {
    for (const state of [PCB, SCHEMATIC]) {
      expect(keyAction(key("y", { ctrlKey: true, code: "KeyY" }), state)).toEqual({ action: "redo", preventDefault: true })
      expect(keyAction(key("Z", { ctrlKey: true, shiftKey: true, code: "KeyZ" }), state)).toEqual({ action: "redo", preventDefault: true })
    }
    expect(keyAction(key("z", { ctrlKey: true, shiftKey: true, code: "KeyY" }), PCB)?.action).toBe("redo")
    expect(keyAction(key("Y", { metaKey: true }), SCHEMATIC)?.action).toBe("redo")
    expect(keyAction(key("Z", { metaKey: true, shiftKey: true }), PCB)?.action).toBe("redo")
  })

  test("redo is not ours with Alt, AltGr, in a text field, or as Ctrl+Shift+Y", () => {
    for (const press of [key("y", { ctrlKey: true, altKey: true }), key("y", { ctrlKey: true, altGraph: true }), key("y", { ctrlKey: true, typing: true })]) {
      expect(keyAction(press, PCB)).toBeNull()
    }
    expect(keyAction(key("Z", { ctrlKey: true, shiftKey: true, altKey: true }), PCB)).toBeNull()
    expect(keyAction(key("Z", { ctrlKey: true, shiftKey: true, typing: true }), PCB)).toBeNull()
    expect(keyAction(key("Y", { ctrlKey: true, shiftKey: true }), PCB)).toBeNull()
    expect(keyAction(key("y"), PCB)).toBeNull()
  })

  test("Ctrl+A selects every part in both views, by the character, and keeps the browser from selecting the page", () => {
    for (const state of [PCB, SCHEMATIC]) expect(keyAction(key("a", { ctrlKey: true, code: "KeyQ" }), state)).toEqual({ action: "selectAll", preventDefault: true })
    expect(keyAction(key("A", { metaKey: true }), PCB)?.action).toBe("selectAll")
    expect(keyAction(key("q", { ctrlKey: true, code: "KeyA" }), PCB)).toBeNull()
  })

  test("Ctrl+A is not ours while typing, with Shift, Alt or AltGr, and a plain A is nothing", () => {
    expect(keyAction(key("a", { ctrlKey: true, typing: true }), PCB)).toBeNull()
    expect(keyAction(key("A", { ctrlKey: true, shiftKey: true }), PCB)).toBeNull()
    expect(keyAction(key("a", { ctrlKey: true, altKey: true }), PCB)).toBeNull()
    expect(keyAction(key("a", { ctrlKey: true, altGraph: true }), PCB)).toBeNull()
    expect(keyAction(key("a"), PCB)).toBeNull()
  })

  test("Ctrl+Z is not undo with Shift (that redoes), and not ours with Alt, AltGr or in a text field", () => {
    expect(keyAction(key("Z", { ctrlKey: true, shiftKey: true }), PCB)?.action).toBe("redo")
    expect(keyAction(key("z", { ctrlKey: true, altKey: true }), PCB)).toBeNull()
    expect(keyAction(key("z", { ctrlKey: true, altGraph: true }), PCB)).toBeNull()
    expect(keyAction(key("z", { ctrlKey: true, typing: true }), PCB)).toBeNull()
  })

  test("Alt+W starts the wire tool on the schematic and prevents the default", () => {
    expect(keyAction(key("w", { altKey: true, code: "KeyW" }), SCHEMATIC)).toEqual({ action: "wire", preventDefault: true })
  })

  test("Alt+W is found by its physical key where Alt changes the character", () => {
    expect(keyAction(key("∑", { altKey: true, code: "KeyW" }), SCHEMATIC)?.action).toBe("wire")
  })

  test("W alone starts the wire tool on the schematic, and single routing on the PCB", () => {
    expect(keyAction(key("w"), SCHEMATIC)).toEqual({ action: "wire", preventDefault: false })
    expect(keyAction(key("W", { shiftKey: true }), SCHEMATIC)?.action).toBe("wire")
    expect(keyAction(key("w"), PCB)).toEqual({ action: "route", preventDefault: false })
    expect(keyAction(key("w", { altKey: true, code: "KeyW" }), PCB)).toEqual({ action: "route", preventDefault: true })
  })

  test("Alt+V arms Route → Via on the PCB only, by its physical key", () => {
    expect(keyAction(key("√", { altKey: true, code: "KeyV" }), PCB)).toEqual({ action: "placeVia", preventDefault: true })
    expect(keyAction(key("v", { altKey: true, code: "KeyV" }), SCHEMATIC)).toBeNull()
  })

  test("V changes the active layer on the PCB (and while routing places a via); nothing on the schematic", () => {
    expect(keyAction(key("v"), PCB)).toEqual({ action: "switchLayer", preventDefault: true })
    expect(keyAction(key("V", { shiftKey: true }), PCB)?.action).toBe("switchLayer")
    expect(keyAction(key("v"), { view: "pcb", drawing: true })?.action).toBe("switchLayer")
    expect(keyAction(key("v"), SCHEMATIC)).toBeNull()
    expect(keyAction(key("v", { typing: true }), PCB)).toBeNull()
  })

  test("while a track is drawn, Space steps its corner mode and Backspace takes back a corner", () => {
    expect(keyAction(key(" "), { view: "pcb", drawing: true })).toEqual({ action: "flipBend", preventDefault: true })
    expect(keyAction(key("Backspace"), { view: "pcb", drawing: true })).toEqual({ action: "removeCorner", preventDefault: true })
  })

  test("Alt+N arms the net label tool on the schematic only", () => {
    expect(keyAction(key("n", { altKey: true, code: "KeyN" }), SCHEMATIC)).toEqual({ action: "armNetLabel", preventDefault: true })
    expect(keyAction(key("n", { altKey: true, code: "KeyN" }), PCB)).toBeNull()
  })

  test("Space rotates and prevents the default in both views", () => {
    for (const state of [SCHEMATIC, PCB]) expect(keyAction(key(" "), state)).toEqual({ action: "rotate", preventDefault: true })
  })

  test("Space flips the bend of the leg to the pointer while the wire tool is drawing", () => {
    expect(keyAction(key(" "), { view: "schematic", drawing: true })).toEqual({ action: "flipBend", preventDefault: true })
  })

  test("the wire's Space follows the key ownership rules: not in a field, on a button or on a focused row", () => {
    const drawing: KeyState = { view: "schematic", drawing: true }
    for (const extra of [{ typing: true }, { onButton: true }, { ownsKeys: true }, { handled: true }]) {
      expect([extra, keyAction(key(" ", extra), drawing)]).toEqual([extra, null])
    }
  })

  test("Space with a modifier does not flip", () => {
    expect(keyAction(key(" ", { ctrlKey: true }), { view: "schematic", drawing: true })).toBeNull()
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

  test("backslash toggles the bottom panel in both views", () => {
    for (const state of [SCHEMATIC, PCB]) expect(keyAction(key("\\"), state)).toEqual({ action: "toggleBottomPanel", preventDefault: false })
  })

  test("the panel keys work with AltGr, which Windows sends as Ctrl+Alt", () => {
    const altGr = { ctrlKey: true, altKey: true }
    expect(keyAction(key("\\", altGr), PCB)?.action).toBe("toggleBottomPanel")
    expect(keyAction(key("[", altGr), SCHEMATIC)?.action).toBe("toggleLeftPanel")
    expect(keyAction(key("]", altGr), PCB)?.action).toBe("toggleRightPanel")
  })

  test("the panel keys work when the browser reports the AltGraph modifier, whatever else it sets", () => {
    expect(keyAction(key("\\", { altGraph: true, altKey: true }), SCHEMATIC)?.action).toBe("toggleBottomPanel")
    expect(keyAction(key("[", { altGraph: true, ctrlKey: true, altKey: true }), PCB)?.action).toBe("toggleLeftPanel")
  })

  test("Ctrl alone with a panel key is left to the browser", () => {
    expect(keyAction(key("[", { ctrlKey: true }), PCB)).toBeNull()
    expect(keyAction(key("\\", { ctrlKey: true }), PCB)).toBeNull()
  })

  test("AltGr does not turn letters into shortcuts", () => {
    expect(keyAction(key("q", { ctrlKey: true, altKey: true, code: "KeyQ" }), PCB)).toBeNull()
    expect(keyAction(key("w", { ctrlKey: true, altKey: true, code: "KeyW" }), SCHEMATIC)).toBeNull()
  })

  test("an AltGr panel key typed in a field is the field's", () => {
    for (const name of ["[", "]", "\\"]) {
      expect(keyAction(key(name, { ctrlKey: true, altKey: true, typing: true }), PCB)).toBeNull()
      expect(keyAction(key(name, { altGraph: true, typing: true }), PCB)).toBeNull()
    }
  })

  test("every key is ignored while typing in a field", () => {
    for (const name of ["w", " ", "k", "h", "q", "[", "]", "\\", "f", "r"]) expect(keyAction(key(name, { typing: true }), SCHEMATIC)).toBeNull()
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

describe("escapeDisarms", () => {
  test("Esc puts a Place tool away", () => {
    expect(escapeDisarms(key("Escape"))).toBe(true)
  })

  test("Esc in a text field (the name input, an Inspector field) is left to the field", () => {
    expect(escapeDisarms(key("Escape", { typing: true }))).toBe(false)
  })

  test("other keys do not put it away", () => {
    expect(escapeDisarms(key("q"))).toBe(false)
  })
})

describe("arrow keys", () => {
  test("move the selection one step, or ten with Shift, and are prevented so the page does not scroll", () => {
    for (const state of [PCB, SCHEMATIC]) {
      expect(keyAction(key("ArrowLeft"), state)).toEqual({ action: "nudgeLeft", preventDefault: true, steps: 1 })
      expect(keyAction(key("ArrowUp", { shiftKey: true }), state)).toEqual({ action: "nudgeUp", preventDefault: true, steps: 10 })
    }
    expect(keyAction(key("ArrowRight"), PCB)?.action).toBe("nudgeRight")
    expect(keyAction(key("ArrowDown"), PCB)?.action).toBe("nudgeDown")
  })

  test("push in world directions, where y points up", () => {
    expect(nudgeDirection("nudgeUp")).toEqual({ dx: 0, dy: 1 })
    expect(nudgeDirection("nudgeDown")).toEqual({ dx: 0, dy: -1 })
    expect(nudgeDirection("nudgeLeft")).toEqual({ dx: -1, dy: 0 })
    expect(nudgeDirection("nudgeRight")).toEqual({ dx: 1, dy: 0 })
    expect(nudgeDirection("rotate")).toBeUndefined()
  })

  test("are not ours in a field, on a focused button, or with Ctrl, Alt or Cmd", () => {
    expect(keyAction(key("ArrowLeft", { typing: true }), PCB)).toBeNull()
    expect(keyAction(key("ArrowLeft", { onButton: true }), PCB)).toBeNull()
    expect(keyAction(key("ArrowLeft", { ctrlKey: true }), PCB)).toBeNull()
    expect(keyAction(key("ArrowLeft", { altKey: true }), PCB)).toBeNull()
    expect(keyAction(key("ArrowLeft", { metaKey: true }), PCB)).toBeNull()
  })
})

describe("Ctrl+F", () => {
  test("is Find, by the character, in both views", () => {
    for (const state of [PCB, SCHEMATIC]) expect(keyAction(key("f", { ctrlKey: true, code: "KeyF" }), state)).toEqual({ action: "find", preventDefault: true })
    expect(keyAction(key("F", { metaKey: true }), PCB)?.action).toBe("find")
  })

  test("is not Find in a field, with Alt, or bare (bare F still fits); with Shift it is Find similar objects", () => {
    expect(keyAction(key("f", { ctrlKey: true, typing: true }), PCB)).toBeNull()
    expect(keyAction(key("F", { ctrlKey: true, shiftKey: true }), PCB)?.action).toBe("findSimilar")
    expect(keyAction(key("f", { ctrlKey: true, altKey: true }), PCB)).toBeNull()
    expect(keyAction(key("f"), PCB)?.action).toBe("fit")
  })
})

describe("the keyboard's context menu", () => {
  test("Shift+F10 and the menu key open it in both views, prevented so the browser's own menu stays shut", () => {
    for (const state of [PCB, SCHEMATIC]) {
      expect(keyAction(key("F10", { shiftKey: true }), state)).toEqual({ action: "contextMenu", preventDefault: true })
      expect(keyAction(key("ContextMenu"), state)).toEqual({ action: "contextMenu", preventDefault: true })
    }
  })

  test("F10 alone, with Ctrl or Alt, or while typing is not the menu", () => {
    expect(keyAction(key("F10"), PCB)).toBeNull()
    expect(keyAction(key("F10", { shiftKey: true, ctrlKey: true }), PCB)).toBeNull()
    expect(keyAction(key("F10", { shiftKey: true, altKey: true }), PCB)).toBeNull()
    expect(keyAction(key("F10", { shiftKey: true, typing: true }), PCB)).toBeNull()
    expect(keyAction(key("ContextMenu", { typing: true }), PCB)).toBeNull()
  })
})

describe("widgets that own their keys", () => {
  test("an arrow on a focused table row does not nudge; on the canvas it does", () => {
    expect(keyAction(key("ArrowDown", { ownsKeys: true }), PCB)).toBeNull()
    expect(keyAction(key("ArrowLeft", { ownsKeys: true }), SCHEMATIC)).toBeNull()
    expect(keyAction(key("ArrowDown"), PCB)?.action).toBe("nudgeDown")
  })

  test("navigation and activation keys do nothing on the canvas from such a widget or once a widget took them", () => {
    for (const name of ["ArrowUp", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter", " ", "Delete", "Backspace", "r", "f", "k", "h", "w", "q"]) {
      for (const state of [PCB, SCHEMATIC]) expect([name, keyAction(key(name, { ownsKeys: true }), state)]).toEqual([name, null])
    }
    expect(keyAction(key("F", { shiftKey: true, ownsKeys: true }), PCB)).toBeNull()
    expect(keyAction(key("ArrowUp", { handled: true }), PCB)).toBeNull()
    expect(keyAction(key("r", { handled: true }), PCB)).toBeNull()
    expect(keyAction(key("r"), PCB)?.action).toBe("rotate")
  })

  test("Ctrl and Cmd shortcuts, the panel keys, the Alt tools and Shift+F10 still work in such a widget", () => {
    const owns = { ownsKeys: true }
    expect(keyAction(key("z", { ctrlKey: true, ...owns }), PCB)?.action).toBe("undo")
    expect(keyAction(key("Z", { metaKey: true, ...owns }), SCHEMATIC)?.action).toBe("undo")
    expect(keyAction(key("y", { ctrlKey: true, ...owns }), PCB)?.action).toBe("redo")
    expect(keyAction(key("Z", { ctrlKey: true, shiftKey: true, ...owns }), SCHEMATIC)?.action).toBe("redo")
    expect(keyAction(key("a", { ctrlKey: true, ...owns }), PCB)?.action).toBe("selectAll")
    expect(keyAction(key("f", { ctrlKey: true, ...owns }), PCB)?.action).toBe("find")
    expect(keyAction(key("o", { ctrlKey: true, ...owns }), SCHEMATIC)?.action).toBe("openFile")
    expect(keyAction(key("[", owns), PCB)?.action).toBe("toggleLeftPanel")
    expect(keyAction(key("]", owns), SCHEMATIC)?.action).toBe("toggleRightPanel")
    expect(keyAction(key("\\", owns), PCB)?.action).toBe("toggleBottomPanel")
    expect(keyAction(key("\\", { altGraph: true, ctrlKey: true, altKey: true, ...owns }), PCB)?.action).toBe("toggleBottomPanel")
    expect(keyAction(key("[", { altGraph: true, ...owns }), SCHEMATIC)?.action).toBe("toggleLeftPanel")
    expect(keyAction(key("w", { altKey: true, code: "KeyW", ...owns }), SCHEMATIC)?.action).toBe("wire")
    expect(keyAction(key("n", { altKey: true, code: "KeyN", ...owns }), SCHEMATIC)?.action).toBe("armNetLabel")
    expect(keyAction(key("F10", { shiftKey: true, ...owns }), PCB)?.action).toBe("contextMenu")
  })
})

/** What a later window listener reads after the canvas's listener ran first with `selected` parts selected (use-part-keys.ts). */
function afterCanvas(input: KeyInput, state: KeyState, selected: number): KeyInput {
  const hit = keyAction(input, state)
  return { ...input, handled: hit !== null && claimsKey(hit.action, selected, false, hit.preventDefault) }
}

describe("keys another listener already prevented", () => {
  test("Ctrl+Z, Ctrl+A, Ctrl+F, Ctrl+O and the Alt tools still resolve for an event already prevented", () => {
    expect(keyAction(key("z", { ctrlKey: true, handled: true }), PCB)?.action).toBe("undo")
    expect(keyAction(key("y", { ctrlKey: true, handled: true }), PCB)?.action).toBe("redo")
    expect(keyAction(key("Z", { ctrlKey: true, shiftKey: true, handled: true }), PCB)?.action).toBe("redo")
    expect(keyAction(key("a", { ctrlKey: true, handled: true }), PCB)?.action).toBe("selectAll")
    expect(keyAction(key("f", { ctrlKey: true, handled: true }), PCB)?.action).toBe("find")
    expect(keyAction(key("o", { ctrlKey: true, handled: true }), PCB)?.action).toBe("openFile")
    expect(keyAction(key("w", { altKey: true, code: "KeyW", handled: true }), SCHEMATIC)?.action).toBe("wire")
  })

  test("with a part selected and the canvas listening first, the app's, the workspace's and the tools' keys reach their listener", () => {
    const cases: [KeyInput, KeyState, string][] = [
      [key("z", { ctrlKey: true }), PCB, "undo"],
      [key("y", { ctrlKey: true }), PCB, "redo"],
      [key("Z", { ctrlKey: true, shiftKey: true }), SCHEMATIC, "redo"],
      [key("a", { ctrlKey: true }), PCB, "selectAll"],
      [key("f", { ctrlKey: true }), PCB, "find"],
      [key("o", { ctrlKey: true }), PCB, "openFile"],
      [key("F", { shiftKey: true }), PCB, "openLibrary"],
      [key("F", { shiftKey: true }), SCHEMATIC, "openLibrary"],
      [key("w", { altKey: true, code: "KeyW" }), SCHEMATIC, "wire"],
      [key("n", { altKey: true, code: "KeyN" }), SCHEMATIC, "armNetLabel"],
    ]
    for (const [input, state, action] of cases) expect([input.key, keyAction(afterCanvas(input, state, 1), state)?.action]).toEqual([input.key, action])
  })

  test("the canvas still keeps its own arrows and Space while parts are selected", () => {
    expect(afterCanvas(key("ArrowLeft"), PCB, 1).handled).toBe(true)
    expect(afterCanvas(key(" "), PCB, 1).handled).toBe(true)
    expect(afterCanvas(key("ArrowLeft"), PCB, 0).handled).toBe(false)
  })
})

describe("Delete and Backspace", () => {
  test("remove the selected parts from the canvas in both views, also with Shift", () => {
    expect(keyAction(key("Delete"), PCB)).toEqual({ action: "delete", preventDefault: false })
    expect(keyAction(key("Backspace"), SCHEMATIC)).toEqual({ action: "delete", preventDefault: false })
    expect(keyAction(key("Delete", { shiftKey: true }), SCHEMATIC)?.action).toBe("delete")
  })

  test("on a focused Library row, list or tab, or in a field, they remove nothing", () => {
    for (const name of ["Delete", "Backspace"]) {
      expect(keyAction(key(name, { ownsKeys: true }), PCB)).toBeNull()
      expect(keyAction(key(name, { typing: true }), SCHEMATIC)).toBeNull()
      expect(keyAction(key(name, { handled: true }), PCB)).toBeNull()
    }
  })

  test("with Ctrl, Alt or Cmd they are not ours", () => {
    for (const extra of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) expect(keyAction(key("Delete", extra), PCB)).toBeNull()
  })

  test("while a wire is drawn, Backspace takes back the last corner only from the canvas, and Delete does nothing", () => {
    const drawing: KeyState = { view: "schematic", drawing: true }
    expect(keyAction(key("Backspace"), drawing)).toEqual({ action: "removeCorner", preventDefault: true })
    expect(keyAction(key("Delete"), drawing)).toBeNull()
    expect(keyAction(key("Backspace", { ownsKeys: true }), drawing)).toBeNull()
    expect(keyAction(key("Backspace", { typing: true }), drawing)).toBeNull()
  })

  test("the canvas runs Delete without keeping it from the page; the wire tool, not the canvas, takes Backspace while drawing", () => {
    expect(afterCanvas(key("Delete"), PCB, 1).handled).toBe(false)
    expect(afterCanvas(key("Backspace"), { view: "schematic", drawing: true }, 1).handled).toBe(false)
    expect(claimsKey("removeCorner", 1, true, true)).toBe(false)
  })
})

describe("rows that are placed parts (the Component tree)", () => {
  const tree = { ownsKeys: true, partRows: true }

  test("Delete and Backspace on a focused row act on the selection, as EasyEDA's tree does", () => {
    expect(keyAction(key("Delete", tree), PCB)).toEqual({ action: "delete", preventDefault: false })
    expect(keyAction(key("Backspace", tree), SCHEMATIC)?.action).toBe("delete")
    expect(keyAction(key("Delete", { ...tree, onButton: true }), PCB)?.action).toBe("delete")
  })

  test("the tree still keeps its other navigation and activation keys", () => {
    for (const name of ["ArrowDown", "Home", "End", "Enter", " ", "r", "h"]) expect([name, keyAction(key(name, tree), PCB)]).toEqual([name, null])
  })

  test("rows that are not placed parts keep blocking Delete and Backspace", () => {
    for (const name of ["Delete", "Backspace"]) expect(keyAction(key(name, { ownsKeys: true }), PCB)).toBeNull()
  })

  test("while a wire is drawn, Backspace on a tree row takes no corner back, and a prevented Delete stays prevented", () => {
    const drawing: KeyState = { view: "schematic", drawing: true }
    expect(keyAction(key("Backspace", tree), drawing)).toBeNull()
    expect(keyAction(key("Delete", tree), drawing)).toBeNull()
    expect(keyAction(key("Delete", { ...tree, handled: true }), PCB)).toBeNull()
  })
})

describe("the drawing tool keys", () => {
  const tools = [["b", "drawBus"], ["l", "drawPolyline"], ["r", "drawRectangle"], ["c", "drawCircle"], ["a", "drawArc"], ["t", "drawText"]] as const

  test("Alt+B, Alt+L, Alt+R, Alt+C and Alt+A arm the bus and drawing tools on the schematic only, Alt+T the text tool on either, by the physical key", () => {
    for (const [letter, action] of tools) {
      const code = `Key${letter.toUpperCase()}`
      expect(keyAction(key(letter, { altKey: true, code }), SCHEMATIC)).toEqual({ action, preventDefault: true })
      // Alt changes the character on some layouts; the physical key still counts.
      expect(keyAction(key("¬", { altKey: true, code }), SCHEMATIC)?.action).toBe(action)
      expect(keyAction(key(letter, { altKey: true, code }), PCB)).toEqual(action === "drawText" ? { action, preventDefault: true } : null)
      expect(keyAction(key(letter, { altKey: true, code, typing: true }), SCHEMATIC)).toBeNull()
      expect(keyAction(key(letter, { altKey: true, shiftKey: true, code }), SCHEMATIC)).toBeNull()
    }
  })

  test("while a polyline is drawn, Space flips the bend and Backspace removes a corner", () => {
    const drawing = { ...SCHEMATIC, drawing: true }
    expect(keyAction(key(" "), drawing)).toEqual({ action: "flipBend", preventDefault: true })
    expect(keyAction(key("Backspace"), drawing)).toEqual({ action: "removeCorner", preventDefault: true })
  })

  test("while a shape is drawn, Enter finishes it, but not on a focused button or row, in a field or with a modifier", () => {
    const drawing = { ...SCHEMATIC, drawing: true }
    expect(keyAction(key("Enter"), drawing)).toEqual({ action: "finishShape", preventDefault: true })
    for (const extra of [{ onButton: true }, { ownsKeys: true }, { typing: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
      expect(keyAction(key("Enter", extra), drawing)).toBeNull()
    }
    expect(keyAction(key("Enter"), SCHEMATIC)).toBeNull()
  })
})
