import { describe, expect, test } from "vitest"
import {
  claimsKey,
  editSent,
  editSettled,
  gateOpen,
  OPEN_GATE,
  pressNudge,
  pressTurn,
  releaseTurn,
  settleNudge,
  type Burst,
  type BurstStep,
  type DesignState,
} from "../studio/src/pcb/key-burst.js"

const circuit = {}
const NAMES = ["R1"]
const right = { x: 0.5, y: 0 }

describe("pressNudge", () => {
  test("the first press starts a burst and sends its offset", () => {
    const step = pressNudge(undefined, circuit, NAMES, right)
    expect(step).toMatchObject({ send: right, fresh: true, burst: { total: right, inFlight: true } })
  })

  test("presses while an edit is in flight are merged and not sent", () => {
    let burst: Burst = pressNudge(undefined, circuit, NAMES, right).burst
    for (let i = 0; i < 2; i++) {
      const step: BurstStep<object> = pressNudge(burst, circuit, NAMES, right)
      expect(step.send).toBeNull()
      burst = step.burst
    }
    expect(burst).toMatchObject({ total: { x: 1.5, y: 0 }, dirty: true, inFlight: true })
  })

  test("when the edit resolves, the merged presses go as one edit with the summed offset", () => {
    let burst = pressNudge(undefined, circuit, NAMES, right).burst
    burst = pressNudge(burst, circuit, NAMES, right).burst
    burst = pressNudge(burst, circuit, NAMES, right).burst
    const next = settleNudge(burst, true)
    expect(next?.send).toEqual({ x: 1.5, y: 0 })
    expect(next?.burst).toMatchObject({ inFlight: true, dirty: false })
    expect(settleNudge(next!.burst, true)).toMatchObject({ send: null, burst: { inFlight: false } })
  })

  test("a press after the edit resolved, before the circuit reloaded, adds to the same total", () => {
    const settled = settleNudge(pressNudge(undefined, circuit, NAMES, right).burst, true)!.burst
    expect(pressNudge(settled, circuit, NAMES, right)).toMatchObject({ send: { x: 1, y: 0 }, fresh: false })
  })

  test("a press once the circuit has reloaded, or on another selection, starts afresh", () => {
    const settled = settleNudge(pressNudge(undefined, circuit, NAMES, right).burst, true)!.burst
    expect(pressNudge(settled, {}, NAMES, right)).toMatchObject({ send: right, fresh: true })
    expect(pressNudge(settled, circuit, ["R2"], right)).toMatchObject({ send: right, fresh: true })
  })

  test("a failed edit ends the burst", () => {
    expect(settleNudge(pressNudge(undefined, circuit, NAMES, right).burst, false)).toBeUndefined()
  })
})

describe("the turn gate", () => {
  const before: DesignState = { builtFrom: 5, moveWaiting: false }
  const after: DesignState = { builtFrom: 20, moveWaiting: false }

  test("is open with nothing sent; a repeating key is ignored", () => {
    expect(gateOpen(OPEN_GATE, before)).toBe(true)
    expect(pressTurn(OPEN_GATE, NAMES, false, before)).toEqual({ gate: OPEN_GATE, send: true })
    expect(pressTurn(OPEN_GATE, NAMES, true, before)).toEqual({ gate: OPEN_GATE, send: false })
  })

  test("stays shut while an edit is in flight, and after it until a build that started later has finished", () => {
    const sent = editSent(OPEN_GATE, 10)
    expect(gateOpen(sent, after)).toBe(false)
    const resolved = editSettled(sent, true, 10, undefined)
    expect(gateOpen(resolved, before)).toBe(false)
    expect(gateOpen(resolved, { builtFrom: 10, moveWaiting: false })).toBe(false)
    expect(gateOpen(resolved, after)).toBe(true)
  })

  test("stays shut while a dragged move waits for its build", () => {
    expect(gateOpen(OPEN_GATE, { builtFrom: 20, moveWaiting: true })).toBe(false)
  })

  test("holds the presses made while shut and lets them go one at a time once open", () => {
    let gate = editSettled(editSent(OPEN_GATE, 10), true, 10, undefined)
    for (let i = 0; i < 2; i++) {
      const press = pressTurn(gate, NAMES, false, before)
      expect(press.send).toBe(false)
      gate = press.gate
    }
    expect(gate.held).toEqual({ names: NAMES, count: 2 })
    expect(releaseTurn(gate, NAMES, before)).toEqual({ gate, send: false })
    const first = releaseTurn(gate, NAMES, after)
    expect(first).toMatchObject({ send: true, gate: { held: { count: 1 } } })
    expect(releaseTurn(first.gate, NAMES, after)).toMatchObject({ send: true, gate: { held: undefined } })
  })

  test("drops the held presses when the selection changed meanwhile", () => {
    const gate = pressTurn(editSent(OPEN_GATE, 10), NAMES, false, before).gate
    expect(releaseTurn(editSettled(gate, true, 10, undefined), ["R2"], after)).toEqual({ gate: { inFlight: 0, sentAt: 10, held: undefined }, send: false })
  })

  test("a failed edit writes nothing, so the gate waits again for what it waited for before, and drops the held presses", () => {
    const held = pressTurn(editSent(editSettled(editSent(OPEN_GATE, 4), true, 4, undefined), 10), NAMES, false, after).gate
    const failed = editSettled(held, false, 10, 4)
    expect(failed).toEqual({ inFlight: 0, sentAt: 4, held: undefined })
    expect(gateOpen(failed, before)).toBe(true)
  })

  test("a failure does not undo the wait for an edit sent after it", () => {
    const two = editSent(editSent(OPEN_GATE, 10), 12)
    expect(editSettled(two, false, 10, undefined)).toEqual({ inFlight: 1, sentAt: 12, held: undefined })
  })
})

describe("claimsKey", () => {
  test("arrows are left to the page when nothing is selected or a tool uses the keys", () => {
    expect(claimsKey("nudgeLeft", 0, false, true)).toBe(false)
    expect(claimsKey("nudgeLeft", 2, true, true)).toBe(false)
    expect(claimsKey("nudgeLeft", 2, false, true)).toBe(true)
  })

  test("Rotate is kept from the page only with a selection and no tool; other keys follow the key map", () => {
    expect(claimsKey("rotate", 0, false, true)).toBe(false)
    expect(claimsKey("rotate", 1, true, true)).toBe(false)
    expect(claimsKey("rotate", 1, false, true)).toBe(true)
    expect(claimsKey("fit", 0, false, false)).toBe(false)
    expect(claimsKey("openLibrary", 0, false, true)).toBe(true)
  })
})
