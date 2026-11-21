// Track width for current: the current a sheet port says it carries, or a net class's `current`, against the IPC-2221
// width its tracks need for a 10 °C rise; a narrower track is a `track-current` warning.
import { describe, expect, test } from "vitest"
import { currentIn, trackCurrentChecks, widthForCurrent } from "../../src/engine/checks/track-current.js"
import { buildDesign } from "../../src/engine/design.js"

const MAIN = "main.circuit.tsx"
const LAYOUT = "main.circuit.layout.json"

const SWITCH = `export default function Switch() {
  return (
    <sheet>
      <port name="LOAD" type="passive" carries="contact, 3 A at most" />
      <port name="SIG" type="input" carries="3.3 V logic, 0.5 mA" />
      <resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />
      <trace from="R1.pin1" to="net.LOAD" />
      <trace from="R1.pin2" to="net.SIG" />
    </sheet>
  )
}
`

const track = (id: string, net: string, width: number, layer = "top", y = 5) =>
  `{"t":"track","id":"${id}","net":"${net}","layer":"${layer}","width":${width},"points":[{"x":-10,"y":${y}},{"x":10,"y":${y}}],"locked":false,"by":"human"}`

function design(tracks: string[], extra: Record<string, string> = {}) {
  const main = `import Switch from "./Switch.sheet"\nexport default () => (\n  <board width="40mm" height="40mm">\n    <Switch name="S1" connections={{ LOAD: "OUT", SIG: "CTL" }} />\n  </board>\n)\n`
  return buildDesign({ [MAIN]: main, "Switch.sheet.tsx": SWITCH, [LAYOUT]: `${tracks.join("\n")}\n`, ...extra }, MAIN)
}

const currentWarnings = (built: ReturnType<typeof design>) => built.violations.filter((v) => v.code === "track-current")

describe("the current a text names", () => {
  test("is the largest current written, in amperes", () => {
    expect(currentIn("contact common, 10 A 250 VAC / 28 VDC resistive at most")).toBe(10)
    expect(currentIn("12 V in, 33 mA (coil 30 mA, LED 2 mA)")).toBeCloseTo(0.033, 9)
    expect(currentIn("0 off; 3.3 V or 5 V logic on, 0.03 mA; open is off")).toBeCloseTo(0.00003, 12)
    expect(currentIn("2.5A peak")).toBe(2.5)
    expect(currentIn("3,5 A")).toBe(3.5)
    expect(currentIn("leakage 40 µA")).toBeCloseTo(0.00004, 12)
    expect(currentIn("leakage 40 uA")).toBeCloseTo(0.00004, 12)
  })

  test("is none when the text names no current: volts, charge and words are not currents", () => {
    expect(currentIn("3.3 V logic in")).toBeUndefined()
    expect(currentIn("250 VAC")).toBeUndefined()
    expect(currentIn("a 2 Ah cell")).toBeUndefined()
    expect(currentIn("500 mAh battery")).toBeUndefined()
    expect(currentIn("A to B")).toBeUndefined()
  })

  test("a part number ending in A is not a current", () => {
    expect(currentIn("LM2596A buck, 3 A out")).toBe(3)
    expect(currentIn("TPS62A")).toBeUndefined()
    expect(currentIn("pin 12A3")).toBeUndefined()
  })
})

describe("the width a current needs (IPC-2221, 10 °C rise)", () => {
  test("0.6 A on an outer layer of 1 oz copper needs about 0.15 mm, as design-rules.md works it out", () => {
    expect(widthForCurrent(0.6, 0.035, "outer")).toBeCloseTo(0.148, 2)
  })

  test("an inner layer needs about 2.6 times the width, and thicker copper less", () => {
    const outer = widthForCurrent(3, 0.035, "outer")
    expect(widthForCurrent(3, 0.035, "inner") / outer).toBeCloseTo(2 ** (1 / 0.725), 6)
    expect(widthForCurrent(3, 0.07, "outer")).toBeCloseTo(outer / 2, 9)
  })
})

describe("the track-current check", () => {
  test("warns once per net when its tracks are narrower than the current its port carries needs, naming the port", () => {
    const built = design([track("t0001", "net.OUT", 0.25), track("t0002", "net.OUT", 0.3, "top", 8)])
    const found = currentWarnings(built)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: "warning", items: ["t0001", "t0002"], view: "pcb" })
    const needed = widthForCurrent(3, 0.035, "outer")
    expect(found[0]?.message).toContain('OUT carries 3 A (S1 port LOAD: "contact, 3 A at most")')
    expect(found[0]?.message).toContain(`${needed.toFixed(2)} mm`)
    expect(found[0]?.message).toContain("2 tracks are 0.25 to 0.3 mm")
  })

  test("is quiet when the tracks are wide enough, and for a small current", () => {
    expect(currentWarnings(design([track("t0001", "net.OUT", 1.5), track("t0002", "net.CTL", 0.25, "top", 8)]))).toEqual([])
  })

  test("an inner-layer track needs the inner width", () => {
    const rules = `fabrication:\n  profile: jlcpcb-4layer\n`
    const main = `import Switch from "./Switch.sheet"\nexport default () => (\n  <board width="40mm" height="40mm" layers={4}>\n    <Switch name="S1" connections={{ LOAD: "OUT", SIG: "CTL" }} />\n  </board>\n)\n`
    const built = design([track("t0001", "net.OUT", 1.5, "inner1")], { [MAIN]: main, "rules.yaml": rules })
    expect(currentWarnings(built).map((v) => v.items)).toEqual([["t0001"]])
    expect(currentWarnings(built)[0]?.message).toContain(`${widthForCurrent(3, 0.035, "inner").toFixed(2)} mm on an inner layer`)
  })

  test("a net class's current applies to its nets, and the larger of class and port wins", () => {
    const rules = `netClasses:\n  power:\n    current: 5\n    nets: [CTL]\n`
    const built = design([track("t0001", "net.CTL", 0.25)], { "rules.yaml": rules })
    expect(built.diagnostics.filter((d) => d.code === "rules")).toEqual([])
    expect(currentWarnings(built)[0]?.message).toContain("CTL carries 5 A (net class power)")
  })

  test("a net class's current must be a positive number of amperes", () => {
    const built = design([], { "rules.yaml": `netClasses:\n  power:\n    current: "lots"\n    nets: [CTL]\n` })
    expect(built.diagnostics.some((d) => d.code === "rules" && d.severity === "error" && d.message.includes("current"))).toBe(true)
  })

  test("the sheet file built alone checks its own ports' nets", () => {
    const built = buildDesign({ "Switch.sheet.tsx": SWITCH }, "Switch.sheet.tsx")
    const narrow = { id: "t0001", net: "net.LOAD", layer: "top" as const, width: 0.25, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }], locked: false, by: "human" as const, pads: [] }
    const found = trackCurrentChecks(built.circuit, { ...built.pcb, tracks: [narrow] }, built.rules)
    expect(found.map((v) => v.items)).toEqual([["t0001"]])
    expect(found[0]?.message).toContain('LOAD carries 3 A (port LOAD: "contact, 3 A at most")')
  })
})
