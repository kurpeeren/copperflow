import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { COST_CAP } from "../../src/engine/router/astar.js"
import { MAX_PRICE, presentPrice } from "../../src/engine/router/congestion.js"
import type { RouteProgress, RouteReport } from "../../src/engine/router/route-board.js"
import { checkRoutedAll, routeDesign } from "../helpers/route-check.js"

const MAIN = "main.circuit.tsx"

const board = (width: number, height: number, body: readonly string[]) => `export default () => (
  <board width="${width}mm" height="${height}mm">
${body.join("\n")}
  </board>
)
`
const resistor = (name: string, x: number, y: number, extra = "") => `    <resistor name="${name}" resistance="1k" footprint="0603" pcbX={${x}} pcbY={${y}} ${extra}/>`
const trace = (from: string, net: string) => `    <trace from="${from}" to="net.${net}" />`
const keepout = (x: number, y: number, width: number, height: number) => `    <keepout pcbX={${x}} pcbY={${y}} width={${width}} height={${height}} />`
const withoutTime = (report: RouteReport) => ({ ...report, ms: 0 })

/** Every routed copper laid on the board: zero copper violations, nothing added, and the routed lines gone. */
function expectClean(files: Record<string, string>, report: RouteReport, first = 1) {
  const checked = checkRoutedAll(files, MAIN, report.routed.map((route) => route.copper), first)
  expect(checked.copper).toEqual([])
  expect(checked.added).toEqual([])
  const left = new Set(checked.after.pcb.ratsnest.map((line) => [line.from, line.to].sort().join(" ")))
  for (const route of report.routed) expect(left.has([route.from, route.to].sort().join(" "))).toBe(false)
  return checked
}

