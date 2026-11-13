import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { routeDesign } from "../helpers/route-check.js"

const MAIN = "main.circuit.tsx"
const LAYOUT = "main.circuit.layout.json"

/** Four resistors, all with their second pin on GND, two signal connections, and the GND pour (or none). */
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
const POUR = `<copperpour net="GND" layer="top" />`

describe("check_circuit's count of unrouted connections and the pours", () => {
  test("without a pour every connection needs a track and the line is the plain count, as before", () => {
    const design = build("")
    expect(design.pcb.ratsnest).toHaveLength(5)
    expect(design.pcb.pourMade ?? []).toEqual([])
    expect(message("")).toBe("5 connections are not routed yet")
  })

  test("the connections the pour makes are the ratsnest without the pour less the ratsnest with it, and the router gets the rest", () => {
    const without = build("")
    const design = build(POUR)
    expect(design.pcb.ratsnest).toHaveLength(2)
    expect(design.pcb.pourMade).toEqual([{ net: "net.GND", count: 3 }])
    expect(without.pcb.ratsnest.length - design.pcb.ratsnest.length).toBe(3)
    expect(message(POUR)).toBe("2 connections are not routed yet and need a track; 3 more on GND are made by pours and need none")
    const report = routeDesign(design)
    expect(report.routed.length + report.unrouted.length).toBe(design.pcb.ratsnest.length)
  })

  test("a pour on the other layer makes no connection: the line stays the plain count and says nothing of pours", () => {
    const bottom = `<copperpour net="GND" layer="bottom" />`
    expect(build(bottom).pcb.pourMade ?? []).toEqual([])
    expect(message(bottom)).toBe("5 connections are not routed yet")
  })

  test("one connection each way reads in the singular", () => {
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
    expect(design.violations.find((v) => v.code === "unrouted")?.message).toBe("1 connection is not routed yet and needs a track; 1 more on GND is made by pours and needs none")
  })

  test("a ground pad with its own stub track inside the pour, joined to nothing else, adds nothing", () => {
    const alone = `export default () => (
  <board width="20mm" height="12mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={4} pcbY={0} />
    <trace from=".R1 > .pin1" to=".R2 > .pin1" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <copperpour net="GND" layer="top" />
  </board>
)
`
    const bare = buildDesign({ [MAIN]: alone }, MAIN)
    const pad = bare.pcb.parts.flatMap((part) => part.pads).find((one) => one.id === "R1#2")
    if (!pad) throw new Error("no pad R1#2")
    const stub = `${JSON.stringify({ t: "track", id: "t0001", net: "GND", layer: "top", width: 0.25, points: [{ x: pad.x, y: pad.y }, { x: pad.x, y: pad.y + 1 }], locked: false, by: "human" })}\n`
    const design = buildDesign({ [MAIN]: alone, [LAYOUT]: stub }, MAIN)
    expect(design.pcb.tracks).toHaveLength(1)
    expect(design.pcb.pourMade ?? []).toEqual([])
    expect(design.violations.find((v) => v.code === "unrouted")?.message).toBe("1 connection is not routed yet")
  })
})
