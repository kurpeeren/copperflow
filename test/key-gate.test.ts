import { describe, expect, test } from "vitest"
import { createKeyGate, installKeyGate } from "../studio/src/shell/key-gate.js"

interface Press {
  key: string
  stopped: number
  stopImmediatePropagation(): void
}

const press = (key: string): Press => ({
  key,
  stopped: 0,
  stopImmediatePropagation() {
    this.stopped++
  },
})

const KEYS = ["a", "Enter", " ", "Tab", "Escape", "ArrowLeft", "Delete", "[", "\\", "Alt+ArrowLeft", "Ctrl+z", "Meta+k", "F5"]

describe("the key gate", () => {
  test("with a holder, every key goes to it and stops there: letters, panel keys, Tab and modified keys alike", () => {
    const gate = createKeyGate<Press>()
    const seen: string[] = []
    gate.hold((event) => seen.push(event.key))
    for (const key of KEYS) {
      const event = press(key)
      expect([key, gate.dispatch(event), event.stopped]).toEqual([key, true, 1])
    }
    expect(seen).toEqual(KEYS)
  })

  test("with nobody holding, no key is touched", () => {
    const gate = createKeyGate<Press>()
    for (const key of KEYS) {
      const event = press(key)
      expect([key, gate.dispatch(event), event.stopped]).toEqual([key, false, 0])
    }
  })

  test("once the last holder lets go the keys flow again", () => {
    const gate = createKeyGate<Press>()
    const release = gate.hold(() => undefined)
    release()
    const event = press("r")
    expect(gate.dispatch(event)).toBe(false)
    expect(event.stopped).toBe(0)
  })

  test("the gate listens to keydown in the capture phase, and stops listening when removed", () => {
    const added: [string, boolean][] = []
    const removed: [string, boolean][] = []
    const target = {
      addEventListener: (type: string, _listener: unknown, capture: boolean) => void added.push([type, capture]),
      removeEventListener: (type: string, _listener: unknown, capture: boolean) => void removed.push([type, capture]),
    }
    installKeyGate(target as unknown as Window)()
    expect(added).toEqual([["keydown", true]])
    expect(removed).toEqual([["keydown", true]])
  })
})
