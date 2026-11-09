import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { busMembers, drawingBounds, drawingTag } from "../../src/engine/drawing-kinds.js"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import type { Circuit, DrawingKind } from "../../src/engine/model.js"
import { layoutSchematic } from "../../src/engine/schematic.js"
import { parseSelector } from "../../src/engine/selectors.js"

const MAIN = "main.circuit.tsx"
const noPads = { padCount: () => undefined }
const wrap = (body: string) => `export default () => (\n  <board width="10mm" height="10mm">\n${body}\n  </board>\n)\n`

function build(body: string): Circuit {
  return elaborate(evaluateCircuit({ [MAIN]: wrap(body) }, MAIN), MAIN, noPads)
}

/** The drawings without their source refs, which other tests cover. */
const shapes = (circuit: Circuit) => circuit.drawings.map(({ source: _source, ...rest }) => rest)
const NONE = { x: 0, y: 0 }
const SOLID = { strokeWidth: 0.01, lineStyle: "solid" }

describe("each tag is read", () => {
  test("a polyline with every shared prop", () => {
    const circuit = build(`<schematicpath name="G1" points={[{ x: 0, y: 0 }, { x: 1, y: 0.5 }, { x: 1, y: 2 }]} strokeWidth={0.02} lineStyle="dashed" color="#112233" />`)
    expect(circuit.diagnostics).toEqual([])
    expect(shapes(circuit)).toEqual([
      {
        id: "G1",
        name: "G1",
        kind: "path",
        points: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }, { x: 1, y: 2 }],
        strokeWidth: 0.02,
        lineStyle: "dashed",
        color: "#112233",
        groupOffset: NONE,
      },
    ])
  })

  test("a rectangle by its lower-left corner", () => {
    const circuit = build(`<schematicrect name="G2" x={1} y={-2} width={3} height={1.5} filled lineStyle="dotted" />`)
    expect(circuit.diagnostics).toEqual([])
    expect(shapes(circuit)).toEqual([
      { id: "G2", name: "G2", kind: "rect", x: 1, y: -2, width: 3, height: 1.5, filled: true, strokeWidth: 0.01, lineStyle: "dotted", groupOffset: NONE },
    ])
  })

  test("a circle", () => {
    const circuit = build(`<schematiccircle name="G3" x={2} y={3} radius={0.5} color="#AbCdEf" />`)
    expect(circuit.diagnostics).toEqual([])
    expect(shapes(circuit)).toEqual([
      { id: "G3", name: "G3", kind: "circle", x: 2, y: 3, radius: 0.5, filled: false, ...SOLID, color: "#AbCdEf", groupOffset: NONE },
    ])
  })

  test("an arc keeps its angles as written", () => {
    const circuit = build(`<schematicarc name="G4" x={0} y={0} radius={1} startAngle={-90} endAngle={360} />`)
    expect(circuit.diagnostics).toEqual([])
    expect(shapes(circuit)).toEqual([{ id: "G4", name: "G4", kind: "arc", x: 0, y: 0, radius: 1, startAngle: -90, endAngle: 360, ...SOLID, groupOffset: NONE }])
  })

  test("a text, which has a colour but no line", () => {
    const circuit = build(`<schematictext name="G5" x={1} y={1} text="Power in" fontSize={0.2} anchor="center" color="#800000" />`)
    expect(circuit.diagnostics).toEqual([])
    expect(shapes(circuit)).toEqual([
      { id: "G5", name: "G5", kind: "text", x: 1, y: 1, text: "Power in", fontSize: 0.2, anchor: "center", color: "#800000", groupOffset: NONE },
    ])
  })

  test("a bus is named by its name and lists its members", () => {
    const circuit = build(`<bus name="D[0:3]" points={[{ x: 0, y: 0 }, { x: 4, y: 0 }]} />`)
    expect(circuit.diagnostics).toEqual([])
    expect(shapes(circuit)).toEqual([
      { id: "D[0:3]", name: "D[0:3]", kind: "bus", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }], members: ["D0", "D1", "D2", "D3"], groupOffset: NONE },
    ])
  })

  test("each drawing keeps where it is written", () => {
    const circuit = build(`<schematiccircle radius={1} />`)
    expect(circuit.drawings[0]?.source).toMatchObject({ file: MAIN, line: 3 })
  })
})

