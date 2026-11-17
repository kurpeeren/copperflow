import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { labelStyle } from "../src/engine/schematic-nets.js"
import { lengthText, netBadge, netRows, type NetRow } from "../studio/src/net-rows.js"

const FILE = "main.circuit.tsx"
const build = (body: string) =>
  buildDesign(
    {
      [FILE]: `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" />
    <resistor name="R2" resistance="1k" footprint="0402" />
    <resistor name="R10" resistance="1k" footprint="0402" />
${body}
  </board>
)`,
    },
    FILE,
  )

describe("netRows", () => {
  test("an empty design has no rows", () => {
    expect(netRows(buildDesign({ [FILE]: `export default () => <board width="10mm" height="10mm" />` }, FILE))).toEqual([])
  })

  test("named nets come first in natural order, then unnamed nets by their first pin", () => {
    const design = build(`    <trace from=".R10 > .pin1" to="net.SIG10" />
    <trace from=".R1 > .pin1" to="net.SIG2" />
    <trace from=".R2 > .pin1" to="net.GND" />
    <trace from=".R2 > .pin2" to=".R10 > .pin2" />`)
    expect(netRows(design).map((row) => row.label)).toEqual(["GND", "SIG2", "SIG10", "(unnamed) R2.pin2"])
  })

  test("rows carry the net id, the pin count and a ground or power badge", () => {
    const design = build(`    <trace from=".R1 > .pin1" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.GND" />
    <trace from=".R10 > .pin1" to="net.VCC" />
    <trace from=".R1 > .pin2" to="net.SIG" />`)
    const rows = netRows(design)
    expect(rows.find((row) => row.label === "GND")).toMatchObject({ id: "net.GND", pins: 2, badge: "ground" })
    expect(rows.find((row) => row.label === "VCC")).toMatchObject({ pins: 1, badge: "power" })
    expect(rows.find((row) => row.label === "SIG")?.badge).toBeUndefined()
  })

  test("an unnamed net has no badge", () => {
    const design = build(`    <trace from=".R1 > .pin1" to=".R2 > .pin1" />`)
    expect(netRows(design)).toEqual([{ id: "net:R1.pin1", label: "(unnamed) R1.pin1", pins: 2, named: false }])
  })
})

describe("netBadge", () => {
  test("agrees with the engine's label style for ground and power names", () => {
    const names = ["GND", "AGND", "DGND", "PGND", "gnd", "GND_1", "VSS", "VCC", "VDD", "VBUS", "VIN", "V3_3", "+5V", "SIG", "ENABLE", "CLK", "VX", "GNDA"]
    for (const name of names) {
      const style = labelStyle(name)
      expect(netBadge([name])).toBe(style === "label" ? undefined : style)
    }
  })

  test("takes the first name that is a ground or power name, as the engine's label does", () => {
    expect(netBadge(["SIG", "GND"])).toBe("ground")
    expect(netBadge([])).toBeUndefined()
  })
})

describe("netRows with fast lines", () => {
  test("a net of a pair shows its length, partner and skew", () => {
    const design = buildDesign({ [FILE]: `export default () => <board width="10mm" height="10mm" />` }, FILE)
    const nets = [
      { id: "net.P", names: ["P"], pins: ["U1.1", "J1.1"] },
      { id: "net.N", names: ["N"], pins: ["U1.2", "J1.2"] },
    ]
    const lines = [
      { net: "net.P", length: 10, from: "J1#1", to: "U1#1", vias: 0, partner: "net.N", skew: 1 },
      { net: "net.N", length: 11, from: "J1#2", to: "U1#2", vias: 0, partner: "net.P", skew: 1 },
    ]
    const rows = netRows({ ...design, circuit: { ...design.circuit, nets }, lines })
    expect(rows.map((row) => [row.label, row.length, row.partner, row.skew])).toEqual([
      ["N", 11, "P", 1],
      ["P", 10, "N", 1],
    ])
    expect(lengthText(rows[0] as NetRow)).toBe("11.0 mm, pair P, skew 1.0 mm")
  })
})
