import { expect, test } from "vitest"
import { cpuMedianMs } from "./cpu-time.js"

function spin(ms: number): void {
  const end = process.cpuUsage()
  let sink = 0
  for (;;) {
    for (let i = 0; i < 20000; i++) sink += Math.sqrt(i)
    const now = process.cpuUsage(end)
    if ((now.user + now.system) / 1000 >= ms) break
  }
  if (sink < 0) throw new Error("unreachable")
}

test("an empty function measures close to zero", () => {
  expect(cpuMedianMs(() => {}, 5)).toBeLessThan(5)
})

test("about 20 ms of arithmetic measures between 5 and 200 ms", () => {
  const ms = cpuMedianMs(() => spin(20), 5)
  expect(ms).toBeGreaterThan(5)
  expect(ms).toBeLessThan(200)
})