describe("defaults and ids", () => {
  test("optional props take their defaults and no colour is set", () => {
    const circuit = build(`<schematicrect width={1} height={1} />\n<schematictext text="A" />`)
    expect(circuit.diagnostics).toEqual([])
    const [rect, text] = shapes(circuit)
    expect(rect).toEqual({ id: "drawing:rect:1", kind: "rect", x: 0, y: 0, width: 1, height: 1, filled: false, ...SOLID, groupOffset: NONE })
    expect(text).toEqual({ id: "drawing:text:1", kind: "text", x: 0, y: 0, text: "A", fontSize: 0.1, anchor: "left", groupOffset: NONE })
    expect(rect).not.toHaveProperty("name")
  })

  test("an unnamed drawing gets its kind and its place among that kind's tags", () => {
    const rect = (name = "") => `<schematicrect${name && ` name="${name}"`} width={1} height={1} />`
    const circuit = build([rect(), `<schematiccircle radius={1} />`, rect("Box"), rect()].join("\n"))
    expect(circuit.drawings.map((d) => d.id)).toEqual(["drawing:rect:1", "drawing:circle:1", "Box", "drawing:rect:3"])
  })

  test("a repeated name gets a numbered id and one warning; parts keep their names", () => {
    const circuit = build(
      [
        `<schematicrect name="G1" width={1} height={1} />`,
        `<schematiccircle name="G1" radius={1} />`,
        `<schematiccircle name="G1" radius={2} />`,
        `<schematictext name="R1" text="x" />`,
        `<resistor name="R1" />`,
      ].join("\n"),
    )
    expect(circuit.components.map((c) => c.id)).toEqual(["R1"])
    expect(circuit.drawings.map((d) => [d.id, d.name])).toEqual([
      ["G1", "G1"],
      ["G1~2", "G1"],
      ["G1~3", "G1"],
      ["R1~2", "R1"],
    ])
    expect(circuit.diagnostics).toMatchObject([
      { code: "duplicate-name", severity: "warning", items: ["G1"], message: "More than one part or drawing is named G1" },
      { code: "duplicate-name", severity: "warning", items: ["R1"] },
    ])
  })

  test("a bus may repeat its name, as one bus drawn in pieces; its ids stay unique by order", () => {
    const piece = (y: number) => `<bus name="D[0:7]" points={[{ x: 0, y: ${y} }, { x: 4, y: ${y} }]} />`
    const circuit = build([piece(0), piece(1), piece(2)].join("\n"))
    expect(circuit.diagnostics).toEqual([])
    expect(circuit.drawings.map((d) => [d.id, d.name])).toEqual([
      ["D[0:7]", "D[0:7]"],
      ["D[0:7]~2", "D[0:7]"],
      ["D[0:7]~3", "D[0:7]"],
    ])
  })

  test("a bus named like a part or another drawing still warns", () => {
    const bus = `<bus name="CLK" points={[{ x: 0, y: 0 }, { x: 4, y: 0 }]} />`
    const afterText = build(`<schematictext name="CLK" text="x" />\n${bus}`)
    expect(afterText.drawings.map((d) => d.id)).toEqual(["CLK", "CLK~2"])
    expect(afterText.diagnostics).toMatchObject([{ code: "duplicate-name", items: ["CLK"] }])
    const afterPart = build(`<resistor name="CLK" />\n${bus}\n${bus}`)
    expect(afterPart.drawings.map((d) => d.id)).toEqual(["CLK~2", "CLK~3"])
    expect(afterPart.diagnostics).toMatchObject([{ code: "duplicate-name", items: ["CLK"] }])
  })

  test("the tag of each kind", () => {
    const kinds: DrawingKind[] = ["path", "rect", "circle", "arc", "text", "bus"]
    expect(kinds.map(drawingTag)).toEqual([
      "schematicpath",
      "schematicrect",
      "schematiccircle",
      "schematicarc",
      "schematictext",
      "bus",
    ])
  })
})

