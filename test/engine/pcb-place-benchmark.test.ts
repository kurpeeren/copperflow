import { expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { placeBoard } from "../../src/engine/pcb-place/index.js"
import { benchmarkUnplaced, BENCHMARK_MAIN, withPositions } from "../helpers/place-fixtures.js"

test("the 200-part benchmark places with less wire than the build's packing, clear of every courtyard", () => {
  const files = benchmarkUnplaced()
  const design = buildDesign(files, BENCHMARK_MAIN)
  expect(design.pcb.parts.every((p) => p.autoPlaced)).toBe(true)
  const placement = placeBoard(design)
  expect(placement.unplaced).toEqual([])
  expect(placement.positions.size).toBe(200)
  expect(placement.score.wireLength).toBeLessThan(placement.before.wireLength)
  const after = buildDesign({ [BENCHMARK_MAIN]: withPositions(files[BENCHMARK_MAIN] as string, placement.positions) }, BENCHMARK_MAIN)
  expect(after.violations.filter((v) => ["courtyard-overlap", "outside-board"].includes(v.code))).toEqual([])
}, 60_000)