describe("routing the whole board", () => {
  const CROSS = {
    [MAIN]: board(14, 12, [
      resistor("R1", -5.5, 0),
      resistor("R2", 5.5, 0),
      resistor("R3", 0, -4.5, "pcbRotation={90} "),
      resistor("R4", 0, 4.5, "pcbRotation={90} "),
      trace("R1.pin2", "A"),
      trace("R2.pin1", "A"),
      trace("R3.pin2", "B"),
      trace("R4.pin1", "B"),
    ]),
  }

  test("two nets that cross both route, one of them through the other layer", () => {
    const design = buildDesign(CROSS, MAIN)
    expect(design.pcb.ratsnest).toHaveLength(2)
    const report = routeDesign(design)
    expect(report.unrouted).toEqual([])
    expect(report.routed.map((route) => route.net).sort()).toEqual(["net.A", "net.B"])
    expect(report.routed.flatMap((route) => route.copper.vias).length).toBeGreaterThan(0)
    expect(report.passes).toBeGreaterThanOrEqual(1)
    const checked = expectClean(CROSS, report)
    expect(checked.after.pcb.ratsnest).toEqual([])
  })

  test("a route's own vias keep the hole spacing from each other", () => {
    const files = { ...CROSS, "rules.yaml": "fabrication:\n  minHoleToHole: 3\n" }
    const design = buildDesign(files, MAIN)
    expect(design.rules.fabrication.minHoleToHole).toBe(3)
    const report = routeDesign(design)
    for (const route of report.routed) {
      route.copper.vias.forEach((a, i) => {
        for (const b of route.copper.vias.slice(i + 1)) expect(Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y)).toBeGreaterThanOrEqual(a.drill / 2 + b.drill / 2 + 3 - 1e-6)
      })
    }
    expect(report.routed.length + report.unrouted.length).toBe(2)
    expectClean(files, report)
  })

  test("the same board routes the same way twice", () => {
    const design = buildDesign(CROSS, MAIN)
    expect(withoutTime(routeDesign(design))).toEqual(withoutTime(routeDesign(design)))
  })

  test("a net that cannot route is reported with its reason, and the others still route", () => {
    const files = {
      [MAIN]: board(20, 12, [
        resistor("R1", -6, -3),
        resistor("R2", 6, -3),
        resistor("R3", -6, 3),
        resistor("R4", -2, 3),
        keepout(0, 0, 1, 14),
        trace("R1.pin2", "SIG"),
        trace("R2.pin1", "SIG"),
        trace("R3.pin2", "OTHER"),
        trace("R4.pin1", "OTHER"),
      ]),
    }
    const report = routeDesign(buildDesign(files, MAIN))
    expect(report.routed.map((route) => route.net)).toEqual(["net.OTHER"])
    expect(report.unrouted).toEqual([{ net: "net.SIG", from: "R1#2", to: "R2#1", reason: "could not route R1.pin2 to R2.pin1: no way past keepout:1", blockers: ["keepout:1"] }])
    expectClean(files, report)
  })

  test("three nets wanting a gap with room for one track a layer: two get it, the third is reported; twice the same, and a search bound hit in a late pass keeps the earlier route", () => {
    const files = {
      [MAIN]: board(20, 14, [
        resistor("R1", -6, -2),
        resistor("R2", 6, -2),
        resistor("R3", -6, 0),
        resistor("R4", 6, 0),
        resistor("R5", -6, 2),
        resistor("R6", 6, 2),
        keepout(0, 4.05, 1, 7.5),
        keepout(0, -4.05, 1, 7.5),
        trace("R1.pin2", "A"),
        trace("R2.pin1", "A"),
        trace("R3.pin2", "B"),
        trace("R4.pin1", "B"),
        trace("R5.pin2", "C"),
        trace("R6.pin1", "C"),
      ]),
    }
    const report = routeDesign(buildDesign(files, MAIN), { maxPasses: 4 })
    expect(report.passes).toBe(4)
    expect(report.routed).toHaveLength(2)
    expect(report.unrouted).toHaveLength(1)
    const [lost] = report.unrouted
    expect(lost?.reason).toMatch(/^could not route R\d\.pin2 to R\d\.pin1: no room between /)
    expect(lost?.blockers).toEqual(expect.arrayContaining(report.routed.map((route) => route.net)))
    expectClean(files, report)
    expect(withoutTime(routeDesign(buildDesign(files, MAIN), { maxPasses: 4 }))).toEqual(withoutTime(report))
    const bounded = routeDesign(buildDesign(files, MAIN), { maxPasses: 4, maxExpansions: 8000 })
    expect(bounded.routed).toHaveLength(2)
    expectClean(files, bounded)
  })

  test("the scope narrows the run to some nets or the connections of some parts", () => {
    const design = buildDesign(CROSS, MAIN)
    expect(routeDesign(design, { scope: { kind: "nets", nets: ["B"] } }).routed.map((route) => route.net)).toEqual(["net.B"])
    expect(routeDesign(design, { scope: { kind: "nets", nets: ["net.A"] } }).routed.map((route) => route.net)).toEqual(["net.A"])
    expect(routeDesign(design, { scope: { kind: "parts", parts: ["R4"] } }).routed.map((route) => [route.from, route.to])).toEqual([["R3#2", "R4#1"]])
    expect(routeDesign(design, { scope: { kind: "parts", parts: ["R9"] } })).toMatchObject({ routed: [], unrouted: [], passes: 0 })
  })

  test("progress tells the connections done of the pass's total, then the cleanup, and the report says the cleanup settled", () => {
    const design = buildDesign(CROSS, MAIN)
    const seen: RouteProgress[] = []
    const report = routeDesign(design, { onProgress: (progress) => seen.push(progress) })
    const first = seen.filter((progress) => progress.stage === "routing" && progress.pass === 1)
    expect(first.map((progress) => progress.stage === "routing" && [progress.done, progress.total])).toEqual([
      [1, 2],
      [2, 2],
    ])
    expect(seen.at(-1)).toEqual({ stage: "cleanup", capped: false })
    expect(report.cleanupCapped).toBe(false)
  }, 30_000)
})

