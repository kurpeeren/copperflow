import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../../src/engine/design.js"
import { refilled, routedIndex } from "../../src/engine/router/pour-rounds.js"
import { ripUpAndRetry } from "../../src/engine/router/rip-up.js"
import { routeBoard, type RouteBoardInput, type RouteReport } from "../../src/engine/router/route-board.js"
import { filesIn } from "../helpers/place-fixtures.js"
import { layoutLines, routeDesign } from "../helpers/route-check.js"

const FOLDER = join(import.meta.dirname, "..", "fixtures", "can-proof")
const MAIN = "can-module.circuit.tsx"
const LAYOUT = "can-module.circuit.layout.json"

function unroutedFiles(extra = ""): Record<string, string> {
  const files = filesIn(FOLDER)
  return { ...files, [LAYOUT]: `${(files[LAYOUT] ?? "").split("\n")[0]}\n${extra}` }
}

const inputOf = (design: Design): RouteBoardInput => ({ layout: design.pcb, rules: design.rules, nets: design.circuit.nets, components: design.circuit.components })
const key = (line: { net: string; from: string; to: string }) => `${line.net}|${line.from}|${line.to}`
/** The board as the proof run left it to the retry: keep-clear off, so C3.pin2 is walled in. */
const OFF = { keepClear: false } as const

describe("rip-up and retry stays inside the run's scope", () => {
  test("a run scoped to every net but LED retries, and writes no copper on LED, whose line stays", () => {
    const design = buildDesign(unroutedFiles(), MAIN)
    const nets = design.circuit.nets.flatMap((net) => net.names.slice(0, 1)).filter((name) => name !== "LED")
    const scope = { kind: "nets" as const, nets }
    const report = routeDesign(design, { ...OFF, scope })
    expect(report.retried).toBe(1)
    expect(report.unrouted).toEqual([])
    expect(report.routed.some((route) => route.net === "net.LED")).toBe(false)
    const left = refilled(inputOf(design), report.routed).ratsnest
    expect(left.map((line) => line.net)).toEqual(["net.LED"])
  }, 120_000)

  test("a run scoped to every part but R8 and R9 retries, and routes none of the lines it left out", () => {
    // R8 and R9 sit in a corner on V5; the line between them is outside the scope and open before the run. The retry
    // takes up a V5 route (C3-R2) and routes again what that broke: the old retry took every open line of a taken-up
    // route's net the run had not reported, and so routed R8-R9 too.
    const files = unroutedFiles()
    const extra = [
      '<resistor name="R8" resistance="10k" footprint="0603" pcbX={-13.5} pcbY={-10} pcbRotation={0} />',
      '<resistor name="R9" resistance="10k" footprint="0603" pcbX={-11} pcbY={-10} pcbRotation={0} />',
      '<trace from="R8.pin1" to="net.V5" />',
      '<trace from="R9.pin1" to="net.V5" />',
      '<trace from="R8.pin2" to="net.SPARE" />',
      '<trace from="R9.pin2" to="net.SPARE" />',
    ].join("\n    ")
    const design = buildDesign({ ...files, [MAIN]: (files[MAIN] as string).replace("</board>", `  ${extra}\n  </board>`) }, MAIN)
    const outside = new Set(["R8", "R9"])
    const parts = design.pcb.parts.map((part) => part.component).filter((name) => !outside.has(name))
    const inScope = (line: { from: string; to: string }) => parts.includes(line.from.split("#")[0] as string) || parts.includes(line.to.split("#")[0] as string)
    const leftOut = design.pcb.ratsnest.filter((line) => !inScope(line)).map(key)
    expect(leftOut.filter((line) => line.startsWith("net.V5|"))).toHaveLength(1)
    const report = routeDesign(design, { ...OFF, scope: { kind: "parts", parts } })
    expect(report.retried).toBe(1)
    expect(report.routed.filter((route) => !inScope(route))).toEqual([])
    const left = refilled(inputOf(design), report.routed).ratsnest.map(key)
    for (const line of leftOut) expect(left).toContain(line)
  }, 120_000)

  test("a run scoped to an instance is not retried: its copies and replicas stay as the run made them", () => {
    const design = buildDesign(unroutedFiles(), MAIN)
    const failed: RouteReport = { routed: [], unrouted: [{ net: "net.GND", from: "C3#2", to: "U2#2", reason: "no room", blockers: [] }], passes: 1, edits: [], ms: 0, cleanupCapped: false, cleanupSkipped: false, budgetSpent: false, replicas: [{ instance: "P2", copied: 0 }] }
    let calls = 0
    const after = ripUpAndRetry(inputOf(design), failed, { scope: { kind: "instance", instance: "P1" } }, () => {
      calls++
      return failed
    })
    expect(calls).toBe(0)
    expect(after).toBe(failed)
  })
})

