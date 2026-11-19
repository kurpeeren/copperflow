import { expect, test } from "vitest"
import { fastestMs, fastestWithinMs } from "./fastest.js"

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

test("a run under the limit is measured in one round", async () => {
  let calls = 0
  const ms = await fastestWithinMs(() => void calls++, 3, 50, { rounds: 3, pauseMs: 0 })
  expect(ms).toBeLessThan(50)
  expect(calls).toBe(4)
})

test("a slow first round is measured again, and the fastest of every round is the answer", async () => {
  let round = 0
  let calls = 0
  const ms = await fastestWithinMs(() => {
    calls++
    // The first round's four calls (warm-up and three timed) are slow, as if the machine were busy.
    busy(calls <= 4 ? 30 : 1)
    round = calls <= 4 ? 1 : 2
  }, 3, 20, { rounds: 3, pauseMs: 0 })
  expect(round).toBe(2)
  expect(ms).toBeLessThan(20)
  expect(calls).toBe(8)
})

test("code that is really too slow is over the limit in every round, and the answer says so", async () => {
  let calls = 0
  const ms = await fastestWithinMs(() => {
    calls++
    busy(25)
  }, 2, 20, { rounds: 3, pauseMs: 0 })
  expect(ms).toBeGreaterThanOrEqual(25)
  expect(calls).toBe(9)
})
