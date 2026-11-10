import { expect, test } from "vitest"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import type { Circuit } from "../../src/engine/model.js"
import { layoutSchematic, layoutSchematicWithDiagnostics } from "../../src/engine/schematic.js"
import before from "./pre-pages-layout.json" with { type: "json" }
import { BODY } from "./pre-pages-fixture.js"

const MAIN = "main.circuit.tsx"
const noPads = { padCount: () => undefined }

function build(body: string): Circuit {
  const source = `export default () => (\n  <board width="10mm" height="10mm">\n${body}\n  </board>\n)\n`
  return elaborate(evaluateCircuit({ [MAIN]: source }, MAIN), MAIN, noPads)
}

const twoPages = [
  `<resistor name="R1" />`,
  `<resistor name="R2" />`,
  `<trace from="R1.pin1" to="net.GND" />`,
  `<trace from="R2.pin1" to="net.GND" />`,
  `<trace from="R1.pin2" to="net.SDA" />`,
  `<page name="IO">`,
  `  <resistor name="R3" />`,
  `  <resistor name="R4" />`,
  `  <trace from="R3.pin1" to="net.GND" />`,
  `  <trace from="R4.pin1" to="net.GND" />`,
  `  <trace from="R3.pin2" to="net.SDA" />`,
  `  <schematictext name="Note" x={0} y={3} text="IO" />`,
  `</page>`,
].join("\n")

test("a circuit without pages lays out exactly as before pages, on one page, Main, holding everything", () => {
  const { layout, diagnostics } = layoutSchematicWithDiagnostics(build(BODY))
  const { pages, ...rest } = layout
  expect(JSON.parse(JSON.stringify({ layout: rest, diagnostics }))).toEqual(before)
  expect(pages).toEqual([
    { name: "Main", parts: ["U1", "C1", "C2", "R1", "D1"], wires: rest.wires.map((w) => w.id), labels: rest.labels.map((l) => l.id), drawings: ["Title"], junctions: rest.junctions },
  ])
})

test("wire ids stay unique when the first page drops a wire between pins that coincide", () => {
  const coincident = [
    `<resistor name="R1" schX={0} schY={0} />`,
    `<resistor name="R2" schX={1} schY={0} />`,
    `<resistor name="R3" schX={0} schY={-2} />`,
    `<trace from="R1.pin2" to="net.GND" />`,
    `<trace from="R2.pin1" to="net.GND" />`,
    `<trace from="R3.pin1" to="net.GND" />`,
    `<page name="IO">`,
    `  <resistor name="R4" />`,
    `  <resistor name="R5" />`,
    `  <trace from="R4.pin1" to="net.GND" />`,
    `  <trace from="R5.pin1" to="net.GND" />`,
    `</page>`,
  ].join("\n")
  const layout = layoutSchematic(build(coincident))
  const [main, io] = layout.pages ?? []
  const gnd = (ids: readonly string[]) => ids.filter((id) => id.startsWith("wire:net.GND:"))
  expect(gnd(main?.wires ?? []).length).toBeLessThan(2)
  const ids = layout.wires.map((w) => w.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(gnd(io?.wires ?? []).every((id) => !(main?.wires ?? []).includes(id))).toBe(true)
})

test("each page is laid out on its own: the parts of one page are placed as if the others were not there", () => {
  const paged = layoutSchematic(build(twoPages))
  const io = layoutSchematic(build(twoPages.split("\n").filter((line) => line.startsWith("  ")).join("\n")))
  const at = (layout: typeof paged, id: string) => layout.symbols.find((s) => s.component === id)
  expect([at(paged, "R3")?.x, at(paged, "R3")?.y]).toEqual([at(io, "R3")?.x, at(io, "R3")?.y])
  expect([at(paged, "R1")?.x, at(paged, "R1")?.y]).toEqual([at(paged, "R3")?.x, at(paged, "R3")?.y])
  expect(paged.pages?.map((p) => [p.name, p.parts, p.drawings])).toEqual([
    ["Main", ["R1", "R2"], []],
    ["IO", ["R3", "R4"], ["Note"]],
  ])
})

test("wires and labels belong to one page each, and their ids stay unique", () => {
  const layout = layoutSchematic(build(twoPages))
  const [main, io] = layout.pages ?? []
  const all = [...(main?.wires ?? []), ...(io?.wires ?? [])]
  expect(new Set(all).size).toBe(all.length)
  expect(all.sort()).toEqual(layout.wires.map((w) => w.id).sort())
  expect(new Set(layout.labels.map((l) => l.id)).size).toBe(layout.labels.length)
  const pinsOf = (ids: readonly string[]) => layout.wires.filter((w) => ids.includes(w.id)).map((w) => w.net)
  expect(pinsOf(main?.wires ?? []).every((net) => net === "net.GND")).toBe(true)
  expect(pinsOf(io?.wires ?? []).every((net) => net === "net.GND")).toBe(true)
})

test("a named net on two pages gets a label on each, even with one pin there", () => {
  const layout = layoutSchematic(build(twoPages))
  const sda = layout.labels.filter((l) => l.net === "net.SDA")
  expect(sda.map((l) => l.text)).toEqual(["SDA", "SDA"])
  const [main, io] = layout.pages ?? []
  expect(sda.filter((l) => main?.labels.includes(l.id))).toHaveLength(1)
  expect(sda.filter((l) => io?.labels.includes(l.id))).toHaveLength(1)
})

test("a net on one page with one pin still gets no label", () => {
  const layout = layoutSchematic(build(`<resistor name="R1" />\n<trace from="R1.pin2" to="net.SDA" />`))
  expect(layout.labels.filter((l) => l.net === "net.SDA")).toEqual([])
})

test("a trace between pins on two pages is not drawn and is warned about", () => {
  const circuit = build([`<resistor name="R1" />`, `<page name="IO"><resistor name="R2" /></page>`, `<trace from="R1.pin1" to="R2.pin1" />`].join("\n"))
  const { layout, diagnostics } = layoutSchematicWithDiagnostics(circuit)
  expect(layout.wires).toEqual([])
  expect(diagnostics.map((d) => [d.code, d.severity, d.items])).toEqual([["trace-across-pages", "warning", ["R1.pin1", "R2.pin1"]]])
})

test("the design carries the pages of its schematic", async () => {
  const { buildDesign } = await import("../../src/engine/design.js")
  const source = `export default () => (\n  <board width="10mm" height="10mm">\n${twoPages}\n  </board>\n)\n`
  const design = buildDesign({ [MAIN]: source }, MAIN)
  expect(design.schematic.pages?.map((p) => p.name)).toEqual(["Main", "IO"])
  expect(design.circuit.pages).toEqual(["Main", "IO"])
})
