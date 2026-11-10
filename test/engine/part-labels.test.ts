import { describe, expect, test } from "vitest"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import type { Circuit } from "../../src/engine/model.js"
import { partLabels } from "../../src/engine/part-labels.js"
import { layoutPcb } from "../../src/engine/pcb.js"
import { layoutSchematic } from "../../src/engine/schematic.js"

const MAIN = "main.circuit.tsx"
const noPads = { padCount: () => undefined }

function build(body: string): Circuit {
  const source = `export default () => (\n  <board width="10mm" height="10mm">\n${body}\n  </board>\n)\n`
  return elaborate(evaluateCircuit({ [MAIN]: source }, MAIN), MAIN, noPads)
}

const symbolOf = (circuit: Circuit, name: string) => {
  const placed = layoutSchematic(circuit).symbols.find((s) => s.component === name)
  if (!placed) throw new Error(`no symbol ${name}`)
  return placed
}

const labelsOf = (circuit: Circuit, name: string) => partLabels(symbolOf(circuit, name))

describe("schematic name and value", () => {
  test("without the props they sit where they always did: the name above the body, the value below", () => {
    const [name, value] = labelsOf(build(`<resistor name="R1" resistance="10k" schX={1} schY={2} />`), "R1")
    expect(name).toMatchObject({ id: "R1:schNameAt", part: "R1", prop: "schNameAt", text: "R1" })
    expect(value).toMatchObject({ id: "R1:schValueAt", part: "R1", prop: "schValueAt", text: "10k" })
    expect(name?.at.y).toBeGreaterThan(2)
    expect(value?.at.y).toBeLessThan(2)
    expect(name?.offset.x).toBeCloseTo((name?.at.x ?? 0) - 1, 9)
    expect(name?.offset.y).toBeCloseTo((name?.at.y ?? 0) - 2, 9)
  })

  test("schNameAt and schValueAt put them at that offset from the symbol's origin", () => {
    const circuit = build(`<resistor name="R1" resistance="10k" schX={1} schY={2} schNameAt={{ x: 0.5, y: -0.3 }} schValueAt={{ x: -1, y: 0.4 }} />`)
    const [name, value] = labelsOf(circuit, "R1")
    expect(name?.at).toEqual({ x: 1.5, y: 1.7 })
    expect(name?.offset).toEqual({ x: 0.5, y: -0.3 })
    expect(value?.at).toEqual({ x: 0, y: 2.4 })
  })

  test("the offset is on the sheet: a turned symbol keeps it as written", () => {
    const circuit = build(`<resistor name="R1" schX={1} schY={2} schRotation={90} schNameAt={{ x: 0.5, y: -0.3 }} />`)
    expect(labelsOf(circuit, "R1")[0]?.at).toEqual({ x: 1.5, y: 1.7 })
  })

  test("a moved part takes its labels along: the offset is relative", () => {
    const prop = ` schNameAt={{ x: 0.5, y: -0.3 }}`
    const before = labelsOf(build(`<resistor name="R1" schX={1} schY={2}${prop} />`), "R1")[0]
    const after = labelsOf(build(`<resistor name="R1" schX={4} schY={-1}${prop} />`), "R1")[0]
    expect(before?.offset).toEqual(after?.offset)
    expect(after?.at).toEqual({ x: 4.5, y: -1.3 })
  })

  test("moving a label changes neither the symbol's bounds nor its wires", () => {
    const wired = (extra: string) =>
      build(`<resistor name="R1" schX={0} schY={0}${extra} />\n<resistor name="R2" schX={3} schY={0} />\n<trace from="R1.pin2" to="R2.pin1" />`)
    const plain = layoutSchematic(wired(""))
    const moved = layoutSchematic(wired(` schNameAt={{ x: 1.5, y: 0 }}`))
    expect(moved.symbols[0]?.symbol.bounds).toEqual(plain.symbols[0]?.symbol.bounds)
    expect(moved.wires).toEqual(plain.wires)
  })

  test("the label's box is around its text", () => {
    const [name] = labelsOf(build(`<resistor name="R1" schX={0} schY={0} schNameAt={{ x: 1, y: 1 }} />`), "R1")
    expect(name?.box.minX).toBeLessThan(1)
    expect(name?.box.maxX).toBeGreaterThan(1)
    expect(name?.box.minY).toBeLessThan(1)
    expect(name?.box.maxY).toBeGreaterThan(1)
  })

  test("a value that is not a point is a bad-value warning and the default stands", () => {
    const circuit = build(`<resistor name="R1" schX={0} schY={0} schNameAt="up" pcbNameAt={{ x: 1 }} />`)
    expect(circuit.diagnostics.filter((d) => d.code === "bad-value").map((d) => d.items)).toEqual([["R1.schNameAt"], ["R1.pcbNameAt"]])
    const plain = labelsOf(build(`<resistor name="R1" schX={0} schY={0} />`), "R1")
    expect(labelsOf(circuit, "R1")).toEqual(plain)
  })

  test("a part without a value has a name only", () => {
    expect(labelsOf(build(`<chip name="U1" pinCount={4} schX={0} schY={0} />`), "U1").map((l) => l.prop)).toEqual(["schNameAt"])
  })

  test("a part on a later page has its labels on that page, from its own origin", () => {
    const circuit = build(`<page name="Two">\n<resistor name="R1" schX={1} schY={1} schNameAt={{ x: 0, y: 1 }} />\n</page>`)
    const layout = layoutSchematic(circuit)
    expect(layout.pages?.find((p) => p.name === "Two")?.parts).toEqual(["R1"])
    expect(labelsOf(circuit, "R1")[0]?.at).toEqual({ x: 1, y: 2 })
  })
})

describe("silkscreen designator", () => {
  const footprintOf = () => ({ error: "none" })

  test("pcbNameAt puts it at that offset from the part's origin, in board mm", () => {
    const circuit = build(`<resistor name="R1" pcbX={3} pcbY={4} pcbRotation={90} pcbNameAt={{ x: 0, y: 2.5 }} />`)
    const [part] = layoutPcb(circuit, footprintOf).layout.parts
    expect(part?.nameAt).toEqual({ x: 3, y: 6.5 })
  })

  test("without it the part has no nameAt and is drawn as before", () => {
    const [part] = layoutPcb(build(`<resistor name="R1" pcbX={3} pcbY={4} />`), footprintOf).layout.parts
    expect(part && "nameAt" in part).toBe(false)
  })
})
