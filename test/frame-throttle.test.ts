import { describe, expect, test } from "vitest"
import { frameThrottle, type FrameClock } from "../studio/src/shell/frame-throttle.js"

/** A clock whose frames run only when the test says so. */
function manualClock() {
  let next = 1
  const waiting = new Map<number, () => void>()
  const clock: FrameClock = {
    request(callback) {
      const handle = next++
      waiting.set(handle, callback)
      return handle
    },
    cancel(handle) {
      waiting.delete(handle)
    },
  }
  const frame = () => {
    const due = [...waiting.values()]
    waiting.clear()
    for (const callback of due) callback()
  }
  return { clock, frame, pending: () => waiting.size }
}

describe("frameThrottle", () => {
  test("many pushes in one frame run once, with the last value", () => {
    const { clock, frame, pending } = manualClock()
    const seen: number[] = []
    const throttle = frameThrottle(clock, (value: number) => seen.push(value))
    throttle.push(1)
    throttle.push(2)
    throttle.push(3)
    expect(pending()).toBe(1)
    expect(seen).toEqual([])
    frame()
    expect(seen).toEqual([3])
    frame()
    expect(seen).toEqual([3])
  })

  test("a push after a frame asks for the next frame", () => {
    const { clock, frame } = manualClock()
    const seen: number[] = []
    const throttle = frameThrottle(clock, (value: number) => seen.push(value))
    throttle.push(1)
    frame()
    throttle.push(2)
    frame()
    expect(seen).toEqual([1, 2])
  })

  test("flush runs the waiting value now and drops its frame", () => {
    const { clock, frame, pending } = manualClock()
    const seen: number[] = []
    const throttle = frameThrottle(clock, (value: number) => seen.push(value))
    throttle.push(5)
    throttle.flush()
    expect(seen).toEqual([5])
    expect(pending()).toBe(0)
    frame()
    throttle.flush()
    expect(seen).toEqual([5])
  })

  test("cancel drops the waiting value", () => {
    const { clock, frame, pending } = manualClock()
    const seen: number[] = []
    const throttle = frameThrottle(clock, (value: number) => seen.push(value))
    throttle.push(5)
    throttle.cancel()
    expect(pending()).toBe(0)
    frame()
    expect(seen).toEqual([])
  })
})
