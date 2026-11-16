import { expect, test } from "vitest"
import { electricalChecks } from "../../src/engine/checks/erc.js"
import { buildDesign } from "../../src/engine/design.js"

const MAIN = "main.circuit.tsx"

const DRIVER = `export default function Driver() {
  return (
    <sheet does="Logic driver: one buffered output" sources={["https://example.com/driver.pdf", "App note 12"]}>
      <port name="IN" type="input" carries="3.3 V logic in" />
      <port name="OUT" type="output" carries="3.3 V logic, 10 mA at most" />
      <port name="GND" type="ground" />
      <port name="AUX" />
      <resistor name="R1" resistance="1k" />
      <resistor name="R2" resistance="1k" />
      <trace from="R1.pin1" to="net.IN" />
      <trace from="R1.pin2" to="net.OUT" />
      <trace from="R2.pin1" to="net.AUX" />
      <trace from="R2.pin2" to="net.GND" />
    </sheet>
  )
}
`

const LOAD = `export default function Load() {
  return (
    <sheet>
      <port name="VIN" type="power_in" carries="5 V, 20 mA" />
      <port name="GND" type="ground" />
      <resistor name="R1" resistance="1k" />
      <trace from="R1.pin1" to="net.VIN" />
      <trace from="R1.pin2" to="net.GND" />
    </sheet>
  )
}
`

function design(body: string, extra: Record<string, string> = {}) {
  const main = `import Driver from "./Driver.sheet"\nimport Load from "./Load.sheet"\nexport default () => (\n  <board width="40mm" height="40mm">\n${body}\n  </board>\n)\n`
  return buildDesign({ [MAIN]: main, "Driver.sheet.tsx": DRIVER, "Load.sheet.tsx": LOAD, ...extra }, MAIN)
}

const codes = (built: ReturnType<typeof design>) => electricalChecks(built.circuit, built.schematic, built.rules).map((v) => `${v.code} ${v.items.join(",")}`)

test("an instance carries its sheet's card: what it does, its sources, each port's type and what it carries", () => {
  const built = design(`<Driver name="D1" connections={{ IN: "A", OUT: "B", GND: "GND" }} />\n<resistor name="R9" />\n<trace from="R9.pin1" to="net.A" />`)
  const instance = built.circuit.instances?.[0]
  expect(instance).toMatchObject({ does: "Logic driver: one buffered output", sources: ["https://example.com/driver.pdf", "App note 12"] })
  expect(instance?.ports.map(({ name, type, carries }) => ({ name, type, carries }))).toEqual([
    { name: "IN", type: "input", carries: "3.3 V logic in" },
    { name: "OUT", type: "output", carries: "3.3 V logic, 10 mA at most" },
    { name: "GND", type: "ground", carries: undefined },
    { name: "AUX", type: undefined, carries: undefined },
  ])
  expect(built.circuit.diagnostics.filter((d) => d.severity === "error")).toEqual([])
})

test("the sheet file built alone has its card too", () => {
  const built = buildDesign({ "Driver.sheet.tsx": DRIVER }, "Driver.sheet.tsx")
  expect(built.circuit.sheet).toMatchObject({ does: "Logic driver: one buffered output", sources: ["https://example.com/driver.pdf", "App note 12"] })
  expect(built.circuit.sheet?.ports.find((port) => port.name === "OUT")).toMatchObject({ type: "output", carries: "3.3 V logic, 10 mA at most" })
})

test("two instances' outputs joined are an output conflict the electrical check sees", () => {
  const built = design(
    [`<Driver name="D1" connections={{ IN: "A", OUT: "B", GND: "GND" }} />`, `<Driver name="D2" connections={{ IN: "A", OUT: "B", GND: "GND" }} />`].join("\n"),
  )
  expect(codes(built)).toContain("output-conflict D1.OUT,D2.OUT")
})

test("one instance's output on a net is no conflict", () => {
  const built = design(`<Driver name="D1" connections={{ IN: "A", OUT: "B", GND: "GND" }} />`)
  expect(codes(built).filter((line) => line.startsWith("output-conflict"))).toEqual([])
})

test("a block's power input with nothing that supplies it is reported, by the instance's pin", () => {
  const built = design(`<Load name="L1" connections={{ VIN: "V5", GND: "GND" }} />\n<resistor name="R9" />\n<trace from="R9.pin1" to="net.V5" />`)
  expect(codes(built)).toContain("no-power-source L1.VIN")
})

test("a port without a type counts as passive and changes no check", () => {
  const plain = DRIVER.replace(/ type="output"/, "")
  const built = design(
    [`<Driver name="D1" connections={{ IN: "A", OUT: "B", GND: "GND" }} />`, `<Driver name="D2" connections={{ IN: "A", OUT: "B", GND: "GND" }} />`].join("\n"),
    { "Driver.sheet.tsx": plain },
  )
  expect(codes(built).filter((line) => line.startsWith("output-conflict"))).toEqual([])
})

test("a bad card is an error each, and the rest of the sheet still builds", () => {
  const bad = DRIVER.replace('does="Logic driver: one buffered output"', `does="${"x".repeat(161)}"`)
    .replace('type="input"', 'type="sideways"')
    .replace('carries="3.3 V logic in"', `carries="${"y".repeat(81)}"`)
  const built = buildDesign({ "Driver.sheet.tsx": bad }, "Driver.sheet.tsx")
  const messages = built.circuit.diagnostics.filter((d) => d.severity === "error").map((d) => d.message)
  expect(messages.some((m) => m.includes("does") && m.includes("160"))).toBe(true)
  expect(messages.some((m) => m.includes("Port IN: type"))).toBe(true)
  expect(messages.some((m) => m.includes("Port IN: carries") && m.includes("80"))).toBe(true)
  expect(built.circuit.sheet?.ports.find((port) => port.name === "IN")?.type).toBeUndefined()
})

test("a driving port speaks for the part that drives it inside: one instance is one source", () => {
  const chip = `export default function Buf() {
  return (
    <sheet>
      <port name="OUT" type="output" />
      <chip name="U1" pinLabels={{ pin1: "Y", pin2: "GND" }} pinAttributes={{ Y: { isOutput: true } }} />
      <trace from="U1.Y" to="net.OUT" />
      <trace from="U1.GND" to="net.GND" />
    </sheet>
  )
}
`
  const main = `import Buf from "./Buf.sheet"\nexport default () => (\n  <board width="40mm" height="40mm">\n<Buf name="B1" connections={{ OUT: "X" }} />\n<resistor name="R9" />\n<trace from="R9.pin1" to="net.X" />\n  </board>\n)\n`
  const built = buildDesign({ [MAIN]: main, "Buf.sheet.tsx": chip }, MAIN)
  expect(built.circuit.components.find((c) => c.id === "U101")?.pins[0]?.type).toBe("output")
  const found = electricalChecks(built.circuit, built.schematic, built.rules).map((v) => v.code)
  expect(found).not.toContain("output-conflict")
})
