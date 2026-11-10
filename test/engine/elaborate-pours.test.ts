import { expect, test } from "vitest"
import { analyzeCircuit } from "../../src/core/analyze.js"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import type { Circuit } from "../../src/engine/model.js"

const MAIN = "main.circuit.tsx"
const noPads = { padCount: () => undefined }
const GND = `<resistor name="R1" /><trace from="R1.pin1" to="net.GND" />`

function build(body: string, boardProps = `width="10mm" height="10mm"`): Circuit {
  const files = { [MAIN]: `export default () => (\n  <board ${boardProps}>\n${GND}\n${body}\n  </board>\n)\n` }
  return elaborate(evaluateCircuit(files, MAIN), MAIN, noPads)
}

const warnings = (circuit: Circuit) => circuit.diagnostics.map((d) => d.message)

test("a copperpour is read with its defaults, and a whole-board pour has no outline", () => {
  const circuit = build(`<copperpour net="GND" layer="bottom" />`)
  expect(circuit.diagnostics).toEqual([])
  expect(circuit.board?.pours).toEqual([
    {
      id: "copperpour:1",
      net: "net.GND",
      layer: "bottom",
      priority: 0,
      minWidth: 0.25,
      thermal: "relief",
      thermalWidth: 0.3,
      thermalGap: 0.25,
      source: expect.objectContaining({ file: MAIN }),
    },
  ])
})

test("a copperpour's optional props, its outline shifted by the group offset", () => {
  const circuit = build(`<group pcbX={1} pcbY={2}><copperpour net="net.GND" layer="top" outline={[{x:-2,y:-2},{x:2,y:-2},{x:2,y:2}]}
    priority={2} clearance="0.3mm" minWidth={0.2} thermal="solid" thermalWidth={0.4} thermalGap="10mil" /></group>`)
  expect(circuit.diagnostics).toEqual([])
  expect(circuit.board?.pours?.[0]).toMatchObject({
    net: "net.GND",
    layer: "top",
    outline: [
      { x: -1, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ],
    priority: 2,
    clearance: 0.3,
    minWidth: 0.2,
    thermal: "solid",
    thermalWidth: 0.4,
    thermalGap: 0.254,
  })
})

test("a copperpour without a known net or a usable layer is warned about and ignored", () => {
  const circuit = build(`<copperpour layer="top" /><copperpour net="VCC" layer="top" /><copperpour net="GND" layer="inner3" />
<copperpour net="GND" layer="inner1" /><copperpour net="GND" layer="top" outline={[{x:0,y:0}]} />`)
  expect(circuit.board?.pours).toBeUndefined()
  expect(warnings(circuit)).toEqual([
    'copperpour needs a net, such as net="GND"; it is ignored',
    "copperpour: layer must be top, bottom, inner1 or inner2; the pour is ignored",
    "copperpour: outline must be a list of at least 3 points with x and y; the pour is ignored",
    "copperpour: the circuit has no net VCC; the pour is ignored",
    "copperpour: a 2-layer board has no inner1; the pour is ignored",
  ])
  expect(build(`<copperpour net="GND" layer="inner2" />`, `width="10mm" height="10mm" layers={4}`).board?.pours).toHaveLength(1)
})

test("a copperpour's bad optional props are warned about and their defaults used", () => {
  const circuit = build(`<copperpour net="GND" layer="top" priority="high" minWidth={0} thermal="none" thermalWidth={-1} thermalGap="x" clearance={0} />`)
  expect(circuit.board?.pours?.[0]).toMatchObject({ priority: 0, minWidth: 0.25, thermal: "relief", thermalWidth: 0.3, thermalGap: 0.25 })
  expect(circuit.board?.pours?.[0]).not.toHaveProperty("clearance")
  expect(circuit.diagnostics.filter((d) => d.code === "bad-value")).toHaveLength(6)
})

test("a copperpour whose outline leaves the board is warned about and kept", () => {
  const circuit = build(`<copperpour net="GND" layer="top" outline={[{x:0,y:0},{x:8,y:0},{x:8,y:3}]} />`)
  expect(warnings(circuit)).toEqual(["copperpour: the outline goes outside the board; only the part on the board is filled"])
  expect(circuit.board?.pours).toHaveLength(1)
})

test("a hole is read at x, y with its diameter, shifted by the group offset", () => {
  const circuit = build(`<hole x={-3} y="3mm" diameter="3.2mm" /><group pcbX={1}><hole x={3} y={-3} diameter={2} /></group>`)
  expect(circuit.diagnostics).toEqual([])
  expect(circuit.board?.holes).toEqual([
    { id: "hole:1", x: -3, y: 3, diameter: 3.2, source: expect.objectContaining({ file: MAIN }) },
    { id: "hole:2", x: 4, y: -3, diameter: 2, source: expect.objectContaining({ file: MAIN }) },
  ])
})

test("a hole without a position or a positive diameter is warned about and ignored", () => {
  const circuit = build(`<hole x={1} diameter={2} /><hole x={1} y={1} diameter={0} />`)
  expect(circuit.board?.holes).toBeUndefined()
  expect(warnings(circuit)).toEqual(["hole needs x, y and diameter; it is ignored", "hole: diameter must be more than 0; it is ignored"])
})

test("pours and holes need a board, and are no longer later-stage elements", () => {
  const files = { [MAIN]: `export default () => (<group>${GND}<copperpour net="GND" layer="top" /><hole x={0} y={0} diameter={1} /></group>)` }
  const circuit = elaborate(evaluateCircuit(files, MAIN), MAIN, noPads)
  expect(circuit.diagnostics.map((d) => d.message)).toEqual(["<copperpour> needs a <board>; it is ignored", "<hole> needs a <board>; it is ignored"])
})

test("every copperpour and hole tag is counted, kept or not, and a dropped one's warning names its id", () => {
  const body = `<copperpour layer="top" />\n<copperpour net="GND" layer="bottom" />\n<hole x={1} y={1} diameter="abc" />\n<hole x={2} y={2} diameter={3} />`
  const circuit = build(body)
  expect(circuit.board?.pours?.map((pour) => pour.id)).toEqual(["copperpour:2"])
  expect(circuit.board?.holes?.map((hole) => hole.id)).toEqual(["hole:2"])
  const items = circuit.diagnostics.flatMap((d) => d.items)
  expect(items).toContain("copperpour:1")
  expect(items).toContain("hole:1")
  const source = `export default () => (\n  <board width="10mm" height="10mm">\n${GND}\n${body}\n  </board>\n)\n`
  const core = (analyzeCircuit(source).boardItems ?? []).map((item) => item.id)
  expect(core).toEqual(["copperpour:1", "copperpour:2", "hole:1", "hole:2"])
  expect(core).toEqual(expect.arrayContaining([...(circuit.board?.pours ?? []), ...(circuit.board?.holes ?? [])].map((item) => item.id)))
  expect(analyzeCircuit(source).boardItems?.every((item) => item.editable)).toBe(true)
})
