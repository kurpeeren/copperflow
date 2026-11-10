import { expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import type { Circuit } from "../../src/engine/model.js"
import { defaultPortSide, placePorts } from "../../src/engine/sheet-ports.js"
import { nearestPlace, sheetSymbol, sheetSymbolLayout } from "../../src/engine/sheet-symbol.js"

const MAIN = "main.circuit.tsx"
const noPads = { padCount: () => undefined }

const sheetOf = (name: string, body: string, props = "") => `export default function ${name}() {\n  return (\n    <sheet${props}>\n${body}\n    </sheet>\n  )\n}\n`

function build(main: string, sheets: Record<string, string>, file = MAIN): Circuit {
  const imports = Object.keys(sheets)
    .map((sheet) => `import ${sheet.replace(".sheet.tsx", "")} from "./${sheet.replace(".tsx", "")}"\n`)
    .join("")
  const files = { [MAIN]: `${imports}export default () => (<board width="40mm" height="40mm">${main}</board>)\n`, ...sheets }
  return elaborate(evaluateCircuit(files, file), file, noPads)
}

const STAGE = sheetOf(
  "Stage",
  [`<port name="VIN" />`, `<port name="VOUT" />`, `<port name="EN" side="top" />`, `<port name="GND" />`, `<port name="FB" side="right" order={3} />`, `<resistor name="R1" />`].join("\n"),
  " width={2} height={1}",
)

test("ports go where they say, else inputs and power left, outputs right, ground bottom, in source order", () => {
  const circuit = build(`<Stage name="S1" />`, { "Stage.sheet.tsx": STAGE })
  const ports = circuit.instances?.[0]?.ports.map(({ name, side, order }) => `${name} ${side} ${order}`)
  expect(ports).toEqual(["VIN left 1", "VOUT right 1", "EN top 1", "GND bottom 1", "FB right 3"])
  expect(circuit.instances?.[0]?.size).toEqual({ width: 2, height: 1 })
  expect(["VCC", "V3_3", "IN", "SDA"].map(defaultPortSide)).toEqual(["left", "left", "left", "left"])
  expect(["VOUT", "DOUT", "GND", "AGND"].map(defaultPortSide)).toEqual(["right", "right", "bottom", "bottom"])
})

test("a sheet built alone carries its ports and its symbol size", () => {
  const circuit = build("", { "Stage.sheet.tsx": STAGE }, "Stage.sheet.tsx")
  expect(circuit.sheet?.name).toBe("Stage")
  expect(circuit.sheet?.size).toEqual({ width: 2, height: 1 })
  expect(circuit.sheet?.ports.map((port) => port.name)).toEqual(["VIN", "VOUT", "EN", "GND", "FB"])
})

test("bad sides, orders, sizes and two ports at one place are errors, reported once per sheet file", () => {
  const bad = sheetOf(
    "Bad",
    [`<port name="A" side="up" />`, `<port name="B" order={0} />`, `<port name="C" order={2} />`, `<port name="D" order={2} />`].join("\n"),
    ` width={-1} height="tall"`,
  )
  const circuit = build(`<Bad name="B1" /><Bad name="B2" />`, { "Bad.sheet.tsx": bad })
  const found = circuit.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code} ${d.items.join(",")}`)
  expect(found).toEqual(["bad-value A.side", "bad-value B.order", "port-place Bad.D", "bad-value Bad.width", "bad-value Bad.height"])
  const ports = circuit.instances?.[0]?.ports.map(({ name, side, order }) => `${name} ${side} ${order}`)
  expect(ports).toEqual(["A left 1", "B left 3", "C left 2", "D left 4"])
})

test("placePorts fills the free slots in source order around the written ones", () => {
  const placed = placePorts([{ name: "A", bus: false }, { name: "B", bus: false, order: 1 }, { name: "C", bus: false }], "S").ports
  expect(placed.map((port) => `${port.name} ${port.order}`)).toEqual(["A 2", "B 1", "C 3"])
})

test("the symbol's pins sit on the sides in their slots, and the box grows to fit them", () => {
  const layout = sheetSymbolLayout([
    { name: "VIN", side: "left", order: 1 },
    { name: "VOUT", side: "right", order: 2 },
    { name: "EN", side: "top", order: 1 },
    { name: "GND", side: "bottom", order: 3 },
    { name: "D[0:7]", side: "left", order: 4, bus: true },
  ])
  expect(layout).toMatchObject({ width: 1.2, height: 1 })
  expect(layout.pins.map((pin) => [pin.name, pin.edge, pin.end])).toEqual([
    ["VIN", { x: 0, y: -0.2 }, { x: -0.2, y: -0.2 }],
    ["VOUT", { x: 1.2, y: -0.4 }, { x: 1.4, y: -0.4 }],
    ["EN", { x: 0.2, y: 0 }, { x: 0.2, y: 0.2 }],
    ["GND", { x: 0.6, y: -1 }, { x: 0.6, y: -1.2 }],
    ["D[0:7]", { x: 0, y: -0.8 }, { x: -0.2, y: -0.8 }],
  ])
  expect(sheetSymbolLayout([{ name: "A", side: "left", order: 1 }], { width: 3, height: 2 })).toMatchObject({ width: 3, height: 2 })
  expect(sheetSymbolLayout([{ name: "A", side: "left", order: 9 }], { width: 3, height: 1 })).toMatchObject({ width: 3, height: 2 })
})

test("the symbol is a box with the instance name above, the sheet name below, and a pin per port", () => {
  const layout = sheetSymbolLayout([
    { name: "VIN", side: "left", order: 1 },
    { name: "D[0:7]", side: "right", order: 1, bus: true },
  ])
  const symbol = sheetSymbol("PS1", "PowerStage", layout)
  expect(symbol.kind).toBe("sheet")
  expect(symbol.pins).toEqual([
    { number: 1, name: "VIN", end: { x: -0.2, y: -0.2 }, side: "left" },
    { number: 2, name: "D[0:7]", end: { x: 1.4, y: -0.2 }, side: "right" },
  ])
  const texts = symbol.shapes.flatMap((shape) => (shape.type === "text" ? [`${shape.role} ${shape.text}`] : []))
  expect(texts).toEqual(["pin-name VIN", "pin-name D[0:7]", "reference PS1", "value PowerStage"])
  // The bus pin is a hollow bar; the net pin a line.
  const closed = symbol.shapes.filter((shape) => shape.type === "polyline" && shape.closed)
  expect(closed).toHaveLength(2)
  expect(symbol.bounds.minX).toBeLessThan(-0.19)
  expect(symbol.bounds.maxY).toBeGreaterThan(0.1)
})

test("a dragged pin lands on the nearest side, in the nearest slot that fits", () => {
  expect(nearestPlace({ x: 0.1, y: -0.41 }, 1.2, 1)).toEqual({ side: "left", order: 2 })
  expect(nearestPlace({ x: 1.3, y: -5 }, 1.2, 1)).toEqual({ side: "right", order: 4 })
  expect(nearestPlace({ x: 0.83, y: 0.05 }, 1.2, 1)).toEqual({ side: "top", order: 4 })
  expect(nearestPlace({ x: -3, y: -1.1 }, 1.2, 1)).toEqual({ side: "bottom", order: 1 })
})

const BUSSED = sheetOf("Io", [`<port name="D[0:3]" bus />`, `<port name="CLK" />`, `<resistor name="R1" />`, `<trace from="R1.pin1" to="net.D0" />`, `<trace from="R1.pin2" to="net.D3" />`].join("\n"))

test("a bus port joins the parent bus's members by name", () => {
  const circuit = build(`<Io name="IO1" connections={{ "D[0:3]": "D[0:3]", CLK: "CLK" }} /><resistor name="R9" /><trace from="R9.pin1" to="net.D0" />`, { "Io.sheet.tsx": BUSSED })
  const net = (name: string) => circuit.nets.find((candidate) => candidate.names.includes(name))?.pins
  expect(net("D0")).toEqual(expect.arrayContaining(["R101.pin1", "R9.pin1"]))
  expect(net("D3")).toEqual(["R101.pin2"])
  expect(circuit.instances?.[0]?.ports[0]).toEqual({ name: "D[0:3]", side: "left", order: 1, bus: true, net: "D[0:3]", members: ["D0", "D1", "D2", "D3"] })
  expect(circuit.instances?.[0]?.connections).toEqual({ "D[0:3]": "D[0:3]", CLK: "CLK" })
  expect(circuit.diagnostics.filter((d) => d.severity === "error")).toEqual([])
})

test("a member missing on one side of a bus port is an error naming it", () => {
  const circuit = build(`<Io name="IO1" connections={{ "D[0:3]": "D[0:2]", CLK: "CLK" }} />`, { "Io.sheet.tsx": BUSSED })
  const missing = circuit.diagnostics.filter((d) => d.code === "bus-member-missing")
  expect(missing.map((d) => d.message)).toEqual(["IO1 connects bus port D[0:3] of Io to D[0:2], but D3 is missing from D[0:2]"])
  expect(circuit.nets.find((n) => n.names.includes("IO1/D3"))?.pins).toEqual(["R101.pin2"])
  const wider = build(`<Io name="IO1" connections={{ "D[0:3]": "D[0:5]", CLK: "CLK" }} />`, { "Io.sheet.tsx": BUSSED })
  expect(wider.diagnostics.filter((d) => d.code === "bus-member-missing").map((d) => d.items)).toEqual([["IO1.D4", "IO1.D5"]])
  const plain = build(`<Io name="IO1" connections={{ "D[0:3]": "X(", CLK: "CLK" }} />`, { "Io.sheet.tsx": BUSSED })
  expect(plain.diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toEqual(["bad-value"])
})

test("an instance's schRotation turns its symbol a quarter turn at a time", () => {
  const circuit = build(`<Stage name="S1" schX={2} schY={1} schRotation={95} />`, { "Stage.sheet.tsx": STAGE })
  expect(circuit.instances?.[0]?.sch).toEqual({ x: 2, y: 1, rotation: 90 })
})

test("drawings inside an instance say so", () => {
  const sheet = sheetOf("Note", `<schematictext x={0} y={0} text="hi" />`)
  const circuit = build(`<Note name="N1" /><schematictext x={1} y={1} text="top" />`, { "Note.sheet.tsx": sheet })
  expect(circuit.drawings.map((d) => d.instance)).toEqual(["N1", undefined])
})

const POWER = sheetOf(
  "PowerStage",
  [
    `<port name="VIN" />`,
    `<port name="VOUT" />`,
    `<port name="GND" />`,
    `<resistor name="R1" schX={0} schY={0} />`,
    `<trace from="R1.pin1" to="net.VIN" />`,
    `<trace from="R1.pin2" to="net.VOUT" />`,
    `<schematictext x={0} y={1} text="inside" />`,
  ].join("\n"),
)

function design(main: string, file = MAIN) {
  const imports = `import PowerStage from "./PowerStage.sheet"\n`
  const files = { [MAIN]: `${imports}export default () => (<board width="40mm" height="40mm">${main}</board>)\n`, "PowerStage.sheet.tsx": POWER }
  return buildDesign(files, file)
}

test("the parent page draws each instance as its sheet symbol, wired at its port pins like a part", () => {
  const built = design(
    [`<PowerStage name="PS1" connections={{ VIN: "SIG", VOUT: "V3", GND: "GND" }} schX={2} schY={0} />`, `<resistor name="R1" schX={0} schY={0} />`, `<trace from="R1.pin2" to="net.SIG" />`].join("\n"),
  )
  const symbols = built.schematic.symbols.map((s) => `${s.component} ${s.symbol.kind}`)
  expect(symbols).toEqual(["R1 resistor", "PS1 sheet"])
  const sheet = built.schematic.symbols.find((s) => s.component === "PS1")
  expect(sheet?.pinEnds).toEqual({ "PS1.VIN": { x: 1.8, y: -0.2 }, "PS1.VOUT": { x: 3.4, y: -0.2 }, "PS1.GND": { x: 2.2, y: -0.8 } })
  const ends = built.schematic.wires.filter((wire) => wire.net === "net.SIG").flatMap((wire) => [wire.points[0], wire.points.at(-1)])
  expect(ends).toEqual(expect.arrayContaining([{ x: 0.5, y: 0 }, { x: 1.8, y: -0.2 }]))
  expect(built.schematic.drawings).toEqual([])
  // The flattened parts are still the design's, for the PCB and the checks.
  expect(built.circuit.components.map((c) => c.id)).toEqual(["R101", "R1"])
})

test("a sheet built alone shows its parts by their local names and a flag for each port", () => {
  const built = design("", "PowerStage.sheet.tsx")
  expect(built.schematic.symbols.map((s) => s.component)).toEqual(["R1"])
  const flags = built.schematic.labels.filter((label) => label.port).map((label) => `${label.id} ${label.text} ${label.at.x},${label.at.y}`)
  expect(flags).toEqual(["port:VIN VIN -0.5,0", "port:VOUT VOUT 0.5,0", "port:GND GND -1.5,0"])
  expect(built.schematic.pages?.[0]?.labels).toEqual(expect.arrayContaining(["port:VIN", "port:VOUT", "port:GND"]))
})

test("an instance with schRotation and no position turns its symbol where the layout places it", () => {
  const built = design(`<PowerStage name="PS1" connections={{ VIN: "A", VOUT: "B", GND: "GND" }} schRotation={90} />`)
  expect(built.circuit.instances?.[0]?.schRotation).toBe(90)
  expect(built.schematic.symbols.find((s) => s.component === "PS1")).toMatchObject({ rotation: 90, autoPlaced: true })
})
