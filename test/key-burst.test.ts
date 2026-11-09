import { describe, expect, test } from "vitest"
import {
  claimsKey,
  editSent,
  editSettled,
  gateOpen,
  historySent,
  historySettled,
  holdNudge,
  OPEN_GATE,
  pressArrow,
  pressNudge,
  pressTurn,
  releaseArrows,
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

  test("a press on the same parts with other wires selected starts afresh; the same wires join the burst", () => {
    const burst = pressNudge(undefined, circuit, NAMES, right, ["wire:A"]).burst
    expect(burst.wires).toEqual(["wire:A"])
    expect(pressNudge(burst, circuit, NAMES, right, ["wire:A"])).toMatchObject({ send: null, fresh: false })
    expect(pressNudge(burst, circuit, NAMES, right, ["wire:B"])).toMatchObject({ send: right, fresh: true })
    expect(pressNudge(burst, circuit, NAMES, right)).toMatchObject({ send: right, fresh: true })
  })

  test("the selected labels are kept like the wires: other labels start afresh, the same join", () => {
    const burst = pressNudge(undefined, circuit, NAMES, right, [], ["label:A"]).burst
    expect(burst.labels).toEqual(["label:A"])
    expect(burst.wires).toBeUndefined()
    expect(pressNudge(burst, circuit, NAMES, right, [], ["label:A"])).toMatchObject({ send: null, fresh: false })
    expect(pressNudge(burst, circuit, NAMES, right, [], ["label:B"])).toMatchObject({ send: right, fresh: true })
    const held = holdNudge(undefined, NAMES, right, [], ["label:A"])
    expect(held).toEqual({ names: NAMES, labels: ["label:A"], total: right })
    expect(holdNudge(held, NAMES, right)).toEqual({ names: NAMES, total: right })
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

describe("the gate and an Undo or Redo", () => {
  // The undo under test was written at server mark 5; builds started at 3 (before it) and 7 (after it).
  const stale: DesignState = { builtMark: 3, buildStatus: "done", moveWaiting: false }
  const fresh: DesignState = { builtMark: 7, buildStatus: "done", moveWaiting: false }
  /** What the gate waited for before the first undo: nothing. */
  const NOTHING = { waiting: undefined, history: undefined }
  const undone = () => historySettled(historySent(OPEN_GATE), true, 1, NOTHING, 5)

  test("a Rotate after an undo is held until a build that started after the undo's write has succeeded", () => {
    expect(pressTurn(historySent(OPEN_GATE), NAMES, false, fresh).send).toBe(false)
    const held = pressTurn(undone(), NAMES, false, stale)
    expect(held).toMatchObject({ send: false, gate: { held: { names: NAMES, count: 1 } } })
    expect(releaseTurn(held.gate, NAMES, stale).send).toBe(false)
    expect(releaseTurn(held.gate, NAMES, { builtMark: 5, buildStatus: "done", moveWaiting: false }).send).toBe(false)
    const released = releaseTurn(held.gate, NAMES, fresh)
    expect(released.send).toBe(true)
    expect(released.gate).toMatchObject({ held: undefined, waiting: undefined, history: undefined })
  })

  test("arrow presses wait for an undo too, until the same build; key edits alone never hold them", () => {
    expect(pressArrow(editSettled(editSent(OPEN_GATE), true, 1, undefined, 5), stale).send).toBe(true)
    expect(pressArrow(historySent(OPEN_GATE), fresh).send).toBe(false)
    expect(pressArrow(undone(), stale).send).toBe(false)
    const open = pressArrow(undone(), fresh)
    expect(open).toMatchObject({ send: true, gate: { history: undefined, waiting: undefined } })
    expect(pressArrow(editSent(open.gate), stale).send).toBe(true)
  })

  test("held arrow presses add up on one selection, and go as one move once the build has read the undo", () => {
    const once = holdNudge(undefined, NAMES, right)
    expect(holdNudge(once, NAMES, right)).toEqual({ names: NAMES, total: { x: 1, y: 0 } })
    expect(holdNudge(once, ["R2"], right)).toEqual({ names: ["R2"], total: right })
    const waiting = undone()
    expect(releaseArrows(waiting, once, NAMES, stale)).toEqual({ gate: waiting, held: once, send: null })
    expect(releaseArrows(waiting, once, NAMES, fresh)).toMatchObject({ gate: { history: undefined }, held: undefined, send: right })
    expect(releaseArrows(waiting, once, ["R2"], fresh)).toMatchObject({ held: undefined, send: null })
    expect(releaseArrows(waiting, undefined, NAMES, fresh)).toEqual({ gate: waiting, held: undefined, send: null })
  })

  test("held arrow presses keep the wires they were made with: other wires replace them, and go nowhere", () => {
    const withWire = holdNudge(undefined, NAMES, right, ["wire:A"])
    expect(holdNudge(withWire, NAMES, right, ["wire:A"])).toEqual({ names: NAMES, wires: ["wire:A"], total: { x: 1, y: 0 } })
    expect(holdNudge(withWire, NAMES, right)).toEqual({ names: NAMES, total: right })
    expect(releaseArrows(undone(), withWire, NAMES, fresh, ["wire:A"])).toMatchObject({ send: right })
    expect(releaseArrows(undone(), withWire, NAMES, fresh)).toMatchObject({ held: undefined, send: null })
  })

  test("a failed undo wrote nothing: the gate waits again for what it waited for before, and keeps the held presses", () => {
    const held = pressTurn(historySent(OPEN_GATE), NAMES, false, fresh).gate
    const failed = historySettled(held, false, 1, NOTHING)
    expect(failed).toMatchObject({ inFlight: 0, waiting: undefined, history: undefined, held: { count: 1 } })
    expect(releaseTurn(failed, NAMES, stale).send).toBe(true)
    expect(pressArrow(failed, stale).send).toBe(true)
  })

  test("a failed undo after a successful one waits again for the first one's build, not for nothing", () => {
    const first = undone()
    const failed = historySettled(historySent(first), false, 2, { waiting: first.waiting, history: first.history })
    expect(failed).toMatchObject({ inFlight: 0, waiting: { seq: 1 }, history: { seq: 1 }, written: 5 })
    expect(pressArrow(failed, stale).send).toBe(false)
    expect(pressTurn(failed, NAMES, false, stale).send).toBe(false)
    expect(pressArrow(failed, fresh).send).toBe(true)
  })
})

describe("claimsKey", () => {
  test("arrows are left to the page when nothing is selected or a tool uses the keys", () => {
    expect(claimsKey("nudgeLeft", 0, false, true)).toBe(false)
    expect(claimsKey("nudgeLeft", 2, true, true)).toBe(false)
    expect(claimsKey("nudgeLeft", 2, false, true)).toBe(true)
  })

  test("arrows are kept from the page with only wires selected: they count every object, Rotate the parts", () => {
    expect(claimsKey("nudgeLeft", 0, false, true, 1)).toBe(true)
    expect(claimsKey("rotate", 0, false, true, 1)).toBe(false)
  })

  test("Rotate is kept from the page only with a selection and no tool; other keys follow the key map", () => {
    expect(claimsKey("rotate", 0, false, true)).toBe(false)
    expect(claimsKey("rotate", 1, true, true)).toBe(false)
    expect(claimsKey("rotate", 1, false, true)).toBe(true)
    expect(claimsKey("fit", 0, false, false)).toBe(false)
    expect(claimsKey("contextMenu", 0, false, true)).toBe(true)
  })

  test("a key the canvas does not run is never claimed, so the app, the workspace or the tool that runs it still sees it", () => {
    for (const action of ["undo", "redo", "selectAll", "find", "openFile", "openLibrary", "wire", "armNetLabel"]) {
      expect([action, claimsKey(action, 1, false, true)]).toEqual([action, false])
      expect([action, claimsKey(action, 0, false, true)]).toEqual([action, false])
    }
  })
})
