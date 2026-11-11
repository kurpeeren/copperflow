import { expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { placeBoard } from "../../src/engine/pcb-place/index.js"
import { fastestMs } from "../helpers/fastest.js"
import { benchmarkUnplaced, BENCHMARK_MAIN, canUnplaced, CAN_MAIN } from "../helpers/place-fixtures.js"

/** The plan's bounds: the CAN module in under 300 ms, the 200-part benchmark in under 5 s. */
const CAN_LIMIT_MS = 300
const BENCHMARK_LIMIT_MS = 5000

test("places the CAN module in under 300 ms", () => {
  const design = buildDesign(canUnplaced(), CAN_MAIN)
  const placement = placeBoard(design)
  const fastest = fastestMs(() => void placeBoard(design), 3)
  console.log(`placeBoard CAN module, wire ${placement.before.wireLength.toFixed(1)} -> ${placement.score.wireLength.toFixed(1)} mm, fastest of 3: ${fastest.toFixed(1)} ms`)
  expect(placement.budgetSpent).toBe(false)
  expect(fastest).toBeLessThan(CAN_LIMIT_MS)
}, 60_000)

test("places the 200-part benchmark in under 5 s", () => {
  const design = buildDesign(benchmarkUnplaced(), BENCHMARK_MAIN)
  const started = performance.now()
  const placement = placeBoard(design)
  const elapsed = performance.now() - started
  console.log(`placeBoard 200 parts, wire ${placement.before.wireLength.toFixed(1)} -> ${placement.score.wireLength.toFixed(1)} mm: ${elapsed.toFixed(0)} ms`)
  expect(placement.budgetSpent).toBe(false)
  expect(elapsed).toBeLessThan(BENCHMARK_LIMIT_MS)
}, 120_000)
