import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { electricalChecks } from "../../src/engine/checks/erc.js"
import { buildDesign, type Design } from "../../src/engine/design.js"
import { FOOTPRINT_FILE } from "../../src/engine/engine.js"
import { collectProjectFiles } from "../../src/engine/project-files.js"
import type { Rules } from "../../src/engine/rules/schema.js"

const MAIN = "main.circuit.tsx"
const EXAMPLE = fileURLToPath(new URL("../../examples/usb-c-ldo", import.meta.url))

const ldo = (name: string) =>
  `<chip name="${name}" footprint="sot23_5" pinLabels={{ pin1: "VIN", pin2: "GND", pin3: "EN", pin4: "NC", pin5: "VOUT" }}
    pinAttributes={{ pin1: { requiresPower: true }, pin2: { requiresGround: true }, pin3: { isInput: true }, pin4: { doNotConnect: true }, pin5: { providesPower: true } }} />`

function design(body: string): Design {
  return buildDesign({ [MAIN]: `export default () => (\n  <board width="20mm" height="20mm">\n${body}\n</board>\n)\n` }, MAIN)
}

const run = (built: Design, rules: Rules = built.rules) => electricalChecks(built.circuit, built.schematic, rules)
const coded = <T extends { code: string }>(found: readonly T[], code: string): T[] => found.filter((v) => v.code === code)
const endOf = (built: Design, component: string, pin: string) => built.schematic.symbols.find((s) => s.component === component)?.pinEnds[pin]
const resistor = `<resistor name="R1" resistance="1k" footprint="0603" />`

/** An LDO with everything wired except the no_connect pin. */
const WIRED_LDO = `${ldo("U1")}
<trace from="U1.VIN" to="net.VBUS" />
<trace from="U1.EN" to="net.VBUS" />
<trace from="U1.GND" to="net.GND" />
<trace from="U1.VOUT" to="net.V3_3" />`

describe("pin-unconnected", () => {
  test("an input left floating is an error at its schematic pin end", () => {
    const built = design(`${ldo("U1")}\n<trace from="U1.VIN" to="net.VBUS" />\n<trace from="U1.GND" to="net.GND" />`)
    const found = coded(run(built), "pin-unconnected").filter((v) => v.items[0] === "U1.pin3")
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: "error", view: "schematic", id: "pin-unconnected:U1.pin3", message: "U1.pin3 (EN) is not connected" })
    expect(found[0]?.at).toEqual(endOf(built, "U1", "U1.pin3"))
  })

  test("a no_connect pin left alone is fine", () => {
    const found = coded(run(design(ldo("U1"))), "pin-unconnected")
    expect(found.map((v) => v.items[0])).not.toContain("U1.pin4")
  })

  test("an unconnected passive pin is only a warning", () => {
    const found = coded(run(design(resistor)), "pin-unconnected")
    expect(found.map((v) => [v.items[0], v.severity])).toEqual([["R1.pin1", "warning"], ["R1.pin2", "warning"]])
  })

  test("severity follows the pin type", () => {
    const found = coded(run(design(ldo("U1"))), "pin-unconnected")
    const severity = (pin: string) => found.find((v) => v.items[0] === pin)?.severity
    expect([severity("U1.pin1"), severity("U1.pin2"), severity("U1.pin3"), severity("U1.pin5")]).toEqual(["error", "error", "error", "warning"])
  })

  test("a pin alone on a named net is both pin-unconnected and single-pin-net", () => {
    const found = run(design(`${resistor}\n<trace from="R1.pin1" to="net.LONELY" />`))
    expect(coded(found, "pin-unconnected").find((v) => v.items[0] === "R1.pin1")).toMatchObject({ severity: "warning" })
    expect(coded(found, "single-pin-net")).toMatchObject([{ severity: "warning", items: ["net.LONELY"], id: "single-pin-net:net.LONELY" }])
  })

  test("a pin without a schematic symbol still gets its violation, with no position", () => {
    const built = design(`${ldo("U1")}\n<trace from="U1.VIN" to="net.VBUS" />`)
    const bare = { ...built.schematic, symbols: [] }
    const found = coded(electricalChecks(built.circuit, bare, built.rules), "pin-unconnected").find((v) => v.items[0] === "U1.pin3")
    expect(found).toBeDefined()
    expect(found).not.toHaveProperty("at")
  })
})

