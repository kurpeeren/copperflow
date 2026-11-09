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
  const before: DesignState = { buildId: "b1", buildStatus: "done", moveWaiting: false }
  const after: DesignState = { buildId: "b2", buildStatus: "done", moveWaiting: false }
  const failed: DesignState = { buildId: "b2", buildStatus: "failed", moveWaiting: false }
  const running: DesignState = { buildId: "b1", buildStatus: "building", moveWaiting: false }

  test("is open with nothing sent; a repeating key is ignored", () => {
    expect(gateOpen(OPEN_GATE, before)).toBe(true)
    expect(pressTurn(OPEN_GATE, NAMES, false, before)).toEqual({ gate: OPEN_GATE, send: true })
    expect(pressTurn(OPEN_GATE, NAMES, true, before)).toEqual({ gate: OPEN_GATE, send: false })
  })

  test("stays shut while an edit is in flight, and after it until a build with another id has finished", () => {
    const sent = editSent(OPEN_GATE, "b1")
    expect(gateOpen(sent, after)).toBe(false)
    const resolved = editSettled(sent, true, sent.seq, undefined)
    expect(gateOpen(resolved, before)).toBe(false)
    expect(gateOpen(resolved, running)).toBe(false)
    expect(gateOpen(resolved, after)).toBe(true)
  })

  test("an edit sent before any build has an id waits for the first build", () => {
    const resolved = editSettled(editSent(OPEN_GATE, undefined), true, 1, undefined)
    expect(gateOpen(resolved, { buildId: undefined, buildStatus: "idle", moveWaiting: false })).toBe(false)
    expect(gateOpen(resolved, before)).toBe(true)
  })

  test("stays shut after a failed build until a successful one", () => {
    const resolved = editSettled(editSent(OPEN_GATE, "b1"), true, 1, undefined)
    expect(gateOpen(resolved, failed)).toBe(false)
    expect(gateOpen(resolved, { buildId: "b3", buildStatus: "done", moveWaiting: false })).toBe(true)
  })

  test("stays shut while a dragged move waits for its build", () => {
    expect(gateOpen(OPEN_GATE, { ...after, moveWaiting: true })).toBe(false)
  })

  test("holds the presses made while shut and lets them go one at a time once open", () => {
    let gate = editSettled(editSent(OPEN_GATE, "b1"), true, 1, undefined)
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

  test("a failed build does not release the held presses; the next successful one does", () => {
    const gate = pressTurn(editSettled(editSent(OPEN_GATE, "b1"), true, 1, undefined), NAMES, false, before).gate
    expect(releaseTurn(gate, NAMES, failed)).toEqual({ gate, send: false })
    expect(releaseTurn(gate, NAMES, { buildId: "b3", buildStatus: "done", moveWaiting: false })).toMatchObject({ send: true })
  })

  test("once open the gate stays open: a later failed build does not shut it again", () => {
    const gate = editSettled(editSent(OPEN_GATE, "b1"), true, 1, undefined)
    const open = releaseTurn(gate, NAMES, after).gate
    expect(gateOpen(open, failed)).toBe(true)
    expect(pressTurn(open, NAMES, false, failed).send).toBe(true)
  })

  test("drops the held presses when the selection changed meanwhile", () => {
    const gate = pressTurn(editSent(OPEN_GATE, "b1"), NAMES, false, before).gate
    expect(releaseTurn(editSettled(gate, true, 1, undefined), ["R2"], after)).toEqual({ gate: { ...OPEN_GATE, seq: 1 }, send: false })
  })

  test("a failed edit writes nothing, so the gate waits again for what it waited for before, and drops the held presses", () => {
    const first = editSettled(editSent(OPEN_GATE, "b0"), true, 1, undefined)
    const held = pressTurn(editSent(first, "b1"), NAMES, false, after).gate
    const waited = editSettled(held, false, 2, first.waiting)
    expect(waited).toMatchObject({ inFlight: 0, waiting: { from: "b0", seq: 1 }, held: undefined })
    expect(gateOpen(waited, before)).toBe(true)
  })

  test("a failed edit that waited for nothing leaves the gate open", () => {
    const failedEdit = editSettled(editSent(OPEN_GATE, "b1"), false, 1, undefined)
    expect(gateOpen(failedEdit, before)).toBe(true)
  })

  test("a failure does not undo the wait for an edit sent after it", () => {
    const two = editSent(editSent(OPEN_GATE, "b1"), "b1")
    expect(editSettled(two, false, 1, undefined)).toMatchObject({ inFlight: 1, waiting: { from: "b1", seq: 2 }, held: undefined })
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