describe("bus members", () => {
  test("a range counts either way and a plain name is one member", () => {
    expect(busMembers("D[0:7]")).toEqual(["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"])
    expect(busMembers("A[3:0]")).toEqual(["A3", "A2", "A1", "A0"])
    expect(busMembers("CLK")).toEqual(["CLK"])
    expect(busMembers("ADDR_HI[2:2]")).toEqual(["ADDR_HI2"])
  })

  test("anything else is unreadable", () => {
    for (const name of ["D[0:", "D[0:7", "D[a:b]", "D[3]", "[0:7]", "D[0:7]x", "two words", "", "D[0:5000]"]) expect(busMembers(name)).toBeUndefined()
  })

  test("names take the punctuation net names take: underscore and hyphen", () => {
    expect(busMembers("V_3V3-SW")).toEqual(["V_3V3-SW"])
    expect(busMembers("A_B-C[1:0]")).toEqual(["A_B-C1", "A_B-C0"])
    expect(busMembers("_")).toEqual(["_"])
    expect(busMembers("-")).toEqual(["-"])
  })

  test("a plain bus name is readable exactly when net.<name> is a net", () => {
    const samples = ["GND", "V_3V3-SW", "_", "-", "3V3", "V+", "A.B", "A/B", "A:B", "A#1", "Ä", "A B", " A", "A\t", ""]
    for (const name of samples) {
      const parsed = parseSelector(`net.${name}`)
      const isNet = parsed?.kind === "net" && parsed.name === name
      expect([name, busMembers(name) !== undefined]).toEqual([name, isNet])
    }
    for (const member of busMembers("A_B-C[0:3]") ?? []) expect(parseSelector(`net.${member}`)).toEqual({ kind: "net", name: member })
  })
})

