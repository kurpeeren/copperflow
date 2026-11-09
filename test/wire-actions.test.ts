import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import { buildDesign } from "../src/engine/design.js"
import { cornerRemoval, wireNet, wireProperties, wireReasons, wireRemoval } from "../studio/src/pcb/wire-actions.js"

const FILE = "main.circuit.tsx"

const SOURCE = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
    <resistor name="R3" resistance="1k" footprint="0402" schX={6} schY={0} />
    <resistor name="R4" resistance="1k" footprint="0402" schX={0} schY={3} />
    <resistor name="R5" resistance="1k" footprint="0402" schX={-1} schY={6} schRotation={180} />
    <resistor name="R6" resistance="1k" footprint="0402" schX={3} schY={6} />
    <trace from=".R1 > .pin2" to=".R2 > .pin1" schematicRouteHints={[{ x: 1, y: 1 }, { x: 2, y: 1 }]} />
    <trace from=".R1 > .pin2" to=".R2 > .pin1" />
    <trace from=".R3 > .pin1" to="net.VCC" schematicRouteHints={[{ x: 7, y: 1 }, { x: 7, y: 2 }]} />
    <trace from="net.VCC" to=".R4 > .pin1" schematicRouteHints={[{ x: -2, y: 4 }, { x: -2, y: 2 }]} />
    <trace from=".R3 > .pin2" to=".R4 > .pin2" />
    <trace from=".R5 > .pin1" to="net.GND" />
    <trace from=".R6 > .pin1" to="net.GND" />
  </board>
)`

function setup(source = SOURCE) {
  const design = buildDesign({ [FILE]: source }, FILE)
  return { design, model: { model: analyzeCircuit(source) } }
}

const { design, model } = setup()
const ENGINE = "This wire has no trace of its own: Studio draws it for net GND"
const EXPRESSION = SOURCE.replace(`schematicRouteHints={[{ x: 7, y: 1 }, { x: 7, y: 2 }]}`, `schematicRouteHints={hints}`).replace("export default", "const hints = [{ x: 7, y: 1 }, { x: 7, y: 2 }]\nexport default")
const wireIds = (source: string) => setup(source).design.schematic.wires.map((w) => w.id)

describe("Delete on a wire", () => {
  test("removes the wire's trace, named by its ends as the code writes them, in one edit", () => {
    expect(wireRemoval(design, model, "wire:R3.pin1|net.VCC")).toEqual({
      edits: [{ kind: "removeTrace", from: ".R3 > .pin1", to: "net.VCC" }],
      summary: "remove the wire from R3.pin1 to net VCC",
    })
    expect(wireRemoval(design, model, "wire:net.VCC|R4.pin1")).toMatchObject({ edits: [{ kind: "removeTrace", from: "net.VCC", to: ".R4 > .pin1" }] })
  })

  test("after the edit and a rebuild the wire is gone and the others stay", () => {
    const removal = wireRemoval(design, model, "wire:R3.pin1|net.VCC")
    if (!("edits" in removal)) throw new Error(removal.blocked)
    const after = wireIds(applyEdits(SOURCE, removal.edits, new Set()))
    expect(after).not.toContain("wire:R3.pin1|net.VCC")
    expect(after).toContain("wire:net.VCC|R4.pin1")
    expect(after).toContain("wire:R1.pin2|R2.pin1")
  })

  test("a wire Studio draws on its own has no trace, and says which net draws it", () => {
    expect(wireRemoval(design, model, "wire:net.GND:1")).toEqual({ blocked: ENGINE })
  })

  test("a repeated wire, a locked end and a read-only trace are refused with a reason about deleting", () => {
    expect(wireRemoval(design, model, "wire:R1.pin2|R2.pin1#2")).toEqual({ blocked: "This wire repeats another between the same ends; delete it in the code" })
    expect(wireRemoval(design, model, "wire:R1.pin2|R2.pin1", new Set(["R2"]))).toEqual({ blocked: "R2 is locked" })
    expect(wireRemoval(design, model, "wire:net.VCC|R4.pin1", new Set(["R4"]))).toEqual({ blocked: "R4 is locked" })
    const looped = setup(SOURCE.replace(`<trace from=".R3 > .pin2" to=".R4 > .pin2" />`, `{[1].map(() => <trace from=".R3 > .pin2" to=".R4 > .pin2" />)}`))
    expect(wireRemoval(looped.design, looped.model, "wire:R3.pin2|R4.pin2")).toMatchObject({ blocked: expect.stringMatching(/^This wire is read-only \(.+\); delete it in the code$/) })
  })

  test("corners written as an expression do not stop Delete, as core removes the whole trace", () => {
    const source = EXPRESSION
    const { design: d, model: m } = setup(source)
    const removal = wireRemoval(d, m, "wire:R3.pin1|net.VCC")
    expect(removal).toEqual({ edits: [{ kind: "removeTrace", from: ".R3 > .pin1", to: "net.VCC" }], summary: "remove the wire from R3.pin1 to net VCC" })
    if (!("edits" in removal)) throw new Error(removal.blocked)
    expect(wireIds(applyEdits(source, removal.edits, new Set()))).not.toContain("wire:R3.pin1|net.VCC")
  })

  test("a wire no longer on the sheet is refused", () => {
    expect(wireRemoval(design, model, "wire:nothing")).toEqual({ blocked: "This wire is no longer on the sheet" })
  })
})

describe("Remove corners", () => {
  test("empties the trace's corners, so Studio draws the wire again on its own", () => {
    expect(cornerRemoval(design, model, "wire:R1.pin2|R2.pin1")).toEqual({
      edits: [{ kind: "setTraceHints", from: ".R1 > .pin2", to: ".R2 > .pin1", schematicRouteHints: [] }],
      summary: "remove the corners of the wire from R1.pin2 to R2.pin1",
    })
  })

  test("after the edit and a rebuild the wire runs with at most one elbow", () => {
    const removal = cornerRemoval(design, model, "wire:R1.pin2|R2.pin1")
    if (!("edits" in removal)) throw new Error(removal.blocked)
    const next = setup(applyEdits(SOURCE, removal.edits, new Set()))
    const wire = next.design.schematic.wires.find((w) => w.id === "wire:R1.pin2|R2.pin1")
    expect(wire?.points.length).toBeLessThanOrEqual(3)
  })

  test("is refused for a wire Studio draws, a wire with no corners, and corners Studio drew", () => {
    expect(cornerRemoval(design, model, "wire:net.GND:1")).toEqual({ blocked: ENGINE })
    expect(cornerRemoval(design, model, "wire:R1.pin2|R2.pin1#2")).toEqual({ blocked: "This wire has no corners" })
    expect(cornerRemoval(design, model, "wire:R3.pin2|R4.pin2")).toEqual({ blocked: "Studio draws this wire's corner; the code has none to remove" })
  })

  test("is refused the same way as Delete for a locked end", () => {
    expect(cornerRemoval(design, model, "wire:R3.pin1|net.VCC", new Set(["R3"]))).toEqual({ blocked: "R3 is locked" })
  })

  test("keeps the reshaping reasons: corners written as an expression, and a repeat named for its corners", () => {
    const expression = setup(EXPRESSION)
    expect(cornerRemoval(expression.design, expression.model, "wire:R3.pin1|net.VCC")).toEqual({ blocked: "The corners of this wire are an expression; change them in the code" })
    const twice = `<trace from=".R1 > .pin2" to=".R2 > .pin1" schematicRouteHints={[{ x: 1, y: 1 }, { x: 2, y: 1 }]} />`
    const repeated = setup(SOURCE.replace(`<trace from=".R1 > .pin2" to=".R2 > .pin1" />`, twice.replace("y: 1 }, { x: 2, y: 1", "y: 2 }, { x: 2, y: 2")))
    expect(cornerRemoval(repeated.design, repeated.model, "wire:R1.pin2|R2.pin1#2")).toEqual({ blocked: "This wire repeats another between the same ends; change its corners in the code" })
  })
})

describe("the wire's net", () => {
  test("is the net's id in the circuit, for a hand-drawn wire and one Studio draws", () => {
    expect(wireNet(design, "wire:net.VCC|R4.pin1")).toBe("net.VCC")
    expect(wireNet(design, "wire:net.GND:1")).toBe("net.GND")
    expect(wireNet(design, "wire:nothing")).toBeUndefined()
  })
})

describe("the Wire section of Properties", () => {
  const rows = (id: string) => wireProperties(design, model, id)?.rows.map((row) => [row.label, row.value])

  test("a trace: its net, its ends as written, its corners and its line", () => {
    expect(rows("wire:R3.pin1|net.VCC")).toEqual([
      ["Net", "VCC"],
      ["From", "R3.pin1"],
      ["To", "net VCC"],
      ["Corners", "1"],
      ["Kind", "Trace, line 11"],
    ])
    expect(wireProperties(design, model, "wire:R3.pin1|net.VCC")).toMatchObject({ net: "net.VCC", remove: null, removeCorners: null })
  })

  test("a wire Studio draws on its own: its pins, and why it cannot be deleted or straightened", () => {
    expect(rows("wire:net.GND:1")).toEqual([
      ["Net", "GND"],
      ["From", "R5.pin1"],
      ["To", "R6.pin1"],
      ["Corners", "0"],
      ["Kind", "Drawn by Studio on its own"],
    ])
    expect(wireProperties(design, model, "wire:net.GND:1")).toMatchObject({ net: "net.GND", remove: ENGINE, removeCorners: ENGINE })
  })

  test("the buttons' reasons follow the locks", () => {
    expect(wireReasons(design, model, "wire:R1.pin2|R2.pin1", new Set(["R1"]))).toEqual({ remove: "R1 is locked", removeCorners: "R1 is locked" })
    expect(wireReasons(design, model, "wire:R1.pin2|R2.pin1")).toEqual({ remove: null, removeCorners: null })
  })

  test("a wire no longer on the sheet has no section", () => {
    expect(wireProperties(design, model, "wire:nothing")).toBeUndefined()
  })
})
