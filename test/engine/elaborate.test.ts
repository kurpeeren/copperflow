import { expect, test } from "vitest"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import { elaborate } from "../../src/engine/elaborate.js"
import type { Circuit } from "../../src/engine/model.js"

const MAIN = "main.circuit.tsx"
const board = (body: string) => `export default () => (\n  <board width="10mm" height="10mm">\n${body}\n  </board>\n)\n`
const noPads = { padCount: () => undefined }

function build(body: string, extra: Record<string, string> = {}, imports = ""): Circuit {
  const files = { [MAIN]: imports + board(body), ...extra }
  return elaborate(evaluateCircuit(files, MAIN), MAIN, noPads)
}

const names = (circuit: Circuit, id: string) => circuit.components.find((c) => c.id === id)?.pins.map((p) => p.names)

test("pins of built-in kinds and pinLabels", () => {
  const plain = build(`<led name="LED1" />`)
  expect(names(plain, "LED1")).toEqual([
    ["pin1", "anode", "pos"],
    ["pin2", "cathode", "neg"],
  ])
  const relabelled = build(
    `<led name="LED1" pinLabels={{ pin1: "cathode", pin2: "anode" }} />\n<trace from="LED1.anode" to="net.VCC" />`,
  )
  expect(names(relabelled, "LED1")).toEqual([
    ["pin1", "cathode"],
    ["pin2", "anode"],
  ])
  expect(relabelled.nets).toEqual([{ id: "net.VCC", names: ["VCC"], pins: ["LED1.pin2"] }])
})

test("named and unnamed nets", () => {
  const circuit = build(
    [
      `<resistor name="R1" />`,
      `<capacitor name="C1" />`,
      `<trace from="R1.pin2" to="net.GND" />`,
      `<trace from="C1.pin2" to="net.GND" />`,
      `<trace from="C1.pin1" to=".R1 > .pin1" />`,
    ].join("\n"),
  )
  expect(circuit.nets).toContainEqual({ id: "net.GND", names: ["GND"], pins: ["C1.pin2", "R1.pin2"] })
  expect(circuit.nets).toContainEqual({ id: "net:C1.pin1", names: [], pins: ["C1.pin1", "R1.pin1"] })
  expect(circuit.connections.map((c) => c.id)).toEqual(["R1.pin2|net.GND", "C1.pin2|net.GND", "C1.pin1|R1.pin1"])
})

test("duplicate names are reported once and both parts are kept", () => {
  const circuit = build(`{[1, 2].map(() => <resistor name="RX" />)}`)
  expect(circuit.components.map((c) => c.id)).toEqual(["RX", "RX~2"])
  expect(circuit.components[1]?.pins[0]?.id).toBe("RX~2.pin1")
  expect(circuit.diagnostics).toHaveLength(1)
  expect(circuit.diagnostics[0]).toMatchObject({ code: "duplicate-name", severity: "error", items: ["RX"] })
})

test("a mistyped pin is reported with the real pins", () => {
  const circuit = build(`<resistor name="R1" />\n<trace from="R1.pin3" to="net.GND" />\n<trace from="R1.pin1" to="net.VCC" />`)
  expect(circuit.diagnostics.map((d) => d.message)).toContain("R1 has no pin pin3 (pins: pin1, pin2)")
  expect(circuit.diagnostics.find((d) => d.code === "unknown-pin")?.severity).toBe("error")
  expect(circuit.nets.map((n) => n.id)).toContain("net.VCC")
})

test("group offsets add up", () => {
  const circuit = build(`<group pcbX={10} schY={2}>\n<resistor name="R1" pcbX={1} schX={3} />\n</group>`)
  expect(circuit.components[0]?.pcb).toEqual({ x: 11, y: 0, rotation: 0, side: "top" })
  expect(circuit.components[0]?.sch).toEqual({ x: 3, y: 2, rotation: 0 })
})

test("library parts keep their call site", () => {
  const part = [
    `export const AP = (props: { name: string }) => (`,
    `  <chip footprint="sot23_5" manufacturerPartNumber="AP2112K" pinLabels={{ pin1: "VIN", pin2: ["GND", "VSS"] }}`,
    `    pinAttributes={{ pin1: { requiresPower: true } }} {...props} />`,
    `)`,
  ].join("\n")
  const circuit = build(`<AP name="U1" />`, { "parts/AP/AP.tsx": part }, `import { AP } from "./parts/AP/AP"\n`)
  const u1 = circuit.components[0]
  expect(u1).toMatchObject({ id: "U1", kind: "chip", library: "AP", mpn: "AP2112K", footprint: "sot23_5" })
  expect(u1?.source.file).toBe(MAIN)
  expect(u1?.pins[0]).toMatchObject({ id: "U1.pin1", names: ["pin1", "VIN"], type: "power_in" })
  expect(u1?.pins[1]).toMatchObject({ names: ["pin2", "GND", "VSS"], type: "passive" })
  expect(circuit.diagnostics).toEqual([])
})

test("unsupported elements are reported, not skipped", () => {
  const circuit = build(`<via />\n<widget />`)
  expect(circuit.diagnostics).toMatchObject([
    { code: "unsupported-element", severity: "warning", items: ["via"] },
    { code: "unsupported-element", severity: "error", items: ["widget"] },
  ])
})

test("pinheader pins follow pinCount", () => {
  const circuit = build(`<pinheader name="J1" pinCount={3} />`)
  expect(circuit.components[0]?.pins.map((p) => p.id)).toEqual(["J1.pin1", "J1.pin2", "J1.pin3"])
})