describe("bad values are reported and the drawing is left out", () => {
  const cases: [string, string, string][] = [
    ["a path with one point", `<schematicpath name="P" points={[{ x: 0, y: 0 }]} />`, "P.points"],
    ["a path with a point that is not one", `<schematicpath name="P" points={[{ x: 0, y: 0 }, { x: "1", y: 0 }]} />`, "P.points"],
    ["a path without points", `<schematicpath name="P" />`, "P.points"],
    ["a negative radius", `<schematiccircle name="C" radius={-1} />`, "C.radius"],
    ["a circle without a radius", `<schematiccircle name="C" />`, "C.radius"],
    ["a rectangle with no height", `<schematicrect name="B" width={1} />`, "B.height"],
    ["a rectangle with a zero width", `<schematicrect name="B" width={0} height={1} />`, "B.width"],
    ["a coordinate that is not a number", `<schematicrect name="B" x="1mm" width={1} height={1} />`, "B.x"],
    ["an arc without its end angle", `<schematicarc name="A" radius={1} startAngle={0} />`, "A.endAngle"],
    ["a colour that is not one", `<schematiccircle name="C" radius={1} color="red" />`, "C.color"],
    ["a short colour", `<schematiccircle name="C" radius={1} color="#fff" />`, "C.color"],
    ["an unknown line style", `<schematiccircle name="C" radius={1} lineStyle="wavy" />`, "C.lineStyle"],
    ["a negative stroke width", `<schematiccircle name="C" radius={1} strokeWidth={-0.01} />`, "C.strokeWidth"],
    ["a fill that is not true or false", `<schematiccircle name="C" radius={1} filled="yes" />`, "C.filled"],
    ["an unknown anchor", `<schematictext name="T" text="x" anchor="top" />`, "T.anchor"],
    ["a text with no text", `<schematictext name="T" />`, "T.text"],
    ["a font size of zero", `<schematictext name="T" text="x" fontSize={0} />`, "T.fontSize"],
    ["a name that is not a string", `<schematiccircle name={5} radius={1} />`, "drawing:circle:1.name"],
    ["a bus with no name", `<bus points={[{ x: 0, y: 0 }, { x: 1, y: 0 }]} />`, "drawing:bus:1.name"],
    ["a bus with an unreadable range", `<bus name="D[0:" points={[{ x: 0, y: 0 }, { x: 1, y: 0 }]} />`, "drawing:bus:1.name"],
    ["a bus with one point", `<bus name="CLK" points={[{ x: 0, y: 0 }]} />`, "CLK.points"],
  ]

  test.each(cases)("%s", (_, body, item) => {
    const circuit = build(body)
    expect(circuit.drawings).toEqual([])
    expect(circuit.diagnostics).toMatchObject([{ code: "bad-value", severity: "warning", items: [item] }])
    expect(circuit.diagnostics[0]?.message).toMatch(/the drawing is left out$/)
    expect(circuit.diagnostics[0]?.source).toMatchObject({ file: MAIN, line: 3 })
  })

  test("the messages say what is wanted", () => {
    const messages = (body: string) => build(body).diagnostics.map((d) => d.message)
    expect(messages(`<schematiccircle name="C" radius={-1} />`)).toEqual(["C: radius must be a number greater than 0; the drawing is left out"])
    expect(messages(`<schematiccircle name="C" />`)).toEqual(["C needs radius; the drawing is left out"])
    expect(messages(`<schematiccircle name="C" radius={1} color="red" />`)).toEqual(['C: color must be a colour such as "#000080"; the drawing is left out'])
    expect(messages(`<bus name="D[0:" points={[{ x: 0, y: 0 }, { x: 1, y: 0 }]} />`)).toEqual([
      'drawing:bus:1: name must be a net name such as "CLK" or a range such as "D[0:7]"; the drawing is left out',
    ])
  })

  test("a bad drawing still counts for the ids after it", () => {
    const circuit = build(`<schematicrect width={-1} height={1} />\n<schematicrect width={1} height={1} />`)
    expect(circuit.drawings.map((d) => d.id)).toEqual(["drawing:rect:2"])
  })
})

describe("unknown props", () => {
  test("are reported and the drawing is kept", () => {
    const circuit = build(`<schematicrect name="B" width={1} height={1} foo={1} />\n<schematicpath points={[{ x: 0, y: 0 }, { x: 1, y: 0 }]} filled />`)
    expect(circuit.drawings.map((d) => d.id)).toEqual(["B", "drawing:path:1"])
    expect(circuit.diagnostics).toMatchObject([
      { code: "unknown-prop", severity: "warning", items: ["B.foo"], message: "B: <schematicrect> has no prop foo" },
      { code: "unknown-prop", severity: "warning", items: ["drawing:path:1.filled"] },
    ])
  })

  test("a bus takes only a name and points", () => {
    const circuit = build(`<bus name="CLK" points={[{ x: 0, y: 0 }, { x: 1, y: 0 }]} strokeWidth={0.1} />`)
    expect(circuit.drawings).toHaveLength(1)
    expect(circuit.diagnostics).toMatchObject([{ code: "unknown-prop", items: ["CLK.strokeWidth"] }])
  })

  test("a text takes a colour but no line width or line style", () => {
    const circuit = build(`<schematictext name="T" text="x" color="#000080" strokeWidth={0.02} lineStyle="dashed" />`)
    expect(shapes(circuit)).toEqual([{ id: "T", name: "T", kind: "text", x: 0, y: 0, text: "x", fontSize: 0.1, anchor: "left", color: "#000080", groupOffset: NONE }])
    expect(circuit.diagnostics).toMatchObject([
      { code: "unknown-prop", severity: "warning", items: ["T.strokeWidth"], message: "T: <schematictext> has no prop strokeWidth" },
      { code: "unknown-prop", severity: "warning", items: ["T.lineStyle"] },
    ])
  })
})

