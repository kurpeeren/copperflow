import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import type { RouteReport } from "../../src/engine/router/route-board.js"
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
function expectClean(files: Record<string, string>, report: RouteReport) {
  const checked = checkRoutedAll(files, MAIN, report.routed.map((route) => route.copper))
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

  test("three nets wanting a gap with room for one track a layer: two get it, the third is reported with the routes in its way", () => {
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
  })

  test("the scope narrows the run to some nets or the connections of some parts", () => {
    const design = buildDesign(CROSS, MAIN)
    expect(routeDesign(design, { scope: { kind: "nets", nets: ["B"] } }).routed.map((route) => route.net)).toEqual(["net.B"])
    expect(routeDesign(design, { scope: { kind: "nets", nets: ["net.A"] } }).routed.map((route) => route.net)).toEqual(["net.A"])
    expect(routeDesign(design, { scope: { kind: "parts", parts: ["R4"] } }).routed.map((route) => [route.from, route.to])).toEqual([["R3#2", "R4#1"]])
    expect(routeDesign(design, { scope: { kind: "parts", parts: ["R9"] } })).toMatchObject({ routed: [], unrouted: [], passes: 0 })
  })
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
})