test("chips take pins from pinCount or the footprint when unlabelled", () => {
  const files = { [MAIN]: board(`<chip name="U1" footprint="soic8" />\n<chip name="U2" pinCount={2} />`) }
  const circuit = elaborate(evaluateCircuit(files, MAIN), MAIN, { padCount: (f) => (f === "soic8" ? 8 : undefined) })
  expect(circuit.components.map((c) => c.pins.length)).toEqual([8, 2])
})

test("a connector with no pin source gets an error and no pins", () => {
  const circuit = build(`<connector name="J1" standard="usb_c" />`)
  expect(circuit.components[0]?.pins).toEqual([])
  expect(circuit.diagnostics).toMatchObject([{ code: "unsupported-element", severity: "error", items: ["J1"] }])
})

test("polarized capacitors, transistors and mosfets have their aliases", () => {
  const circuit = build(`<capacitor name="C1" polarized />\n<transistor name="Q1" type="npn" />\n<mosfet name="Q2" />`)
  expect(names(circuit, "C1")).toEqual([
    ["pin1", "pos", "anode"],
    ["pin2", "neg", "cathode"],
  ])
  expect(names(circuit, "Q1")?.[2]).toEqual(["pin3", "C", "collector"])
  expect(names(circuit, "Q2")?.[0]).toEqual(["pin1", "G", "gate"])
})

test("placement, side, values and props", () => {
  const circuit = build(
    `<resistor name="R1" resistance="10k" footprint="0402" pcbX="1mm" pcbRotation={-90} layer="bottom" onClick={() => 1} />\n<resistor name="R2" />`,
  )
  const [r1, r2] = circuit.components
  expect(r1).toMatchObject({ value: "10k", footprint: "0402", pcb: { x: 1, y: 0, rotation: 270, side: "bottom" } })
  expect(r1?.props).toMatchObject({ resistance: "10k" })
  expect(r1?.props).not.toHaveProperty("onClick")
  expect(r2?.pcb).toBeUndefined()
  expect(r2?.sch).toBeUndefined()
})

test("schRotation is rounded to a multiple of 90 with a warning", () => {
  const circuit = build(`<resistor name="R1" schX={0} schRotation={100} />\n<resistor name="R2" schX={0} schRotation={-90} />`)
  expect(circuit.components[0]?.sch?.rotation).toBe(90)
  expect(circuit.components[1]?.sch?.rotation).toBe(270)
  expect(circuit.diagnostics).toMatchObject([{ code: "bad-value", severity: "warning" }])
})

test("a part without a name is reported", () => {
  const circuit = build(`<resistor />`)
  expect(circuit.components).toEqual([])
  expect(circuit.diagnostics).toMatchObject([{ code: "missing-name", severity: "error" }])
})

test("bad selectors and unknown parts are reported", () => {
  const circuit = build(`<resistor name="R1" />\n<trace from="R9.pin1" to="net.GND" />\n<trace from="what is this" to="R1.pin1" />`)
  expect(circuit.diagnostics).toMatchObject([
    { code: "unknown-part", items: ["R9"] },
    { code: "bad-selector", items: ["what is this"] },
  ])
  expect(circuit.connections).toEqual([])
})

test("one trace joining two named nets warns and the net keeps both names", () => {
  const circuit = build(`<trace from="net.VCC" to="net.AVCC" />`)
  expect(circuit.nets).toEqual([{ id: "net.AVCC", names: ["AVCC", "VCC"], pins: [] }])
  expect(circuit.diagnostics).toMatchObject([{ code: "nets-joined", severity: "warning", items: ["AVCC", "VCC"] }])
})

test("repeated connections get numbered ids, widths and corners", () => {
  const circuit = build(
    `<resistor name="R1" />\n<trace from="R1.pin1" to="net.A" width="0.3mm" />\n<trace from="R1.pin1" to="net.A" thickness={0.5} schematicRouteHints={[{ x: 1, y: 2 }, { x: "bad" }]} />`,
  )
  expect(circuit.connections.map((c) => c.id)).toEqual(["R1.pin1|net.A", "R1.pin1|net.A#2"])
  expect(circuit.connections[0]?.width).toBe(0.3)
  expect(circuit.connections[1]).toMatchObject({ width: 0.5, corners: [{ x: 1, y: 2 }] })
})

test("the board is a rectangle or an outline, and there is only one", () => {
  const rect = build(`<resistor name="R1" />`)
  expect(rect.board).toEqual({
    outline: [
      { x: -5, y: -5 },
      { x: 5, y: -5 },
      { x: 5, y: 5 },
      { x: -5, y: 5 },
    ],
    layers: 2,
    thickness: 1.6,
  })
  const files = {
    [MAIN]: `export default () => (\n<board outline={[{x:0,y:0},{x:4,y:0},{x:0,y:3}]} layers={4} thickness="1mm" pcbX={2} schMaxTraceDistance={5}>\n<board width={1} height={1} />\n</board>\n)`,
  }
  const circuit = elaborate(evaluateCircuit(files, MAIN), MAIN, noPads)
  expect(circuit.board).toEqual({
    outline: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 3 },
    ],
    layers: 4,
    thickness: 1,
    schMaxTraceDistance: 5,
  })
  expect(circuit.diagnostics).toMatchObject([{ code: "two-boards", severity: "error" }])
})

test("errors thrown by a function component name its file", () => {
  const files = {
    "parts/B/B.tsx": `export const B = () => { throw new Error("boom") }`,
    [MAIN]: `import { B } from "./parts/B/B"\n` + board(`<B name="U1" />`),
  }
  const evaluated = evaluateCircuit(files, MAIN)
  expect(() => elaborate(evaluated, MAIN, noPads)).toThrow(/^parts\/B\/B\.tsx: boom/)
})
