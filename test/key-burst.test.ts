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
  // The edit under test was written at server mark 5. A build that started at mark 3 began before the write; one at 7 after it.
  const stale: DesignState = { builtMark: 3, buildStatus: "done", moveWaiting: false }
  const fresh: DesignState = { builtMark: 7, buildStatus: "done", moveWaiting: false }
  const failed: DesignState = { builtMark: 7, buildStatus: "failed", moveWaiting: false }
  const running: DesignState = { builtMark: 3, buildStatus: "building", moveWaiting: false }
  const written = (gate = OPEN_GATE) => editSettled(editSent(gate), true, gate.seq + 1, gate.waiting, 5)

  test("is open with nothing sent; a repeating key is ignored", () => {
    expect(gateOpen(OPEN_GATE, stale)).toBe(true)
    expect(pressTurn(OPEN_GATE, NAMES, false, stale)).toEqual({ gate: OPEN_GATE, send: true })
    expect(pressTurn(OPEN_GATE, NAMES, true, stale)).toEqual({ gate: OPEN_GATE, send: false })
  })

  test("stays shut while an edit is in flight, and after it until a build that started after the write has finished", () => {
    const sent = editSent(OPEN_GATE)
    expect(gateOpen(sent, fresh)).toBe(false)
    expect(gateOpen(written(), stale)).toBe(false)
    expect(gateOpen(written(), running)).toBe(false)
    expect(gateOpen(written(), fresh)).toBe(true)
  })

  test("a build that finished after the edit but started before it does not open the gate, whatever its id", () => {
    expect(gateOpen(written(), { builtMark: 4, buildStatus: "done", moveWaiting: false })).toBe(false)
  })

  test("a build started at the write's own mark is not after it", () => {
    expect(gateOpen(written(), { builtMark: 5, buildStatus: "done", moveWaiting: false })).toBe(false)
    expect(gateOpen(written(), { builtMark: 6, buildStatus: "done", moveWaiting: false })).toBe(true)
  })

  test("with no build shown yet the gate waits for the first one", () => {
    expect(gateOpen(written(), { builtMark: undefined, buildStatus: "idle", moveWaiting: false })).toBe(false)
  })

  test("stays shut after a failed build until a successful one", () => {
    expect(gateOpen(written(), failed)).toBe(false)
    expect(gateOpen(written(), { builtMark: 9, buildStatus: "done", moveWaiting: false })).toBe(true)
  })

  test("stays shut while a dragged move waits for its build", () => {
    expect(gateOpen(OPEN_GATE, { ...fresh, moveWaiting: true })).toBe(false)
  })

  test("waits for the latest write of several edits", () => {
    const second = editSettled(editSent(written()), true, 2, written().waiting, 9)
    expect(gateOpen(second, fresh)).toBe(false)
    expect(gateOpen(second, { builtMark: 10, buildStatus: "done", moveWaiting: false })).toBe(true)
  })

  test("holds the presses made while shut and lets them go one at a time once open", () => {
    let gate = written()
    for (let i = 0; i < 2; i++) {
      const press = pressTurn(gate, NAMES, false, stale)
      expect(press.send).toBe(false)
      gate = press.gate
    }
    expect(gate.held).toEqual({ names: NAMES, count: 2 })
    expect(releaseTurn(gate, NAMES, stale)).toEqual({ gate, send: false })
    const first = releaseTurn(gate, NAMES, fresh)
    expect(first).toMatchObject({ send: true, gate: { held: { count: 1 } } })
    expect(releaseTurn(first.gate, NAMES, fresh)).toMatchObject({ send: true, gate: { held: undefined } })
  })

  test("a failed build does not release the held presses; the next successful one does", () => {
    const gate = pressTurn(written(), NAMES, false, stale).gate
    expect(releaseTurn(gate, NAMES, failed)).toEqual({ gate, send: false })
    expect(releaseTurn(gate, NAMES, { builtMark: 9, buildStatus: "done", moveWaiting: false })).toMatchObject({ send: true })
  })

  test("once open the gate stays open: a later failed build does not shut it again", () => {
    const open = releaseTurn(written(), NAMES, fresh).gate
    expect(gateOpen(open, failed)).toBe(true)
    expect(pressTurn(open, NAMES, false, failed).send).toBe(true)
  })

  test("drops the held presses when the selection changed meanwhile", () => {
    const gate = pressTurn(editSent(OPEN_GATE), NAMES, false, stale).gate
    expect(releaseTurn(editSettled(gate, true, 1, undefined, 5), ["R2"], fresh)).toEqual({ gate: { ...OPEN_GATE, seq: 1, written: 5 }, send: false })
  })

  test("a failed edit writes nothing, so the gate waits again for what it waited for before, and drops the held presses", () => {
    const first = written()
    const held = pressTurn(editSent(first), NAMES, false, fresh).gate
    const waited = editSettled(held, false, 2, first.waiting)
    expect(waited).toMatchObject({ inFlight: 0, waiting: { seq: 1 }, written: 5, held: undefined })
    expect(gateOpen(waited, stale)).toBe(false)
    expect(gateOpen(waited, fresh)).toBe(true)
  })

  test("a failed edit that waited for nothing leaves the gate open", () => {
    expect(gateOpen(editSettled(editSent(OPEN_GATE), false, 1, undefined), stale)).toBe(true)
  })

  test("a failure does not undo the wait for an edit sent after it", () => {
    const two = editSent(editSent(OPEN_GATE))
    expect(editSettled(two, false, 1, undefined)).toMatchObject({ inFlight: 1, waiting: { seq: 2 }, held: undefined })
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
