import { describe, expect, test } from "vitest"
import { AI_LOCK_MESSAGE, LOCKED_COMMANDS, afterChange, blocksCommand, lockLabel, blocksGesture, blocksKey, blocksRequest, lockedOff, startLock, toggleLock } from "../studio/src/ai-lock.js"
import { createLockGate } from "../studio/src/ai-lock-gate.js"
import { commandOwner } from "../studio/src/shell/command-owners.js"
import { ICONS } from "../studio/src/icon-shapes.js"

describe("the AI lock's state", () => {
  test("a project opens closed when the newest change is the agent's, else open", () => {
    expect(startLock("ai").closed).toBe(true)
    expect(startLock("human").closed).toBe(false)
    expect(startLock(undefined).closed).toBe(false)
  })

  test("a click toggles it, and opening starts with no change of the person's own", () => {
    const opened = toggleLock(startLock("ai"))
    expect(opened).toEqual({ closed: false, editedSinceOpen: false })
    expect(toggleLock(opened).closed).toBe(true)
  })

  test("an agent's change closes an open lock", () => {
    expect(afterChange(startLock("human"), "ai").closed).toBe(true)
  })

  test("it stays open when the person has changed something since opening it", () => {
    const busy = afterChange(startLock("human"), "human")
    expect(busy.editedSinceOpen).toBe(true)
    expect(afterChange(busy, "ai").closed).toBe(false)
  })

  test("after closing and opening again, the next agent change closes it", () => {
    const busy = afterChange(startLock("human"), "human")
    expect(afterChange(toggleLock(toggleLock(busy)), "ai").closed).toBe(true)
  })

  test("it never opens by itself", () => {
    const closed = startLock("ai")
    expect(afterChange(closed, "human").closed).toBe(true)
    expect(afterChange(closed, "ai").closed).toBe(true)
  })
})

describe("what the closed lock blocks", () => {
  test("the requests that write the circuit, the layout, the rules or the history", () => {
    for (const path of ["/api/edit", "/api/layout", "/api/undo", "/api/redo", "/api/rename-parts", "/api/route", "/api/autoplace", "/api/fit-board", "/api/unroute", "/api/rules", "/api/place", "/api/new-circuit"]) {
      expect(blocksRequest(path, {}), path).toBe(true)
    }
    expect(blocksRequest("/api/make-sheet", { parts: ["R1"] })).toBe(true)
  })

  test("not looking, export, notes, part locks or a preview", () => {
    for (const path of ["/api/lock", "/api/mark", "/api/unmark", "/api/export", "/api/package", "/api/build", "/api/route/cancel", "/api/autoplace/cancel", "/api/verify", "/api/import-part", "/api/create-part"]) {
      expect(blocksRequest(path, {}), path).toBe(false)
    }
    expect(blocksRequest("/api/make-sheet", { preview: true })).toBe(false)
    expect(blocksRequest("/api/edit", undefined)).toBe(false)
  })

  test("the editing keys, not the looking ones", () => {
    for (const action of ["undo", "redo", "delete", "rotate", "nudgeLeft", "wire", "route", "paste", "flip"] as const) expect(blocksKey(action), action).toBe(true)
    for (const action of ["fit", "selectAll", "find", "copy", "highlight", "toggleUnit", "contextMenu"] as const) expect(blocksKey(action), action).toBe(false)
  })

  test("the gestures that move things, not panning, selecting or a note", () => {
    for (const start of ["move", "moveGroup", "label", "text", "wireSegment", "wireCorner"] as const) expect(blocksGesture(start), start).toBe(true)
    for (const start of ["pan", "rightPress", "box", "addBox", "toggle", "note", "zoom", "wire", "none"] as const) expect(blocksGesture(start), start).toBe(false)
  })

  test("menus show the editing commands disabled with the lock's message, and leave the rest", () => {
    const off = lockedOff(true)
    for (const command of ["undo", "redo", "delete", "wire", "placeComponent", "autoroute", "designRules", "paste"] as const) expect(off[command]).toBe(AI_LOCK_MESSAGE)
    for (const command of ["exportFabrication", "checkDrc", "find", "lock", "unlock", "noteBox", "zoomIn", "copy", "history"] as const) expect(off[command]).toBeUndefined()
    expect(lockedOff(false)).toEqual({})
  })

  test("every locked command is one someone answers", () => {
    for (const command of LOCKED_COMMANDS) expect(commandOwner(command), command).toBeDefined()
  })
})

describe("the lock's gate", () => {
  test("lets everything through while open", () => {
    const told: string[] = []
    const gate = createLockGate((text) => told.push(text))
    expect(gate.refuses()).toBe(false)
    expect(told).toEqual([])
  })

  test("refuses while closed and says so on the first attempt only, again after the next close", () => {
    const told: string[] = []
    const gate = createLockGate((text) => told.push(text))
    gate.set(true)
    expect(gate.refuses()).toBe(true)
    expect(gate.refuses()).toBe(true)
    expect(told).toEqual([AI_LOCK_MESSAGE])
    gate.set(false)
    gate.set(true)
    gate.refuses()
    expect(told).toEqual([AI_LOCK_MESSAGE, AI_LOCK_MESSAGE])
  })
})

describe("the AI lock's padlocks", () => {
  test("are in the icon set, closed and open, and differ", () => {
    expect(ICONS.padlock.length).toBeGreaterThan(0)
    expect(ICONS.padlockOpen.length).toBeGreaterThan(0)
    expect(ICONS.padlock).not.toEqual(ICONS.padlockOpen)
  })
})

describe("the control's words", () => {
  test("closed and open", () => {
    expect(lockLabel(true)).toEqual({ title: "AI is driving", hint: "Unlock to edit" })
    expect(lockLabel(false)).toEqual({ title: "You are editing", hint: "Lock for the agent" })
  })

  test("a locked command is refused, a looking one is not", () => {
    expect(blocksCommand("undo")).toBe(true)
    expect(blocksCommand("exportFabrication")).toBe(false)
  })
})