describe("the retry's time counts against the budget, and its runs' flags are reported", () => {
  const design = buildDesign(unroutedFiles(), MAIN)
  const input = inputOf(design)
  const main = routeBoard(input, { ...OFF, retry: false })

  test("the clock time of a retry, refills included, is added to ms; a spent budget stops the next retry and says so", () => {
    expect(main.unrouted).toHaveLength(1)
    let now = 0
    // Each read of the clock moves it 3 s on: the first retry takes 3 s, past the 2 s budget, so the second is not tried.
    const twice: RouteReport = { ...main, ms: 0, unrouted: [...main.unrouted, { net: "net.GND", from: "X#1", to: "Y#1", reason: "none", blockers: [] }] }
    const after = ripUpAndRetry(input, twice, { ...OFF, budgetMs: 2000, clock: () => (now += 3000) }, (given, options) => routeBoard(given, { ...options, retry: false }))
    expect(after.retried).toBe(1)
    expect(after.ms).toBeGreaterThanOrEqual(3000)
    expect(after.budgetSpent).toBe(true)
    expect(after.unrouted.map(key)).toContain("net.GND|X#1|Y#1")
  }, 120_000)

  test("cleanupCapped and cleanupSkipped of the retry's runs reach the report", () => {
    const after = ripUpAndRetry(input, main, OFF, (given, options) => ({ ...routeBoard(given, { ...options, retry: false }), cleanupCapped: true }))
    expect(after.unrouted).toEqual([])
    expect(after.cleanupCapped).toBe(true)
  }, 120_000)
})

describe("the copper a retry names", () => {
  test("ids of one refill never repeat, and a prefix keeps the retry's own routes apart from the inner run's", () => {
    const design = buildDesign(unroutedFiles(), MAIN)
    const report = routeBoard(inputOf(design), { ...OFF, retry: false })
    const ids = [...refilled(inputOf(design), report.routed, "prior").tracks, ...refilled(inputOf(design), report.routed, "prior").vias].map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith("prior:"))).toBe(true)
    expect(routedIndex("prior:5:t1", "prior")).toBe(4)
    expect(routedIndex("routed:5:t1", "prior")).toBeUndefined()
    expect(routedIndex("prior:5:t1")).toBeUndefined()
  }, 60_000)

  for (const [who, locked] of [["human", true], ["human", false], ["router", false]] as const) {
    test(`copper already in the layout (by ${who}${locked ? ", locked" : ""}) that walls a pad in stays: it is never taken up`, () => {
      // The main run's routes, written into the layout file: the wall is now layout copper, not this run's.
      const first = routeDesign(buildDesign(unroutedFiles(), MAIN), { ...OFF, retry: false })
      const lines = first.routed
        .map((route, i) => layoutLines(route.copper, 100 + i * 10))
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.stringify({ ...JSON.parse(line), by: who, locked }))
      const files = unroutedFiles(`${lines.join("\n")}\n`)
      const design = buildDesign(files, MAIN)
      const ids = [...design.pcb.tracks, ...design.pcb.vias].map((one) => one.id)
      const report = routeDesign(design, OFF)
      expect(report.retried).toBe(1)
      expect(report.unrouted.map(key)).toEqual(first.unrouted.map(key))
      expect(report.edits.every((edit) => edit.kind === "addTrack" || edit.kind === "addVia")).toBe(true)
      expect(ids.length).toBeGreaterThan(0)
    }, 120_000)
  }
})