describe("children", () => {
  test("inside a drawing tag are reported and ignored; the drawing is kept", () => {
    const circuit = build(`<schematicrect name="B" width={1} height={1}>\n<resistor name="R5" />\n</schematicrect>`)
    expect(circuit.drawings.map((d) => d.id)).toEqual(["B"])
    expect(circuit.components).toEqual([])
    expect(circuit.diagnostics).toMatchObject([
      { code: "unknown-prop", severity: "warning", items: ["B.children"], message: "B: <schematicrect> takes no children; they are ignored" },
    ])
    expect(circuit.diagnostics[0]?.source).toMatchObject({ file: MAIN, line: 3 })
  })

  test("text written between the tags is a child too", () => {
    const circuit = build(`<schematictext text="x">Hello</schematictext>`)
    expect(circuit.drawings).toHaveLength(1)
    expect(circuit.diagnostics).toMatchObject([{ code: "unknown-prop", items: ["drawing:text:1.children"] }])
  })

  test("are reported for a drawing that is left out as well", () => {
    const circuit = build(`<schematiccircle name="C">\n<schematicrect width={1} height={1} />\n</schematiccircle>`)
    expect(circuit.drawings).toEqual([])
    expect(circuit.diagnostics.map((d) => [d.code, d.items])).toEqual([
      ["bad-value", ["C.radius"]],
      ["unknown-prop", ["C.children"]],
    ])
  })
})

describe("groups", () => {
  test("a group's schematic offset moves drawings and is recorded; its PCB offset does not", () => {
    const circuit = build(
      [
        `<group schX={1} schY={2} pcbX={10}>`,
        `<group schX={0.5}>`,
        `<schematicrect name="B" x={1} y={1} width={1} height={1} />`,
        `<schematicpath name="P" points={[{ x: 0, y: 0 }, { x: 1, y: -1 }]} />`,
        `<bus name="CLK" points={[{ x: 0, y: 0 }, { x: 0, y: 1 }]} />`,
        `<schematiccircle name="C1" x={-1} y={0.5} radius={0.25} />`,
        `<schematicarc name="A1" x={2} y={-2} radius={1} startAngle={0} endAngle={90} />`,
        `</group>`,
        `<schematictext name="T" x={-1} y={0} text="x" />`,
        `</group>`,
        `<schematiccircle name="C" x={1} y={1} radius={1} />`,
      ].join("\n"),
    )
    const byId = new Map(circuit.drawings.map((d) => [d.id, d]))
    expect(byId.get("B")).toMatchObject({ x: 2.5, y: 3, width: 1, height: 1, groupOffset: { x: 1.5, y: 2 } })
    expect(byId.get("P")).toMatchObject({ points: [{ x: 1.5, y: 2 }, { x: 2.5, y: 1 }], groupOffset: { x: 1.5, y: 2 } })
    expect(byId.get("CLK")).toMatchObject({ points: [{ x: 1.5, y: 2 }, { x: 1.5, y: 3 }] })
    expect(byId.get("C1")).toMatchObject({ x: 0.5, y: 2.5, radius: 0.25, groupOffset: { x: 1.5, y: 2 } })
    expect(byId.get("A1")).toMatchObject({ x: 3.5, y: 0, radius: 1, startAngle: 0, endAngle: 90, groupOffset: { x: 1.5, y: 2 } })
    expect(byId.get("T")).toMatchObject({ x: 0, y: 2, groupOffset: { x: 1, y: 2 } })
    expect(byId.get("C")).toMatchObject({ x: 1, y: 1, groupOffset: NONE })
  })
})

