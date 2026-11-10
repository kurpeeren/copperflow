import { describe, expect, test } from "vitest"
import { discardReason, isRouting, routeProgressText, routeSummary, scopeText, writtenMark, type RouteEvent } from "../src/studio/route-events.js"

const FILE = "main.circuit.tsx"

describe("the run's events", () => {
  test("the status line follows the run from start to end", () => {
    const lines = (events: RouteEvent[]) => events.map(routeProgressText)
    expect(
      lines([
        { file: FILE, state: "started", scope: { kind: "all" } },
        { file: FILE, state: "started", scope: { kind: "all" }, inProcess: true },
        { file: FILE, state: "running", pass: 2, done: 12, total: 32 },
        { file: FILE, state: "running", pass: 1, done: 1, total: 1 },
        { file: FILE, state: "cleanup", capped: false },
        { file: FILE, state: "cleanup", capped: true },
      ]),
    ).toEqual([
      "Autorouting…",
      "Autorouting in the server process (worker threads are unavailable)…",
      "Autorouting: pass 2, 12 of 32 connections",
      "Autorouting: pass 1, 1 of 1 connection",
      "Autorouting: cleaning up",
      "Autorouting: cleanup stopped at its pass cap",
    ])
  })

  test("the end says what was routed, what was not, and whether cleanup hit its cap", () => {
    const done = (routed: number, total: number, passes: number, unrouted: number, cleanupCapped = false): RouteEvent => ({
      file: FILE,
      state: "done",
      routed,
      total,
      passes,
      unrouted: Array.from({ length: unrouted }, (_, i) => ({ net: "net.A", from: `R${i}#1`, to: "R9#1", reason: "no room", blockers: [] })),
      cleanupCapped,
    })
    expect(routeProgressText(done(32, 32, 6, 0))).toBe("Routed 32 of 32 connections in 6 passes")
    expect(routeProgressText(done(1, 1, 1, 0))).toBe("Routed 1 of 1 connection in 1 pass")
    expect(routeProgressText(done(30, 32, 2, 2, true))).toBe("Routed 30 of 32 connections in 2 passes; 2 not routed, see Checks; cleanup stopped at its pass cap")
    expect(routeProgressText(done(0, 0, 0, 0))).toBe("Nothing to route: the scope has no connection left to route")
    expect(routeProgressText({ file: FILE, state: "cancelled" })).toBe("Autorouting cancelled; nothing was written")
    expect(routeProgressText({ file: FILE, state: "failed", error: "boom" })).toBe("Autorouting failed: boom")
    expect(routeProgressText({ file: FILE, state: "discarded", reason: "why" })).toBe("why")
  })

  test("a run is going until it is done, discarded, cancelled or failed", () => {
    expect(isRouting(undefined)).toBe(false)
    expect(isRouting({ file: FILE, state: "running", pass: 1, done: 0, total: 3 })).toBe(true)
    expect(isRouting({ file: FILE, state: "cleanup", capped: false })).toBe(true)
    expect(isRouting({ file: FILE, state: "cancelled" })).toBe(false)
  })

  test("a run that wrote copper gives its write mark, for the canvas keys to wait on its build", () => {
    const done: RouteEvent = { file: FILE, state: "done", routed: 1, total: 1, passes: 1, unrouted: [], cleanupCapped: false }
    expect(writtenMark({ ...done, entryId: "c0001", writeMark: 7 })).toBe(7)
    expect(writtenMark(done)).toBeUndefined()
    expect(writtenMark({ file: FILE, state: "cancelled" })).toBeUndefined()
  })

  test("the scope in words, and the history entry's summary", () => {
    expect(scopeText({ kind: "all" })).toBe("the board")
    expect(scopeText({ kind: "nets", nets: ["net.GND"] })).toBe("net GND")
    expect(scopeText({ kind: "nets", nets: ["GND", "net.VCC"] })).toBe("nets GND, VCC")
    expect(scopeText({ kind: "parts", parts: ["R1", "C2"] })).toBe("R1, C2")
    expect(scopeText({ kind: "instance", instance: "PS1" })).toBe("instance PS1")
    expect(routeSummary({ kind: "all" }, 30, 32)).toBe("Autoroute the board: 30 of 32 connections")
    const long = routeSummary({ kind: "parts", parts: Array.from({ length: 100 }, (_, i) => `R${i}`) }, 1, 2)
    expect(long.length).toBe(200)
    expect(long.endsWith("…")).toBe(true)
  })
})

describe("the discard rule", () => {
  const start = { circuit: "a", layout: "b", project: "c" }
  test("the result applies only when no file the run was computed from changed meanwhile", () => {
    expect(discardReason(start, { ...start })).toBeUndefined()
    expect(discardReason(start, { ...start, circuit: "x" })).toBe("The circuit changed while the board was routed, so the result was discarded; route again")
    expect(discardReason(start, { ...start, layout: "x" })).toBe("The layout file changed while the board was routed, so the result was discarded; route again")
    expect(discardReason(start, { ...start, circuit: "x", layout: "y" })).toMatch(/^The circuit and its layout file changed/)
    expect(discardReason(start, { ...start, project: "x" })).toBe("A file the circuit is built from (a sub-sheet, a part or rules.yaml) changed while the board was routed, so the result was discarded; route again")
  })
})
