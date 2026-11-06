import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import type { Edit } from "../src/core/types.js"
import { buildDesign, type Design } from "../src/engine/design.js"
import { joinedNet, pendingLabel, placeLabelEdits, placeSummary } from "../studio/src/pcb/label-palette.js"

const FILE = "main.circuit.tsx"
const NONE: ReadonlySet<string> = new Set()
const wrap = (parts: string, body = "") => `export default () => (
  <board width="30mm" height="18mm">
${parts}
${body}
  </board>
)`

const PARTS = `    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
    <resistor name="R3" resistance="1k" footprint="0402" schX={6} schY={0} />`
const WIRED = wrap(PARTS, `    <trace from=".R1 > .pin1" to="net.GND" />
    <trace from=".R2 > .pin1" to=".R1 > .pin2" />`)
const ROTATED = wrap(`    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} schRotation={90} />`)
const TWICE = wrap(`    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R1" resistance="1k" footprint="0402" schX={3} schY={0} />`)

function setup(source: string) {
  return { design: buildDesign({ [FILE]: source }, FILE), source: { model: analyzeCircuit(source) } }
}

const place = (source: string, tool: "label" | "gnd" | "vcc", name: string, pin: string, locked = NONE) => {
  const { design, source: model } = setup(source)
  return placeLabelEdits(design, model, tool, name, pin, locked)
}

/** Applies the edits to the source and builds the result. */
function rebuilt(source: string, edits: Edit[]): Design {
  return buildDesign({ [FILE]: applyEdits(source, edits, NONE) }, FILE)
}

describe("placeLabelEdits", () => {
  test("GND on R1.pin2 is one addTrace to net.GND with one corner 0.5 outward", () => {
    expect(place(WIRED, "gnd", "", "R3.pin2")).toEqual([
      { kind: "addTrace", from: "R3.pin2", to: "net.GND", schematicRouteHints: [{ x: 7, y: 0 }] },
    ])
  })

  test("the corner goes out the way the pin faces: left pin to the left", () => {
    expect(place(WIRED, "gnd", "", "R3.pin1")).toEqual([{ kind: "addTrace", from: "R3.pin1", to: "net.GND", schematicRouteHints: [{ x: 5, y: 0 }] }])
  })

  test("the corner follows the part's rotation", () => {
    const edits = place(ROTATED, "gnd", "", "R1.pin2")
    expect(edits).toEqual([{ kind: "addTrace", from: "R1.pin2", to: "net.GND", schematicRouteHints: [{ x: 0, y: 1 }] }])
  })

  test("VCC is net VCC unless another name is typed", () => {
    expect(place(WIRED, "vcc", "", "R3.pin1")).toMatchObject([{ to: "net.VCC" }])
    expect(place(WIRED, "vcc", "V3_3", "R3.pin1")).toMatchObject([{ to: "net.V3_3" }])
  })

  test("a net label takes the typed name", () => {
    expect(place(WIRED, "label", "EN", "R3.pin2")).toMatchObject([{ from: "R3.pin2", to: "net.EN" }])
  })

  test("a net label without a name is blocked", () => {
    expect(place(WIRED, "label", "", "R3.pin2")).toEqual({ blocked: "Name the net label" })
  })

  test("names must be letters, digits and underscores, not starting with a digit", () => {
    for (const bad of ["1A", "A B", "A-B", "A.B", "net.A", "É"]) {
      expect(place(WIRED, "label", bad, "R3.pin2")).toEqual({ blocked: "Use letters, digits and _, starting with a letter or _" })
    }
    for (const good of ["A", "_x", "SPI_CLK", "V3_3", "a1"]) expect(Array.isArray(place(WIRED, "label", good, "R3.pin2"))).toBe(true)
  })

  test("a pin already on that net adds nothing", () => {
    expect(place(WIRED, "gnd", "", "R1.pin1")).toEqual({ blocked: "R1.pin1 is already on GND" })
    expect(place(WIRED, "label", "GND", "R1.pin1")).toEqual({ blocked: "R1.pin1 is already on GND" })
  })

  test("a pin that is not on the net yet is accepted even if it shares a wire with other pins", () => {
    expect(Array.isArray(place(WIRED, "gnd", "", "R2.pin1"))).toBe(true)
  })

  test("a part with a repeated name cannot be addressed", () => {
    expect(place(TWICE, "gnd", "", "R1~2.pin1")).toEqual({ blocked: "R1~2.pin1 has a repeated name and cannot be wired from the Studio" })
  })

  test("a locked part is refused with the locked wording", () => {
    expect(place(WIRED, "gnd", "", "R3.pin1", new Set(["R3"]))).toEqual({ blocked: "R3 is locked" })
  })

  test("a pin the sheet does not have is blocked", () => {
    expect(place(WIRED, "gnd", "", "R9.pin1")).toEqual({ blocked: "No pin there" })
  })

  test("a pin with its own pinLabels name is addressed by it", () => {
    const source = wrap(`    <chip name="U1" footprint="soic8" pinLabels={{ pin1: "VIN", pin2: "EN" }} schX={0} schY={0} />`)
    expect(place(source, "gnd", "", "U1.pin2")).toMatchObject([{ from: "U1.EN" }])
  })
})