describe("schematic only", () => {
  const body = [
    `<resistor name="R1" footprint="0402" schX={0} schY={0} />`,
    `<schematicrect name="B" x={1} y={1} width={1} height={1} />`,
    `<bus name="D[0:1]" points={[{ x: 0, y: 0 }, { x: 0, y: 2 }]} />`,
  ].join("\n")

  test("the layout carries the drawings in sheet coordinates", () => {
    const circuit = build(`<group schX={2}>\n${body}\n</group>`)
    const layout = layoutSchematic(circuit)
    expect(layout.drawings).toEqual(circuit.drawings)
    expect(layout.drawings).not.toBe(circuit.drawings)
    expect(layout.drawings.map((d) => d.id)).toEqual(["B", "D[0:1]"])
    expect(layout.drawings[0]).toMatchObject({ x: 3, y: 1 })
  })

  test("a bus joins no nets, and nothing reaches the board", () => {
    const design = buildDesign({ [MAIN]: wrap(body) }, MAIN)
    expect(design.diagnostics).toEqual([])
    expect(design.circuit.nets).toEqual([])
    expect(design.pcb.parts.map((p) => p.component)).toEqual(["R1"])
    expect(design.schematic.drawings).toHaveLength(2)
    expect(structuredClone(design)).toEqual(design)
  })
})

describe("drawingBounds", () => {
  const at = { id: "x", groupOffset: NONE, source: { file: MAIN, line: 1, column: 1, offset: 0 } }
  const stroke = { strokeWidth: 0.01, lineStyle: "solid" } as const

  test("paths and buses by their points, rectangles by their corners, circles by their radius", () => {
    expect(drawingBounds({ ...at, kind: "path", points: [{ x: 1, y: 2 }, { x: -1, y: 5 }], ...stroke })).toEqual({ minX: -1, minY: 2, maxX: 1, maxY: 5 })
    expect(drawingBounds({ ...at, kind: "bus", name: "CLK", members: ["CLK"], points: [{ x: 0, y: 0 }, { x: 3, y: 0 }] })).toEqual({ minX: 0, minY: 0, maxX: 3, maxY: 0 })
    expect(drawingBounds({ ...at, kind: "rect", x: 1, y: 2, width: 3, height: 4, filled: false, ...stroke })).toEqual({ minX: 1, minY: 2, maxX: 4, maxY: 6 })
    expect(drawingBounds({ ...at, kind: "circle", x: 1, y: 1, radius: 2, filled: false, ...stroke })).toEqual({ minX: -1, minY: -1, maxX: 3, maxY: 3 })
  })

  test("an arc by its ends and the quarter points it sweeps through", () => {
    const arc = (startAngle: number, endAngle: number) => drawingBounds({ ...at, kind: "arc", x: 0, y: 0, radius: 1, startAngle, endAngle, ...stroke })
    expect(arc(0, 90)).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 })
    expect(arc(-45, 45)).toEqual({ minX: 0.707107, minY: -0.707107, maxX: 1, maxY: 0.707107 })
    expect(arc(90, 0)).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 })
    expect(arc(0, 360)).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 })
    expect(arc(180, 270)).toEqual({ minX: -1, minY: -1, maxX: 0, maxY: 0 })
  })

  test("a text by its anchor, with y at the middle of its height", () => {
    const text = (anchor: "left" | "center" | "right") => drawingBounds({ ...at, kind: "text", x: 1, y: 1, text: "ABCD", fontSize: 0.5, anchor })
    expect(text("left")).toEqual({ minX: 1, minY: 0.75, maxX: 2.2, maxY: 1.25 })
    expect(text("center")).toEqual({ minX: 0.4, minY: 0.75, maxX: 1.6, maxY: 1.25 })
    expect(text("right")).toEqual({ minX: -0.2, minY: 0.75, maxX: 1, maxY: 1.25 })
  })
})
