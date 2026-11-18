import { describe, expect, test } from "vitest"
import { commandOwner, commandView, TEXT_COMMANDS } from "../studio/src/shell/command-owners.js"
import { keyAction, type KeyInput } from "../studio/src/pcb/canvas-keys.js"
import { AI_LOCK_MESSAGE } from "../studio/src/ai-lock.js"
import { ARMED_BOARD_TEXT, BOARD_TEXT_HINT, boardTextCancel, newTextAfterBuild, boardTextLockProblem, boardTextHint, boardTextPlacement, boardTextPress, boardTextSide } from "../studio/src/pcb/board-text-tool.js"

const BOX = { minX: 0, minY: 0, maxX: 50, maxY: 30 }

const alt = (letter: string): KeyInput => ({ key: letter, code: `Key${letter.toUpperCase()}`, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, typing: false })

describe("Place → Text is routed to the view that is open", () => {
  test("either canvas answers it, so it never switches views", () => {
    expect(TEXT_COMMANDS).toEqual(["drawText"])
    expect(commandOwner("drawText")).toBe("canvas")
    expect(commandView("drawText")).toBeUndefined()
  })

  test("the schematic's other drawing tools still switch to the schematic, the PCB's tools to the PCB", () => {
    for (const command of ["drawBus", "drawPolyline", "drawArc", "drawCircle", "drawRectangle", "wire", "junction"] as const) expect([command, commandView(command)]).toEqual([command, "schematic"])
    for (const command of ["singleRouting", "placePour", "placeHole", "filletTracks"] as const) expect([command, commandView(command)]).toEqual([command, "pcb"])
    expect(commandView("zoomIn")).toBeUndefined()
  })

  test("Alt+T arms the text tool on the PCB as on the schematic", () => {
    expect(keyAction(alt("t"), { view: "pcb" })).toEqual({ action: "drawText", preventDefault: true })
    expect(keyAction(alt("t"), { view: "schematic" })).toEqual({ action: "drawText", preventDefault: true })
  })
})

describe("the board text tool", () => {
  test("armed it waits for a click and says so", () => {
    expect(BOARD_TEXT_HINT).toBe("Click on the board to place text (Esc cancels)")
    expect(boardTextHint(ARMED_BOARD_TEXT)).toBe(BOARD_TEXT_HINT)
    expect(boardTextHint(null)).toBeUndefined()
  })

  test("a click asks for the words at the snapped point, rounded to a micrometre", () => {
    expect(boardTextPress({ x: 10.37, y: 4.12 }, 0.5, true)).toEqual({ at: { x: 10.5, y: 4 } })
    expect(boardTextPress({ x: 10.123456, y: 4.0000004 }, 0.5, false)).toEqual({ at: { x: 10.123, y: 4 } })
    expect(boardTextHint({ at: { x: 1, y: 1 } })).toBe("Type the text; Enter places it, Esc cancels")
  })

  test("Esc closes the field first and keeps the tool, then puts the tool away", () => {
    const asking = boardTextPress({ x: 1, y: 1 }, 1, true)
    expect(boardTextCancel(asking)).toEqual(ARMED_BOARD_TEXT)
    expect(boardTextCancel(ARMED_BOARD_TEXT)).toBeNull()
  })

  test("the side follows the working layer", () => {
    expect(boardTextSide("top")).toBe("top")
    expect(boardTextSide("bottom")).toBe("bottom")
  })

  test("confirmed words make one addSilkText edit at the default height", () => {
    expect(boardTextPlacement("  REV A ", { x: 10, y: 5 }, "top", BOX)).toEqual({
      edit: { kind: "addSilkText", text: "REV A", x: 10, y: 5, layer: "top" },
      summary: 'add silkscreen text "REV A" on the top',
    })
    expect(boardTextPlacement("GND", { x: 10, y: 5 }, "bottom", BOX)).toMatchObject({ edit: { layer: "bottom" }, summary: 'add silkscreen text "GND" on the bottom' })
  })

  test("the engine's refusals are told in plain words and nothing is made", () => {
    expect(boardTextPlacement("   ", { x: 1, y: 1 }, "top", BOX)).toEqual({ message: "Not placed: text must be some words, not empty" })
    const drawn = boardTextPlacement("Ω", { x: 1, y: 1 }, "top", BOX)
    expect("message" in drawn && drawn.message.startsWith('Not placed: the silkscreen lettering cannot draw "Ω"')).toBe(true)
    expect(boardTextPlacement("A", { x: 60, y: 1 }, "top", BOX)).toEqual({ message: "Not placed: the click is off the board; click inside the board outline" })
    expect(boardTextPlacement("A", { x: 60, y: 1 }, "top", undefined)).toHaveProperty("edit")
  })
})

describe("after the edit", () => {
  test("the text selected is the one new since the edit was sent, not a guessed id", () => {
    expect(newTextAfterBuild(new Set(["silkscreentext:1"]), ["silkscreentext:1", "silkscreentext:2"])).toBe("silkscreentext:2")
    expect(newTextAfterBuild(new Set(["silkscreentext:1"]), ["silkscreentext:1"])).toBeUndefined()
    expect(newTextAfterBuild(new Set(), [])).toBeUndefined()
  })

  test("with the AI lock closed, Enter keeps the field and says why in the lock's words", () => {
    expect(boardTextLockProblem(true)).toBe(AI_LOCK_MESSAGE)
    expect(boardTextLockProblem(false)).toBeUndefined()
  })
})
