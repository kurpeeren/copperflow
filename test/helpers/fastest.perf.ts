import { expect, test } from "vitest"
import { fastestMs } from "./fastest.js"

/** Keeps the thread busy for `ms` of wall-clock time. */
function busy(ms: number): void {
  const end = performance.now() + ms
  let sink = 0
  while (performance.now() < end) sink += Math.sqrt(sink + 1)
  if (sink < 0) throw new Error("unreachable")
}

test("an empty function measures close to zero", () => {
  expect(fastestMs(() => {}, 5)).toBeLessThan(5)
})

test("20 ms of busy work measures at least 20 ms and well under 200 ms", () => {
  const ms = fastestMs(() => busy(20), 5)
  expect(ms).toBeGreaterThanOrEqual(20)
  expect(ms).toBeLessThan(200)
})

test("runs once to warm up, then the given number of times", () => {
  let calls = 0
  fastestMs(() => void calls++, 3)
  expect(calls).toBe(4)
})

test("refuses fewer than one timed run", () => {
  expect(() => fastestMs(() => {}, 0)).toThrow(/at least 1/)
})
