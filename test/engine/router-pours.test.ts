import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { routeWithPours } from "../../src/engine/router/pour-rounds.js"
import type { RouteBoardInput, RouteReport, RoutedConnection } from "../../src/engine/router/route-board.js"
import { checkRoutedAll, routeDesign } from "../helpers/route-check.js"

const FOLDER = join(import.meta.dirname, "..", "fixtures", "can-module")
const CAN = "can-module.circuit.tsx"

function filesIn(folder: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else files[relative(FOLDER, path).split("\\").join("/")] = readFileSync(path, "utf8")
    }
  }
  walk(folder)
  return files
}

/** The CAN board with more elements before its closing tag. */
function canWith(extra: string): Record<string, string> {
  const files = filesIn(FOLDER)
  const main = files[CAN] ?? ""
  return { ...files, [CAN]: main.replace("  </board>", `    ${extra}\n  </board>`) }
}

const trackCount = (report: RouteReport, net?: string) =>
  report.routed.filter((route) => net === undefined || route.net === net).reduce((sum, route) => sum + route.copper.tracks.length, 0)

describe("routing around a hole", () => {
  const MAIN = "main.circuit.tsx"
  const circuit = `export default () => (<board width="20mm" height="12mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} pcbRotation={90} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={5} pcbY={0} pcbRotation={90} />
    <trace from="R1.pin1" to="R2.pin1" />
    <trace from="R1.pin2" to="R2.pin2" />
    <hole x={0} y={0} diameter={3} />
  </board>)`

  test("tracks keep the board-edge clearance from a hole, and the board passes every copper check", () => {
    const files = { [MAIN]: circuit }
    const design = buildDesign(files, MAIN)
    const report = routeDesign(design)
    expect(report.unrouted).toEqual([])
    expect(report.routed).toHaveLength(2)
    const checked = checkRoutedAll(files, MAIN, report.routed.map((route) => route.copper))
    expect(checked.copper).toEqual([])
    expect(checked.after.pcb.ratsnest).toEqual([])
  })
})

describe("the CAN board with GND pours", () => {
  const POURS = `<copperpour net="GND" layer="top" /><copperpour net="GND" layer="bottom" />`

  test("the pours make the GND connections, so the router lays fewer tracks; routed, the board passes the stage 4 checks with no ratsnest left", () => {
    const plain = routeDesign(buildDesign(filesIn(FOLDER), CAN))
    const files = canWith(POURS)
    const design = buildDesign(files, CAN)
    expect(design.pcb.ratsnest.filter((line) => line.net === "net.GND").length).toBeLessThan(buildDesign(filesIn(FOLDER), CAN).pcb.ratsnest.filter((line) => line.net === "net.GND").length)
    const report = routeDesign(design)
    expect(report.unrouted).toEqual([])
    expect(trackCount(report)).toBeLessThan(trackCount(plain))
    expect(trackCount(report, "net.GND")).toBeLessThan(trackCount(plain, "net.GND"))
    const checked = checkRoutedAll(files, CAN, report.routed.map((route) => route.copper))
    expect(checked.copper).toEqual([])
    expect(checked.after.violations.filter((v) => v.code.startsWith("pour") || v.code === "copper-hole")).toEqual([])
    expect(checked.after.pcb.ratsnest).toEqual([])
    expect(checked.after.pcb.pours.every((pour) => pour.area > 0)).toBe(true)
    expect({ ...routeDesign(design), ms: 0 }).toEqual({ ...report, ms: 0 })
  }, 60_000)

  test("the fill is computed again after the route: the routed board's fill differs from the unrouted one's", () => {
    const files = canWith(POURS)
    const design = buildDesign(files, CAN)
    const report = routeDesign(design, { scope: { kind: "nets", nets: ["TXCAN"] } })
    expect(report.routed.map((route) => route.net)).toEqual(["net.TXCAN"])
    const checked = checkRoutedAll(files, CAN, report.routed.map((route) => route.copper))
    const layer = report.routed[0]?.copper.tracks[0]?.layer
    const index = layer === "top" ? 0 : 1
    expect(checked.after.pcb.pours[index]?.area).toBeLessThan(design.pcb.pours[index]?.area ?? 0)
    expect(checked.copper).toEqual([])
  }, 30_000)
})

describe("another round when the refilled pour no longer makes a connection", () => {
  const MAIN = "main.circuit.tsx"
  const circuit = `export default () => (<board width="20mm" height="12mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={5} pcbY={0} />
    <trace from="R1.pin1" to="net.GND" />
    <trace from="R2.pin1" to="net.GND" />
    <trace from="R1.pin2" to="net.SIG" />
    <trace from="R2.pin2" to="net.SIG" />
    <copperpour net="GND" layer="top" />
  </board>)`
  const design = buildDesign({ [MAIN]: circuit }, MAIN)
  const input: RouteBoardInput = { layout: design.pcb, rules: design.rules, nets: design.circuit.nets }
  const report = (routed: RoutedConnection[]): RouteReport => ({ routed, unrouted: [], passes: 1, edits: [], ms: 0, cleanupCapped: false, cleanupSkipped: false, budgetSpent: false })
  const across: RoutedConnection = { net: "net.SIG", from: "R1#2", to: "R2#2", copper: { net: "net.SIG", tracks: [{ layer: "top", width: 0.25, points: [{ x: 0, y: -6 }, { x: 0, y: 6 }] }], vias: [] } }
  const gnd: RoutedConnection = { net: "net.GND", from: "R1#1", to: "R2#1", copper: { net: "net.GND", tracks: [{ layer: "bottom", width: 0.25, points: [{ x: -5, y: 0 }, { x: 5, y: 0 }] }], vias: [] } }

  test("the GND line the cut fill leaves is routed in a second round, and the reports are merged", () => {
    expect(design.pcb.ratsnest.map((line) => line.net)).toEqual(["net.SIG"])
    const calls: RouteBoardInput[] = []
    const merged = routeWithPours(input, {}, (given) => {
      calls.push(given)
      return report(calls.length === 1 ? [across] : [gnd])
    })
    expect(calls).toHaveLength(2)
    expect(calls[1]?.layout.ratsnest.map((line) => line.net)).toEqual(["net.GND"])
    expect(calls[1]?.layout.pours[0]?.polygons).toHaveLength(2)
    expect(calls[1]?.layout.tracks.map((track) => [track.id, track.net])).toEqual([["routed:1:t1", "net.SIG"]])
    expect(merged.routed).toEqual([across, gnd])
    expect(merged.passes).toBe(2)
    expect(merged.edits).toHaveLength(2)
  })

  test("a round that routes nothing ends it, and a board without pours is routed once", () => {
    let calls = 0
    const stuck = routeWithPours(input, {}, () => report(++calls === 1 ? [across] : []))
    expect(calls).toBe(2)
    expect(stuck.routed).toEqual([across])
    const plain: RouteBoardInput = { ...input, layout: { ...input.layout, board: { ...(input.layout.board as NonNullable<typeof input.layout.board>), pours: [] } } }
    let once = 0
    routeWithPours(plain, {}, () => report(++once === 1 ? [across] : []))
    expect(once).toBe(1)
  })
})