describe("a long contested channel over every pass", () => {
  const nets = ["A", "B", "C", "D", "E"]
  const CHANNEL = {
    [MAIN]: board(32, 14, [
      ...nets.flatMap((net, i) => [resistor(`L${i + 1}`, -13, (i - 2) * 2), resistor(`M${i + 1}`, 13, (i - 2) * 2), trace(`L${i + 1}.pin2`, net), trace(`M${i + 1}.pin1`, net)]),
      keepout(0, 4.05, 16, 7.5),
      keepout(0, -4.05, 16, 7.5),
    ]),
  }

  test("the price stops rising at its cap, so a path's cost stays far below the 32-bit limit", () => {
    expect(presentPrice(1)).toBeLessThan(presentPrice(2))
    expect(presentPrice(30)).toBe(MAX_PRICE)
    expect(MAX_PRICE * 1000).toBeLessThanOrEqual(COST_CAP)
    expect(COST_CAP).toBeLessThan(2 ** 31)
  })

  test("thirty passes on a 16 mm channel: every cost stays in range, two nets get the channel, the rest are reported", () => {
    const design = buildDesign(CHANNEL, MAIN)
    const report = routeDesign(design)
    expect(report.passes).toBe(30)
    for (const route of report.routed) {
      expect(route.cost).toBeGreaterThan(0)
      expect(route.cost).toBeLessThanOrEqual(COST_CAP)
    }
    expect(report.routed).toHaveLength(2)
    expect(report.unrouted).toHaveLength(3)
    expectClean(CHANNEL, report)
  }, 60_000)
})