describe("nc-connected", () => {
  test("a wired no_connect pin is an error at its pin end", () => {
    const built = design(`${WIRED_LDO}\n<trace from="U1.NC" to="net.GND" />`)
    const found = coded(run(built), "nc-connected")
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: "error", items: ["U1.pin4"], view: "schematic" })
    expect(found[0]?.at).toEqual(endOf(built, "U1", "U1.pin4"))
  })

  test("a no_connect pin on a net of its own is fine", () => {
    expect(coded(run(design(`${WIRED_LDO}\n<trace from="U1.NC" to="net.NCNET" />`)), "nc-connected")).toEqual([])
  })
})

describe("output-conflict", () => {
  test("two LDO outputs on one net are an error naming both pins", () => {
    const body = `${ldo("U1")}\n${ldo("U2")}\n<trace from="U1.VOUT" to="net.OUT" />\n<trace from="U2.VOUT" to="net.OUT" />`
    const found = coded(run(design(body)), "output-conflict")
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: "error", items: ["U1.pin5", "U2.pin5"], view: "schematic" })
    expect(found[0]).not.toHaveProperty("at")
  })

  test("one output per net is fine", () => {
    expect(coded(run(design(WIRED_LDO)), "output-conflict")).toEqual([])
  })
})

describe("no-power-source", () => {
  const sink = `${ldo("U1")}\n<trace from="U1.VIN" to="net.VBUS" />`
  const fedByResistor = `${sink}\n${resistor}\n<trace from="R1.pin1" to="net.VBUS" />`

  test("a net fed by a connector has a source", () => {
    const body = `${sink}\n<connector name="J1" pinCount={2} />\n<trace from="J1.pin1" to="net.VBUS" />`
    expect(coded(run(design(body)), "no-power-source")).toEqual([])
  })

  test("a net fed only by a resistor has none, and the warning points at the power pin", () => {
    const built = design(fedByResistor)
    const found = coded(run(built), "no-power-source")
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: "warning", items: ["U1.pin1"], message: "net VBUS has a power input but nothing that supplies it" })
    expect(found[0]?.at).toEqual(endOf(built, "U1", "U1.pin1"))
  })

  test("a power_out pin, a pinheader or a battery is a source", () => {
    const sources = [
      `${ldo("U2")}\n<trace from="U2.VOUT" to="net.VBUS" />`,
      `<pinheader name="J2" pinCount={2} />\n<trace from="J2.pin1" to="net.VBUS" />`,
      `<battery name="BT1" />\n<trace from="BT1.pin1" to="net.VBUS" />`,
    ]
    for (const source of sources) expect(coded(run(design(`${sink}\n${source}`)), "no-power-source")).toEqual([])
  })

  test("a name in globalNets counts as a source", () => {
    const built = design(fedByResistor)
    const rules: Rules = { ...built.rules, globalNets: [...built.rules.globalNets, "VBUS"] }
    expect(coded(run(built, rules), "no-power-source")).toEqual([])
  })

  test("a merged net matches globalNets by any of its names", () => {
    const built = design(`${sink}\n<trace from="net.VBUS" to="net.RAIL" />`)
    const rules: Rules = { ...built.rules, globalNets: ["RAIL"] }
    expect(coded(run(built, rules), "no-power-source")).toEqual([])
  })
})

describe("single-pin-net", () => {
  test("an unnamed net is not reported", () => {
    expect(coded(run(design(resistor)), "single-pin-net")).toEqual([])
  })

  test("the finding points at the lone pin's end", () => {
    const built = design(`${resistor}\n<trace from="R1.pin1" to="net.LONELY" />`)
    expect(coded(run(built), "single-pin-net")[0]?.at).toEqual(endOf(built, "R1", "R1.pin1"))
  })
})

test("results are sorted by id", () => {
  const ids = run(design(ldo("U1"))).map((v) => v.id)
  expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b, "en", { numeric: true })))
})

describe("the usb-c-ldo example", () => {
  // Known: J1 declares VBUS1 and VBUS2 as power_out and the example ties both to net.VBUS, so output-conflict fires.
  // Awaiting a ruling; this becomes a plain test once the example or the rule changes.
  test.fails("has no ERC errors", async () => {
    const built = buildDesign(await collectProjectFiles(EXAMPLE, { include: FOOTPRINT_FILE }), "index.circuit.tsx")
    expect(run(built).filter((v) => v.severity === "error")).toEqual([])
  })
})
