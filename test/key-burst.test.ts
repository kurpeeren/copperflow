import { describe, expect, test } from "vitest"
import { acceptRotate, claimsKey, pressNudge, settleNudge, type Burst, type BurstStep } from "../studio/src/pcb/key-burst.js"

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

describe("acceptRotate", () => {
  test("ignores a repeating key and a press while a rotate is in flight", () => {
    expect(acceptRotate(false, false)).toBe(true)
    expect(acceptRotate(true, false)).toBe(false)
    expect(acceptRotate(false, true)).toBe(false)
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