describe("routing one instance of a sheet", () => {
  const PAIR = `export default function Pair() {
  return (
    <sheet>
      <port name="IN" />
      <resistor name="R1" resistance="1k" footprint="0603" pcbX={-2} pcbY={0} />
      <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={2} pcbY={1} />
      <trace from="R1.pin1" to="net.IN" />
      <trace from="R1.pin2" to="C1.pin1" />
      <trace from="C1.pin2" to="net.IN" />
    </sheet>
  )
}
`
  const files = {
    [MAIN]: `import Pair from "./Pair.sheet"\nexport default () => (<board width="40mm" height="20mm"><Pair name="P1" connections={{ IN: "A" }} pcbX={-10} pcbY={0} /><Pair name="P2" connections={{ IN: "B" }} pcbX={10} pcbY={0} pcbRotation={90} /></board>)\n`,
    "Pair.sheet.tsx": PAIR,
  }

  test("routes the instance's own connections and copies them to the other instance, turned with it", () => {
    const design = buildDesign(files, MAIN)
    const report = routeDesign(design, { scope: { kind: "instance", instance: "P1" } })
    expect(report.unrouted).toEqual([])
    const own = report.routed.filter((route) => route.copiedFrom === undefined)
    const copies = report.routed.filter((route) => route.copiedFrom === "P1")
    expect(own.length).toBeGreaterThan(0)
    expect(own.every((route) => [route.from, route.to].every((pad) => /^(R101|C101)#/.test(pad)))).toBe(true)
    expect(copies.map((route) => route.net)).toEqual(own.map((route) => route.net.replace("net.A", "net.B").replace(/101\./, "201.")))
    expect(copies.every((route) => [route.from, route.to].every((pad) => /^(R201|C201)#/.test(pad)))).toBe(true)
    expect(report.replicas).toEqual([{ instance: "P2", copied: own.length }])
    const checked = expectClean(files, report)
    expect(checked.after.pcb.ratsnest).toEqual([])
  })

  test("an instance whose parts sit differently gets no copy, and says why", () => {
    const design = buildDesign(files, MAIN)
    const moved = { ...design, pcb: { ...design.pcb, parts: design.pcb.parts.map((part) => (part.component === "C201" ? { ...part, x: part.x + 0.5 } : part)) } }
    const report = routeDesign(moved, { scope: { kind: "instance", instance: "P1" } })
    expect(report.routed.every((route) => route.copiedFrom === undefined)).toBe(true)
    expect(report.replicas).toEqual([{ instance: "P2", copied: 0, reason: "its placement differs from P1" }])
  })

  test("a route ending on hand copper of the source is not copied where that copper is missing; that instance is routed itself", () => {
    const plain = buildDesign(files, MAIN)
    const pad = plain.pcb.parts.flatMap((part) => part.pads).find((one) => one.id === "R101#2")
    if (pad?.net === undefined) throw new Error("no R101#2")
    const stub = { t: "track", id: "t0001", net: pad.net, layer: "top", width: 0.25, points: [{ x: pad.x, y: pad.y }, { x: pad.x + 1.5, y: pad.y }], locked: false, by: "human" }
    const withStub = { ...files, "main.circuit.layout.json": `${JSON.stringify(stub)}\n` }
    const report = routeDesign(buildDesign(withStub, MAIN), { scope: { kind: "instance", instance: "P1" } })
    expect(report.unrouted).toEqual([])
    const inP2 = report.routed.filter((route) => route.from.startsWith("R201#2") || route.to.startsWith("R201#2"))
    expect(inP2).toHaveLength(1)
    expect(inP2[0]?.copiedFrom).toBeUndefined()
    const checked = expectClean(withStub, report, 2)
    expect(checked.after.pcb.ratsnest).toEqual([])
  })

  test("a budget spent once the instance is routed copies nothing more and skips the cleanup, saying so", () => {
    const design = buildDesign(files, MAIN)
    // The clock stands still until the last connection of a pass is told, then jumps past the budget.
    let now = 0
    const report = routeDesign(design, {
      scope: { kind: "instance", instance: "P1" },
      budgetMs: 1000,
      clock: () => now,
      onProgress: (progress) => {
        if (progress.stage === "routing" && progress.done === progress.total) now = 5000
      },
    })
    const own = report.routed.filter((route) => route.copiedFrom === undefined)
    expect(own.length).toBeGreaterThan(0)
    expect(report.routed.filter((route) => route.copiedFrom !== undefined)).toEqual([])
    expect(report.replicas).toEqual([{ instance: "P2", copied: 0 }])
    expect(report.unrouted.length).toBe(own.length)
    for (const one of report.unrouted) {
      expect(one.reason).toMatch(/: the time budget ran out before it was routed$/)
      expect([one.from, one.to].every((pad) => /^(R201|C201)#/.test(pad))).toBe(true)
    }
    expect(report.budgetSpent).toBe(true)
    expect(report.cleanupSkipped).toBe(true)
    expect(report.cleanupCapped).toBe(false)
    const tracks = report.edits.filter((edit) => edit.kind === "addTrack").length
    expect(tracks).toBe(own.reduce((sum, route) => sum + route.copper.tracks.length, 0))
    expectClean(files, report)
  })
})

describe("the time budget", () => {
  const ROWS = {
    [MAIN]: board(20, 16, [
      ...["A", "B", "C", "D"].flatMap((net, i) => [resistor(`L${i + 1}`, -4, (i - 1.5) * 3.5), resistor(`M${i + 1}`, 4, (i - 1.5) * 3.5), trace(`L${i + 1}.pin2`, net), trace(`M${i + 1}.pin1`, net)]),
    ]),
  }

  test("a run out of time keeps the connections it routed whole, reports the rest, and gives edits for the routed ones only", () => {
    const design = buildDesign(ROWS, MAIN)
    expect(design.pcb.ratsnest).toHaveLength(4)
    let tick = 0
    const report = routeDesign(design, { budgetMs: 2.5, clock: () => tick++ })
    expect(report.budgetSpent).toBe(true)
    expect(report.routed).toHaveLength(2)
    expect(report.unrouted).toHaveLength(2)
    for (const one of report.unrouted) expect(one.reason).toMatch(/^could not route \S+ to \S+: the time budget ran out before it was routed$/)
    const tracks = report.edits.filter((edit) => edit.kind === "addTrack").length
    expect(tracks).toBe(report.routed.reduce((sum, route) => sum + route.copper.tracks.length, 0))
    const checked = expectClean(ROWS, report)
    expect(checked.after.pcb.ratsnest).toHaveLength(2)
  })

  test("a budget that is not spent changes nothing", () => {
    const design = buildDesign(ROWS, MAIN)
    const report = routeDesign(design, { budgetMs: 60_000 })
    expect(report.budgetSpent).toBe(false)
    expect(withoutTime(report)).toEqual(withoutTime(routeDesign(design)))
  })
})
