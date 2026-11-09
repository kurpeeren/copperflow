import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { elaborate } from "../src/engine/elaborate.js"
import { evaluateCircuit } from "../src/engine/evaluate.js"
import { DRAWINGS } from "./fixtures.js"

const wrap = (body: string) => `export default () => (\n  <board width="10mm" height="10mm">\n${body}\n  </board>\n)\n`
const LINE = "points={[{ x: 0, y: 0 }, { x: 1, y: 0 }]}"
const UNSURE = "its id depends on an earlier drawing made in a callback or with a computed name"

describe("drawings in the scan", () => {
  const model = analyzeCircuit(DRAWINGS)
  const drawing = (id: string) => model.drawings.find((d) => d.id === id)

  test("are listed apart from parts, by the engine's ids", () => {
    expect(model.parts.map((p) => p.name)).toEqual(["R1"])
    expect(model.skipped).toEqual([])
    expect(model.drawings.map((d) => [d.id, d.tag, d.line])).toEqual([
      ["G1", "schematicrect", 4],
      ["drawing:path:1", "schematicpath", 5],
      ["drawing:path:2", "schematicpath", 6],
      ["D[0:7]", "bus", 7],
      ["D[0:7]~2", "bus", 8],
      ["G2", "schematictext", 9],
    ])
  })

  test("keep their name, literal props and points", () => {
    expect(drawing("G1")).toMatchObject({ name: "G1", editable: true })
    expect(drawing("G1")?.props).not.toHaveProperty("name")
    expect(drawing("G1")?.props.x).toEqual({ literal: 1, source: "{1}", editable: true })
    expect(drawing("D[0:7]~2")).toMatchObject({ name: "D[0:7]", points: [{ x: 4, y: 3 }, { x: 4, y: 5 }] })
    expect(drawing("drawing:path:1")).not.toHaveProperty("name")
    expect(drawing("drawing:path:1")?.props.points).toMatchObject({ editable: true, source: "{[{ x: 0, y: 0 }, { x: 1, y: 0 }]}" })
  })

  test("mark a prop written as an expression read-only, not the drawing", () => {
    expect(drawing("G2")).toMatchObject({ editable: true })
    expect(drawing("G2")?.props.x).toEqual({ literal: undefined, source: "{1 + 1}", editable: false })
    const pointsByName = analyzeCircuit(`<board><schematicpath name="P" points={corners} /></board>`).drawings[0]
    expect(pointsByName?.props.points).toMatchObject({ editable: false, source: "{corners}" })
    expect(pointsByName).not.toHaveProperty("points")
  })

  test("have the ids the engine gives them", () => {
    const body = [
      `<resistor name="R1" />`,
      `<group name="G9" schX={1}>`,
      `  <schematicrect name="G9" width={1} height={1} />`,
      `</group>`,
      `<schematicrect width={1} height={1} />`,
      `<schematiccircle name="G1" radius={-1} />`,
      `<schematiccircle name="G1" radius={1} />`,
      `<schematictext name="R1" text="x" />`,
      `<bus name="D[0:3]" ${LINE} />`,
      `<bus name="D[0:3]" ${LINE} />`,
      `<bus name="D[3]" ${LINE} />`,
      `<schematicrect width={1} height={1} />`,
    ].join("\n")
    const text = wrap(body)
    const circuit = elaborate(evaluateCircuit({ "main.circuit.tsx": text }, "main.circuit.tsx"), "main.circuit.tsx", { padCount: () => undefined })
    expect(circuit.drawings.map((d) => d.id)).toEqual(["G9", "drawing:rect:2", "G1~2", "R1~2", "D[0:3]", "D[0:3]~2", "drawing:rect:3"])
    const core = new Map(analyzeCircuit(text).drawings.map((d) => [d.line, d.id]))
    expect(circuit.drawings.map((d) => [d.id, core.get(d.source.line)])).toEqual(circuit.drawings.map((d) => [d.id, d.id]))
  })
})

test("a drawing named like a component gives way to it; a group's name is no part's", () => {
  const body = [
    `<MyChip name="U1" />`,
    `<lib.Part name="U2" />`,
    `<group name="G9" />`,
    `<schematictext name="U1" text="a" />`,
    `<schematictext name="U2" text="b" />`,
    `<schematictext name="G9" text="c" />`,
  ].join("\n")
  expect(analyzeCircuit(wrap(body)).drawings.map((d) => d.id)).toEqual(["U1~2", "U2~2", "G9"])
})

describe("drawings whose ids the file alone cannot tell", () => {
  test("a drawing made in a callback is read-only, and so are the unnamed ones of its kind after it", () => {
    const model = analyzeCircuit(
      wrap(
        [
          `{[1, 2].map((i) => <schematictext text="n" x={i} />)}`,
          `<schematictext text="a" />`,
          `<schematictext name="T" text="b" />`,
          `<schematicrect width={1} height={1} />`,
        ].join("\n"),
      ),
    )
    expect(model.drawings.map((d) => [d.id, d.readonlyReason])).toEqual([
      ["drawing:text:1", "inside a callback such as .map()"],
      ["drawing:text:2", UNSURE],
      ["T", undefined],
      ["drawing:rect:1", undefined],
    ])
  })

  test("a name used in a callback makes later drawings of that name read-only", () => {
    const model = analyzeCircuit(
      wrap(
        [
          `{[1, 2].map((i) => <schematicrect name="B" width={i} height={1} />)}`,
          `{[1, 2].map((i) => <resistor name="R7" />)}`,
          `<schematicrect name="B" width={1} height={1} />`,
          `<schematictext name="R7" text="x" />`,
          `<schematiccircle name="C" radius={1} />`,
        ].join("\n"),
      ),
    )
    expect(model.drawings.map((d) => [d.id, d.editable])).toEqual([
      ["B", false],
      ["B~2", false],
      ["R7~2", false],
      ["C", true],
    ])
  })

  test("a computed name is skipped and makes every later named drawing read-only", () => {
    const model = analyzeCircuit(
      wrap([`<schematicrect name={"G" + 1} width={1} height={1} />`, `<schematicrect width={1} height={1} />`, `<schematiccircle name="G1" radius={1} />`].join("\n")),
    )
    expect(model.skipped).toEqual([{ tag: "schematicrect", line: 3, reason: "name is not a string literal" }])
    expect(model.drawings.map((d) => [d.id, d.readonlyReason])).toEqual([
      ["drawing:rect:2", undefined],
      ["G1", UNSURE],
    ])
  })

  test("spread props may carry a name, so they count as a computed one", () => {
    const model = analyzeCircuit(wrap([`<schematicrect {...box} />`, `<schematiccircle name="C" radius={1} />`].join("\n")))
    expect(model.drawings.map((d) => [d.id, d.readonlyReason])).toEqual([
      ["drawing:rect:1", "uses spread props"],
      ["C", UNSURE],
    ])
  })
})
