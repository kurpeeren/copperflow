import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { routedIndex } from "../../src/engine/router/pour-rounds.js"
import { filesIn } from "../helpers/place-fixtures.js"
import { checkRoutedAll, routeDesign } from "../helpers/route-check.js"

const FOLDER = join(import.meta.dirname, "..", "fixtures", "can-proof")
const MAIN = "can-module.circuit.tsx"
const LAYOUT = "can-module.circuit.layout.json"

/** The proof run's board with its router copper taken back, as `unroute` with all: true leaves it. */
function unrouted(): Record<string, string> {
  const files = filesIn(FOLDER)
  const meta = (files[LAYOUT] ?? "").split("\n")[0] ?? ""
  return { ...files, [LAYOUT]: `${meta}\n` }
}

/** Routed, the board passes every copper check with no ratsnest left. */
function expectClean(files: Record<string, string>, report: ReturnType<typeof routeDesign>) {
  expect(report.unrouted).toEqual([])
  const checked = checkRoutedAll(files, MAIN, report.routed.map((route) => route.copper))
  expect(checked.copper).toEqual([])
  expect(checked.after.pcb.ratsnest).toEqual([])
}

describe("the proof run's CAN board, a GND pour on top only", () => {
  test("the first run routes every connection: the keep-clear round C3.pin2 leaves it its way out, and no retry is needed", () => {
    const files = unrouted()
    const design = buildDesign(files, MAIN)
    const report = routeDesign(design)
    expect(report.retried ?? 0).toBe(0)
    expectClean(files, report)
    expect({ ...routeDesign(design), ms: 0 }).toEqual({ ...report, ms: 0 })
  }, 120_000)

  test("without the keep-clear the first run walls C3.pin2 in, and rip-up and retry is what saves the board", () => {
    const files = unrouted()
    const design = buildDesign(files, MAIN)
    const bare = routeDesign(design, { keepClear: false, retry: false })
    expect(bare.unrouted.map((one) => [one.from, one.to])).toEqual([["C3#2", "U2#2"]])
    const saved = routeDesign(design, { keepClear: false })
    expect(saved.retried).toBe(1)
    expectClean(files, saved)
  }, 120_000)
})

describe("which copper rip-up may take up", () => {
  test("only this run's routes, named routed:N:…; layout copper (hand-drawn or an earlier run's) never", () => {
    expect(routedIndex("routed:5:t1")).toBe(4)
    expect(routedIndex("routed:21:v1")).toBe(20)
    expect(routedIndex("t0037")).toBeUndefined()
    expect(routedIndex("kept:3:t1")).toBeUndefined()
    expect(routedIndex("U1#15")).toBeUndefined()
  })
})
