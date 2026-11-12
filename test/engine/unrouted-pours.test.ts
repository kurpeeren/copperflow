import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { padsJoinedByPours } from "../../src/engine/pour/joins.js"
import { routeDesign } from "../helpers/route-check.js"

const MAIN = "main.circuit.tsx"

/** Four resistors, three of them with their second pin on GND, and the GND pour (or none). */
const circuit = (pour: string) => `export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-8} pcbY={4} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={0} pcbY={4} />
    <resistor name="R3" resistance="1k" footprint="0603" pcbX={8} pcbY={4} />
    <resistor name="R4" resistance="1k" footprint="0603" pcbX={0} pcbY={-4} />
    <trace from=".R1 > .pin1" to=".R2 > .pin1" />
    <trace from=".R3 > .pin1" to=".R4 > .pin1" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".R2 > .pin2" to="net.GND" />
    <trace from=".R3 > .pin2" to="net.GND" />
    <trace from=".R4 > .pin2" to="net.GND" />
    ${pour}
  </board>
)
`

const build = (pour: string) => buildDesign({ [MAIN]: circuit(pour) }, MAIN)
const message = (pour: string) => build(pour).violations.find((v) => v.code === "unrouted")?.message

describe("check_circuit's count of unrouted connections and the pours", () => {
  test("without a pour every connection needs a track and the line is the plain count, as before", () => {
    const design = build("")
    expect(design.pcb.ratsnest).toHaveLength(5)
    expect(message("")).toBe("5 connections are not routed yet")
  })

  test("with a GND pour on the parts' layer the line gives both counts, and the connections that need a track are the ones the router routes", () => {
    const without = build("")
    const pour = `<copperpour net="GND" layer="top" />`
    const design = build(pour)
    const joined = padsJoinedByPours(design.pcb)
    expect(joined.map((pad) => pad.id).sort()).toEqual(["R1#2", "R2#2", "R3#2", "R4#2"])
    // The pour makes the GND connections: 3 of the 5 lines are gone, the 2 signal lines remain.
    expect(design.pcb.ratsnest).toHaveLength(2)
    expect(without.pcb.ratsnest.length - design.pcb.ratsnest.length).toBe(joined.length - 1)
    expect(message(pour)).toBe("2 connections are not routed yet and need a track; 4 pads on GND are joined by pours and need none")
    // The router is given the same lines, so its total is the first count.
    const report = routeDesign(design)
    expect(report.routed.length + report.unrouted.length).toBe(design.pcb.ratsnest.length)
  })

  test("a pour on the other layer joins no pad of these parts: the line stays the plain count and says nothing of pours", () => {
    const design = build(`<copperpour net="GND" layer="bottom" />`)
    expect(padsJoinedByPours(design.pcb)).toEqual([])
    expect(message(`<copperpour net="GND" layer="bottom" />`)).toBe("5 connections are not routed yet")
  })

  test("one connection left reads in the singular, and a pad a pour alone touches is not counted as joined", () => {
    const one = `export default () => (
  <board width="20mm" height="12mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={4} pcbY={0} />
    <trace from=".R1 > .pin1" to=".R2 > .pin1" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".R2 > .pin2" to="net.GND" />
    <copperpour net="GND" layer="top" />
  </board>
)
`
    const design = buildDesign({ [MAIN]: one }, MAIN)
    expect(design.violations.find((v) => v.code === "unrouted")?.message).toBe("1 connection is not routed yet and needs a track; 2 pads on GND are joined by pours and need none")
    const alone = buildDesign({ [MAIN]: one.replace('<trace from=".R2 > .pin2" to="net.GND" />', "") }, MAIN)
    expect(padsJoinedByPours(alone.pcb)).toEqual([])
    expect(alone.violations.find((v) => v.code === "unrouted")?.message).toBe("1 connection is not routed yet")
  })
})