describe("placed labels in the built design", () => {
  test("GND on a pin with no net draws a ground symbol at the corner", () => {
    const edits = place(WIRED, "gnd", "", "R3.pin2")
    if (!Array.isArray(edits)) throw new Error(edits.blocked)
    const label = rebuilt(WIRED, edits).schematic.labels.find((l) => l.net === "net.GND" && l.at.x === 7)
    expect(label).toMatchObject({ text: "GND", style: "ground", at: { x: 7, y: 0 }, side: "right" })
  })

  test("a net label on a single-pin net still draws its label at the corner", () => {
    const edits = place(WIRED, "label", "EN", "R3.pin1")
    if (!Array.isArray(edits)) throw new Error(edits.blocked)
    const design = rebuilt(WIRED, edits)
    expect(design.circuit.nets.find((n) => n.names.includes("EN"))?.pins).toEqual(["R3.pin1"])
    expect(design.schematic.labels.find((l) => l.text === "EN")).toMatchObject({ style: "label", at: { x: 5, y: 0 }, side: "left" })
  })

  test("VCC with a custom name draws a power symbol", () => {
    const edits = place(WIRED, "vcc", "V3_3", "R3.pin2")
    if (!Array.isArray(edits)) throw new Error(edits.blocked)
    expect(rebuilt(WIRED, edits).schematic.labels.find((l) => l.text === "V3_3")).toMatchObject({ style: "power", at: { x: 7, y: 0 } })
  })

  test("the label is where pendingLabel says it will be", () => {
    const { design } = setup(WIRED)
    const ghost = pendingLabel(design, "label", "EN", "R3.pin1")
    expect(ghost).toMatchObject({ label: { text: "EN", at: { x: 5, y: 0 }, side: "left", style: "label" }, wire: [{ x: 5.5, y: 0 }, { x: 5, y: 0 }] })
  })
})

describe("placeSummary and joinedNet", () => {
  test("the summaries name the label and the pin", () => {
    expect(placeSummary("gnd", "GND", "R1.pin2")).toBe("Add GND at R1.pin2")
    expect(placeSummary("vcc", "V3_3", "R1.pin2")).toBe("Add V3_3 at R1.pin2")
    expect(placeSummary("label", "EN", "R1.pin2")).toBe("Add EN label at R1.pin2")
  })

  test("joinedNet names the other named net a pin is on, so the Studio can ask first", () => {
    const { design } = setup(WIRED)
    expect(joinedNet(design, "R1.pin1", "VCC")).toBe("GND")
    expect(joinedNet(design, "R1.pin1", "GND")).toBeUndefined()
    expect(joinedNet(design, "R3.pin1", "VCC")).toBeUndefined()
  })
})
