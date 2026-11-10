import { expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import type { Circuit } from "../../src/engine/model.js"

const MAIN = "main.circuit.tsx"
const SHEET = "PowerStage.sheet.tsx"
const noPads = { padCount: () => undefined }

const POWER_STAGE = `export default function PowerStage() {
  return (
    <sheet>
      <port name="VIN" />
      <port name="VOUT" />
      <port name="GND" />
      <chip name="U1" pinLabels={{ pin1: "IN", pin2: "OUT", pin3: "GND" }} pcbX={2} pcbY={1} schX={1} schY={0} />
      <capacitor name="C1" capacitance="1uF" />
      <resistor name="R1" resistance="10k" />
      <resistor name="R2" resistance="10k" />
      <trace from="U1.IN" to="net.VIN" />
      <trace from="U1.OUT" to="net.VOUT" />
      <trace from="U1.GND" to="net.GND" />
      <trace from="C1.pin1" to="net.VOUT" />
      <trace from="C1.pin2" to="net.VCC" />
      <trace from="R1.pin1" to="net.VOUT" />
      <trace from="R1.pin2" to="net.FB" />
      <trace from="R2.pin1" to="net.FB" />
      <trace from="R2.pin2" to="net.GND" />
    </sheet>
  )
}
`

function mainWith(body: string): string {
  return `import PowerStage from "./PowerStage.sheet"\nexport default () => (\n  <board width="40mm" height="40mm">\n${body}\n  </board>\n)\n`
}

const TWO = [
  `<PowerStage name="PS1" connections={{ VIN: "VBUS", VOUT: "V3_3", GND: "GND" }} schX={10} schY={0} pcbX={10} pcbY={5} />`,
  `<PowerStage name="PS2" connections={{ VIN: "V3_3", VOUT: "V1_8", GND: "GND" }} />`,
  `<resistor name="R1" />`,
  `<trace from="R1.pin1" to="net.VBUS" />`,
].join("\n")

function build(body: string, files: Record<string, string> = {}): Circuit {
  const all = { [MAIN]: mainWith(body), [SHEET]: POWER_STAGE, ...files }
  return elaborate(evaluateCircuit(all, MAIN), MAIN, noPads)
}

const part = (circuit: Circuit, id: string) => circuit.components.find((c) => c.id === id)
const net = (circuit: Circuit, name: string) => circuit.nets.find((n) => n.names.includes(name))
const codes = (circuit: Circuit) => circuit.diagnostics.map((d) => `${d.severity} ${d.code}`)

test("two instances of one sheet build with distinct designators", () => {
  const circuit = build(TWO)
  expect(circuit.components.map((c) => c.id)).toEqual(["U101", "C101", "R101", "R102", "U201", "C201", "R201", "R202", "R1"])
  expect(part(circuit, "R101")).toMatchObject({ instance: "PS1", localId: "R1" })
  expect(part(circuit, "R202")).toMatchObject({ instance: "PS2", localId: "R2" })
  expect(part(circuit, "R1")?.instance).toBeUndefined()
  expect(circuit.diagnostics).toEqual([])
})

test("local nets are kept apart per instance; ports join the parent nets", () => {
  const circuit = build(TWO)
  expect(net(circuit, "PS1/FB")?.pins).toEqual(["R101.pin2", "R102.pin1"])
  expect(net(circuit, "PS2/FB")?.pins).toEqual(["R201.pin2", "R202.pin1"])
  expect(net(circuit, "VBUS")?.pins).toEqual(["R1.pin1", "U101.pin1"])
  expect(net(circuit, "V3_3")?.pins).toEqual(["C101.pin1", "R101.pin1", "U101.pin2", "U201.pin1"])
  expect(net(circuit, "V1_8")?.pins).toEqual(["C201.pin1", "R201.pin1", "U201.pin2"])
  expect(net(circuit, "GND")?.pins).toEqual(["R102.pin2", "R202.pin2", "U101.pin3", "U201.pin3"])
  expect(circuit.nets.some((n) => n.names.some((name) => name.endsWith("/VIN") || name.endsWith("/GND")))).toBe(false)
})

test("a net under a power or ground flag inside a sheet is global", () => {
  const circuit = build(TWO)
  expect(net(circuit, "VCC")?.pins).toEqual(["C101.pin2", "C201.pin2"])
  expect(circuit.nets.some((n) => n.names.includes("PS1/VCC"))).toBe(false)
})

test("the circuit keeps each instance: sheet file, base, connections and ports with their nets", () => {
  const circuit = build(TWO)
  expect(circuit.instances).toEqual([
    {
      name: "PS1",
      path: "PS1",
      sheet: "PowerStage",
      file: SHEET,
      base: 100,
      designatorBase: 100,
      connections: { VIN: "VBUS", VOUT: "V3_3", GND: "GND" },
      ports: [
        { name: "VIN", net: "VBUS" },
        { name: "VOUT", net: "V3_3" },
        { name: "GND", net: "GND" },
      ],
      parts: ["C101", "R101", "R102", "U101"],
      sch: { x: 10, y: 0 },
      pcb: { x: 10, y: 5, rotation: 0 },
      source: expect.objectContaining({ file: MAIN, line: 4 }),
    },
    expect.objectContaining({ name: "PS2", base: 200, parts: ["C201", "R201", "R202", "U201"] }),
  ])
  expect(circuit.instances?.[1]).not.toHaveProperty("sch")
})

test("positions inside a sheet are relative to the instance", () => {
  const circuit = build(TWO)
  expect(part(circuit, "U101")?.pcb).toEqual({ x: 12, y: 6, rotation: 0, side: "top" })
  expect(part(circuit, "U101")?.sch).toEqual({ x: 11, y: 0, rotation: 0 })
  expect(part(circuit, "U101")?.groupOffset).toEqual({ pcb: { x: 10, y: 5 }, sch: { x: 10, y: 0 } })
  expect(part(circuit, "U201")?.pcb).toEqual({ x: 2, y: 1, rotation: 0, side: "top" })
})

test("an instance's pcbRotation turns its block about the instance's place", () => {
  const circuit = build(`<PowerStage name="PS1" connections={{ VIN: "A", VOUT: "B", GND: "GND" }} pcbX={10} pcbY={0} pcbRotation={90} />`)
  expect(part(circuit, "U101")?.pcb).toEqual({ x: 9, y: 2, rotation: 90, side: "top" })
  expect(circuit.instances?.[0]?.pcb).toEqual({ x: 10, y: 0, rotation: 90 })
})

test("base may be set; it replaces the default for that instance", () => {
  const circuit = build(`<PowerStage name="PS1" base={300} connections={{ VIN: "A", VOUT: "B", GND: "GND" }} />`)
  expect(circuit.components.map((c) => c.id)).toEqual(["U301", "C301", "R301", "R302"])
  expect(circuit.instances?.[0]?.base).toBe(300)
})

test("two instances with the same base are an error naming both", () => {
  const circuit = build(
    [
      `<PowerStage name="PS1" connections={{ VIN: "A", VOUT: "B", GND: "GND" }} />`,
      `<PowerStage name="PS2" base={100} connections={{ VIN: "A", VOUT: "B", GND: "GND" }} />`,
    ].join("\n"),
  )
  const clashes = circuit.diagnostics.filter((d) => d.code === "base-clash")
  expect(clashes).toHaveLength(1)
  expect(clashes[0]).toMatchObject({ severity: "error", items: ["PS1", "PS2"] })
  expect(clashes[0]?.message).toContain("base 100")
  expect(codes(circuit)).not.toContain("error duplicate-name")
})

test("an instance designator that clashes with a flat part is an error", () => {
  const circuit = build([`<resistor name="R101" />`, `<PowerStage name="PS1" connections={{ VIN: "A", VOUT: "B", GND: "GND" }} />`].join("\n"))
  const clash = circuit.diagnostics.find((d) => d.code === "base-clash")
  expect(clash).toMatchObject({ severity: "error", items: ["PS1", "R101"] })
  expect(clash?.message).toBe("R1 of PS1 becomes R101, which is already a part; give PS1 another base")
})

test("an unconnected port is a warning and its net stays local", () => {
  const circuit = build(`<PowerStage name="PS1" connections={{ VIN: "VBUS", GND: "GND" }} />`)
  expect(circuit.diagnostics).toEqual([
    expect.objectContaining({ code: "unconnected-port", severity: "warning", items: ["PS1.VOUT"], message: "Port VOUT of PS1 (PowerStage) is not connected" }),
  ])
  expect(net(circuit, "PS1/VOUT")?.pins).toEqual(["C101.pin1", "R101.pin1", "U101.pin2"])
})

test("a connection to a port the sheet has not is an error naming the sheet's ports", () => {
  const circuit = build(`<PowerStage name="PS1" connections={{ VIN: "VBUS", VOUT: "V3_3", GND: "GND", EN: "EN" }} />`)
  const unknown = circuit.diagnostics.find((d) => d.code === "unknown-port")
  expect(unknown).toMatchObject({ severity: "error", items: ["PS1.EN"] })
  expect(unknown?.message).toBe("PowerStage has no port EN (ports: GND, VIN, VOUT)")
})

test("a sheet that contains itself is an error, and the build goes on", () => {
  const loop = `import Loop from "./Loop.sheet"\nexport default function Loop() {\n  return (\n    <sheet>\n      <resistor name="R1" />\n      <Loop name="L1" />\n    </sheet>\n  )\n}\n`
  const files = { [MAIN]: `import Loop from "./Loop.sheet"\nexport default () => (<board width="10mm" height="10mm"><Loop name="X1" /></board>)\n`, "Loop.sheet.tsx": loop }
  const circuit = elaborate(evaluateCircuit(files, MAIN), MAIN, noPads)
  expect(circuit.components.map((c) => c.id)).toEqual(["R101"])
  const recursion = circuit.diagnostics.find((d) => d.code === "sheet-recursion")
  expect(recursion).toMatchObject({ severity: "error", items: ["X1/L1"] })
  expect(recursion?.message).toBe("Loop.sheet.tsx contains itself (X1/L1); a sheet cannot import itself")
})

test("sheets nest: the inner instance's base and path add to the outer's", () => {
  const inner = `export default function Divider() {\n  return (\n    <sheet>\n      <port name="IN" />\n      <resistor name="R1" />\n      <resistor name="R2" />\n      <trace from="R1.pin1" to="net.IN" />\n      <trace from="R1.pin2" to="net.MID" />\n      <trace from="R2.pin1" to="net.MID" />\n    </sheet>\n  )\n}\n`
  const outer = `import Divider from "./Divider.sheet"\nexport default function Block() {\n  return (\n    <sheet>\n      <port name="IN" />\n      <Divider name="D1" connections={{ IN: "IN" }} />\n      <Divider name="D2" connections={{ IN: "LOCAL" }} />\n    </sheet>\n  )\n}\n`
  const files = {
    [MAIN]: `import Block from "./Block.sheet"\nexport default () => (<board width="10mm" height="10mm"><Block name="B1" base={1000} connections={{ IN: "VBUS" }} /></board>)\n`,
    "Block.sheet.tsx": outer,
    "Divider.sheet.tsx": inner,
  }
  const circuit = elaborate(evaluateCircuit(files, MAIN), MAIN, noPads)
  expect(circuit.components.map((c) => [c.id, c.instance, c.localId])).toEqual([
    ["R1101", "B1/D1", "R1"],
    ["R1102", "B1/D1", "R2"],
    ["R1201", "B1/D2", "R1"],
    ["R1202", "B1/D2", "R2"],
  ])
  expect(net(circuit, "VBUS")?.pins).toEqual(["R1101.pin1"])
  expect(net(circuit, "B1/LOCAL")?.pins).toEqual(["R1201.pin1"])
  expect(net(circuit, "B1/D1/MID")?.pins).toEqual(["R1101.pin2", "R1102.pin1"])
  expect(circuit.instances?.map((i) => [i.path, i.base, i.parts.length])).toEqual([
    ["B1", 1000, 4],
    ["B1/D1", 100, 2],
    ["B1/D2", 200, 2],
  ])
})

test("an instance sits on a page like a part", () => {
  const circuit = build(`<page name="Power"><PowerStage name="PS1" connections={{ VIN: "VBUS", VOUT: "V3_3", GND: "GND" }} /></page>`)
  expect(circuit.pages).toEqual(["Main", "Power"])
  expect(circuit.components.every((c) => c.page === "Power")).toBe(true)
  expect(circuit.connections.every((c) => c.page === "Power")).toBe(true)
  expect(circuit.instances?.[0]?.page).toBe("Power")
})

test("an instance needs a name, and a sheet must return <sheet>", () => {
  const notSheet = `export default function Bad() { return <resistor name="R1" /> }\n`
  const files = {
    [MAIN]: `import Bad from "./Bad.sheet"\nimport PowerStage from "./PowerStage.sheet"\nexport default () => (<board width="10mm" height="10mm"><Bad name="B1" /><PowerStage connections={{}} /></board>)\n`,
    "Bad.sheet.tsx": notSheet,
    [SHEET]: POWER_STAGE,
  }
  const circuit = elaborate(evaluateCircuit(files, MAIN), MAIN, noPads)
  expect(circuit.components).toEqual([])
  expect(circuit.diagnostics.map((d) => [d.code, d.message])).toEqual([
    ["not-a-sheet", "Bad.sheet.tsx must return <sheet>; B1 is left out"],
    ["missing-name", "An instance of PowerStage needs a name"],
  ])
})

test("a sheet file builds alone, with its nets as written", () => {
  const circuit = elaborate(evaluateCircuit({ [SHEET]: POWER_STAGE }, SHEET), SHEET, noPads)
  expect(circuit.components.map((c) => c.id)).toEqual(["U1", "C1", "R1", "R2"])
  expect(net(circuit, "FB")?.pins).toEqual(["R1.pin2", "R2.pin1"])
  expect(circuit.diagnostics).toEqual([])
})

test("flattening is deterministic", () => {
  const files = { [MAIN]: mainWith(TWO), [SHEET]: POWER_STAGE }
  const first = JSON.stringify(buildDesign(files, MAIN))
  expect(JSON.stringify(buildDesign(files, MAIN))).toBe(first)
})

test("the design built from instances is the flat design the tools read", () => {
  const design = buildDesign({ [MAIN]: mainWith(TWO), [SHEET]: POWER_STAGE }, MAIN)
  expect(design.schematic.symbols.map((p) => p.component).sort()).toEqual(["C101", "C201", "R1", "R101", "R102", "R201", "R202", "U101", "U201"])
  expect(design.pcb.parts.map((p) => p.component)).toContain("U201")
  expect(design.diagnostics.filter((d) => d.severity === "error")).toEqual([])
})

test("a group inside a turned instance turns with it", () => {
  const block = `export default function Block() {\n  return (\n    <sheet>\n      <group pcbX={1}><resistor name="R1" pcbX={1} pcbY={0} pcbRotation={90} /></group>\n      <keepout pcbX={0} pcbY={1} width={2} height={2} />\n    </sheet>\n  )\n}\n`
  const files = {
    [MAIN]: `import Block from "./Block.sheet"\nexport default () => (<board width="20mm" height="20mm"><Block name="B1" pcbX={5} pcbY={5} pcbRotation={90} /></board>)\n`,
    "Block.sheet.tsx": block,
  }
  const circuit = elaborate(evaluateCircuit(files, MAIN), MAIN, noPads)
  expect(part(circuit, "R101")?.pcb).toEqual({ x: 5, y: 7, rotation: 180, side: "top" })
  expect(circuit.board?.keepouts[0]?.outline).toEqual([
    { x: 5, y: 4 },
    { x: 5, y: 6 },
    { x: 3, y: 6 },
    { x: 3, y: 4 },
  ])
})

const sheetOf = (name: string, body: string, imports = "") =>
  `${imports}export default function ${name}() {\n  return (\n    <sheet>\n${body}\n    </sheet>\n  )\n}\n`

function buildFiles(main: string, sheets: Record<string, string>): Circuit {
  const source = `${Object.keys(sheets).map((file) => `import ${file.replace(".sheet.tsx", "")} from "./${file.replace(".tsx", "")}"\n`).join("")}export default () => (<board width="40mm" height="40mm">${main}</board>)\n`
  return elaborate(evaluateCircuit({ [MAIN]: source, ...sheets }, MAIN), MAIN, noPads)
}

const DIVIDER = sheetOf("Divider", `<resistor name="R1" />`)
const BLOCK = sheetOf("Block", `<resistor name="R1" />\n<Divider name="D1" />`, `import Divider from "./Divider.sheet"\n`)

test("default bases never collide: each instance's sheet spans its nested instances", () => {
  const circuit = buildFiles(`<Block name="B1" /><Block name="B2" />`, { "Block.sheet.tsx": BLOCK, "Divider.sheet.tsx": DIVIDER })
  expect(circuit.components.map((c) => [c.id, c.instance])).toEqual([
    ["R101", "B1"],
    ["R201", "B1/D1"],
    ["R301", "B2"],
    ["R401", "B2/D1"],
  ])
  expect(circuit.instances?.map((i) => [i.path, i.base, i.designatorBase])).toEqual([
    ["B1", 100, 100],
    ["B1/D1", 100, 200],
    ["B2", 300, 300],
    ["B2/D1", 100, 400],
  ])
  expect(circuit.diagnostics).toEqual([])
})

test("three levels of nesting take bases that never collide", () => {
  const leaf = sheetOf("Leaf", `<resistor name="R1" />`)
  const mid = sheetOf("Mid", `<resistor name="R1" />\n<Leaf name="L1" />\n<Leaf name="L2" />`, `import Leaf from "./Leaf.sheet"\n`)
  const top = sheetOf("Top", `<resistor name="R1" />\n<Mid name="M1" />`, `import Mid from "./Mid.sheet"\n`)
  const circuit = buildFiles(`<Top name="T1" /><Top name="T2" />`, { "Top.sheet.tsx": top, "Mid.sheet.tsx": mid, "Leaf.sheet.tsx": leaf })
  expect(circuit.components.map((c) => c.id)).toEqual(["R101", "R201", "R301", "R401", "R501", "R601", "R701", "R801"])
  expect(circuit.components.map((c) => c.instance)).toEqual(["T1", "T1/M1", "T1/M1/L1", "T1/M1/L2", "T2", "T2/M1", "T2/M1/L1", "T2/M1/L2"])
  expect(circuit.diagnostics).toEqual([])
})

test("a written base leaves the defaults alone unless it reaches them; then they continue past it", () => {
  const low = buildFiles(`<Divider name="A" base={50} /><Divider name="B" />`, { "Divider.sheet.tsx": DIVIDER })
  expect(low.components.map((c) => c.id)).toEqual(["R51", "R101"])
  const high = buildFiles(`<Divider name="A" base={500} /><Divider name="B" />`, { "Divider.sheet.tsx": DIVIDER })
  expect(high.components.map((c) => c.id)).toEqual(["R501", "R601"])
})

test("two ports of one instance on one parent net are a port-short warning naming them", () => {
  const circuit = build(`<PowerStage name="PS1" connections={{ VIN: "X", VOUT: "X", GND: "GND" }} />`)
  expect(circuit.diagnostics).toEqual([
    expect.objectContaining({
      code: "port-short",
      severity: "warning",
      items: ["PS1.VIN", "PS1.VOUT"],
      message: "PS1 connects ports VIN and VOUT of PowerStage to the same net X, which joins them inside the sheet",
    }),
  ])
})

test.each([
  ["-100", "{-100}"],
  ["1.5", "{1.5}"],
  ["a string", '"100"'],
])("a base that is %s is an error and the default is used", (_label, value) => {
  const circuit = buildFiles(`<Divider name="A" base=${value} />`, { "Divider.sheet.tsx": DIVIDER })
  expect(circuit.components.map((c) => c.id)).toEqual(["R101"])
  expect(circuit.diagnostics).toEqual([expect.objectContaining({ code: "bad-value", severity: "error", items: ["A.base"] })])
})

test("two instances of one name in one parent are an error; the second gets ~2", () => {
  const circuit = buildFiles(`<Divider name="A" /><Divider name="A" />`, { "Divider.sheet.tsx": DIVIDER })
  expect(circuit.instances?.map((i) => i.path)).toEqual(["A", "A~2"])
  expect(circuit.diagnostics).toEqual([expect.objectContaining({ code: "duplicate-name", severity: "error", items: ["A"] })])
})

test("a <page> or a <board> inside a sheet is an error and what it holds stays in the instance", () => {
  const odd = sheetOf("Odd", `<page name="Power"><resistor name="R1" /></page>\n<board width="5mm" height="5mm"><resistor name="R2" /></board>`)
  const circuit = buildFiles(`<page name="IO"><Odd name="O1" /></page>`, { "Odd.sheet.tsx": odd })
  expect(circuit.components.map((c) => [c.id, c.page])).toEqual([
    ["R101", "IO"],
    ["R102", "IO"],
  ])
  expect(circuit.board?.outline).toHaveLength(4)
  expect(circuit.diagnostics.map((d) => [d.code, d.severity])).toEqual([
    ["page-in-sheet", "error"],
    ["board-in-sheet", "error"],
  ])
})

test("connections that are not an object are an error, and every port is then unconnected", () => {
  const circuit = build(`<PowerStage name="PS1" connections="VBUS" />`)
  expect(circuit.diagnostics.map((d) => [d.code, d.severity, d.items])).toEqual([
    ["bad-value", "error", ["PS1.connections"]],
    ["unconnected-port", "warning", ["PS1.VIN"]],
    ["unconnected-port", "warning", ["PS1.VOUT"]],
    ["unconnected-port", "warning", ["PS1.GND"]],
  ])
})

test("a <port> outside a sheet is a warning and joins nothing", () => {
  const circuit = build(`<port name="VIN" />`)
  expect(circuit.diagnostics).toEqual([expect.objectContaining({ code: "unsupported-element", severity: "warning", items: ["port"] })])
})

const PAIR = sheetOf(
  "Pair",
  [
    `<port name="IN" />`,
    `<resistor name="R1" resistance="1k" footprint="0402" />`,
    `<capacitor name="C1" capacitance="1uF" footprint="0402" />`,
    `<trace from="R1.pin1" to="net.IN" />`,
    `<trace from="R1.pin2" to="C1.pin1" />`,
    `<trace from="C1.pin2" to="net.GND" />`,
  ].join("\n"),
)

function designOf(main: string) {
  const source = `import Pair from "./Pair.sheet"\nexport default () => (<board width="60mm" height="60mm">${main}</board>)\n`
  return buildDesign({ [MAIN]: source, "Pair.sheet.tsx": PAIR }, MAIN)
}

type Box = { minX: number; maxX: number; minY: number; maxY: number }
const overlap = (a: Box, b: Box) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
const boxOf = (points: readonly { x: number; y: number }[]): Box => ({
  minX: Math.min(...points.map((p) => p.x)),
  maxX: Math.max(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxY: Math.max(...points.map((p) => p.y)),
})

test("an instance's unplaced parts are placed near the instance and clear of another instance's parts", () => {
  const design = designOf(
    [`<Pair name="P1" connections={{ IN: "A" }} schX={20} schY={10} pcbX={15} pcbY={15} />`, `<Pair name="P2" connections={{ IN: "B" }} schX={-20} schY={-10} pcbX={-15} pcbY={-15} />`].join(""),
  )
  const sch = new Map(design.schematic.symbols.map((s) => [s.component, s]))
  const pcb = new Map(design.pcb.parts.map((p) => [p.component, p]))
  for (const [ids, at] of [
    [["R101", "C101"], { sch: { x: 20, y: 10 }, pcb: { x: 15, y: 15 } }],
    [["R201", "C201"], { sch: { x: -20, y: -10 }, pcb: { x: -15, y: -15 } }],
  ] as const) {
    for (const id of ids) {
      const symbol = sch.get(id)
      const part = pcb.get(id)
      expect(Math.hypot((symbol?.x ?? 1e9) - at.sch.x, (symbol?.y ?? 1e9) - at.sch.y)).toBeLessThan(6)
      expect(Math.hypot((part?.x ?? 1e9) - at.pcb.x, (part?.y ?? 1e9) - at.pcb.y)).toBeLessThan(6)
    }
  }
  const courtyards = design.pcb.parts.map((p) => boxOf(p.courtyard))
  courtyards.forEach((a, i) => courtyards.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)))
})

test("an instance without a position keeps its parts together, clear of the rest", () => {
  const design = designOf([`<Pair name="P1" connections={{ IN: "A" }} />`, `<Pair name="P2" connections={{ IN: "B" }} />`, `<resistor name="R1" footprint="0402" />`].join(""))
  const sch = new Map(design.schematic.symbols.map((s) => [s.component, s]))
  const pcb = new Map(design.pcb.parts.map((p) => [p.component, p]))
  for (const [a, b] of [
    ["R101", "C101"],
    ["R201", "C201"],
  ] as const) {
    const [sa, sb] = [sch.get(a), sch.get(b)]
    const [pa, pb] = [pcb.get(a), pcb.get(b)]
    expect(Math.hypot((sa?.x ?? 0) - (sb?.x ?? 1e9), (sa?.y ?? 0) - (sb?.y ?? 1e9))).toBeLessThan(6)
    expect(Math.hypot((pa?.x ?? 0) - (pb?.x ?? 1e9), (pa?.y ?? 0) - (pb?.y ?? 1e9))).toBeLessThan(6)
  }
  const courtyards = design.pcb.parts.map((p) => boxOf(p.courtyard))
  courtyards.forEach((a, i) => courtyards.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)))
})
