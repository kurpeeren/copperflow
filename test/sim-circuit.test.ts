import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import type { Circuit } from "../src/engine/model.js"
import { ANSWER_LINES, HONEST_LINE } from "../src/engine/sim/answer.js"
import type { Model } from "../src/engine/sim/model-schema.js"
import { simulateCircuit } from "../src/engine/sim/run.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

async function circuitOf(body: string): Promise<Circuit> {
  const root = await mkdtemp(join(tmpdir(), "cf-sim-"))
  await mkdir(root, { recursive: true })
  await writeFile(join(root, "main.circuit.tsx"), `export default () => (\n  <board width="40mm" height="40mm">\n${body}\n  </board>\n)\n`)
  return (await inProcessEngine.build(root, "main.circuit.tsx")).circuit
}

const none = new Map<string, Model>()

test("a divider through the built circuit: nets, the source's current and the parts", async () => {
  const circuit = await circuitOf(`
    <resistor name="R1" resistance="10k" footprint="0603" />
    <resistor name="R2" resistance="10k" footprint="0603" />
    <trace from="R1.pin1" to="net.IN" />
    <trace from="R1.pin2" to="net.OUT" />
    <trace from="R2.pin1" to="net.OUT" />
    <trace from="R2.pin2" to="net.GND" />`)
  const run = simulateCircuit(circuit, none, { set: { IN: 12, GND: 0 } })
  expect(run.ok).toBe(true)
  if (!run.ok) return
  expect(run.text.split("\n")[0]).toBe(HONEST_LINE)
  expect(run.text).toContain("Nets: GND 0 V, IN 12.0 V, OUT 6.00 V")
  expect(run.text).toContain("IN gives 600 µA (7.20 mW)")
  expect(run.text).toContain("total drawn 7.20 mW")
  expect(run.text).toContain("Beyond a limit: none")
  expect(run.text).toContain("  R1 resistor 6.00 V 600 µA 3.60 mW")
  expect(run.figures.get("OUT")).toBeCloseTo(6)
  expect(run.figures.get("R2.i")).toBeCloseTo(6e-4)
})

test("a resistor over its package's rating comes first", async () => {
  // 12 V across 100 ohm is 1.44 W; an 0603 is rated 100 mW.
  const circuit = await circuitOf(`
    <resistor name="R1" resistance="100" footprint="0603" />
    <trace from="R1.pin1" to="net.IN" />
    <trace from="R1.pin2" to="net.GND" />`)
  const run = simulateCircuit(circuit, none, { set: { IN: 12, GND: 0 } })
  expect(run.text).toContain("Beyond a limit:\n  R1 takes 1.44 W, over the 100 mW rating of its 0603 package")
})

test("an LED over its ifmax, a zener over its pdmax and a capacitor over its rating are named", async () => {
  const circuit = await circuitOf(`
    <resistor name="R1" resistance="100" footprint="1206" />
    <led name="D1" vf="2V" vfAt="10mA" ifmax="25mA" footprint="0603" />
    <resistor name="R2" resistance="100" footprint="1206" />
    <diode name="D2" vf="0.9V" vfAt="10mA" vz="3.6V" vzAt="5mA" zz="90" pdmax="0.1W" footprint="sod123" />
    <capacitor name="C1" capacitance="100nF" voltageRating="6.3V" footprint="0603" />
    <trace from="R1.pin1" to="net.IN" />
    <trace from="R1.pin2" to="D1.anode" />
    <trace from="D1.cathode" to="net.GND" />
    <trace from="R2.pin1" to="net.IN" />
    <trace from="R2.pin2" to="net.Z" />
    <trace from="D2.cathode" to="net.Z" />
    <trace from="D2.anode" to="net.GND" />
    <trace from="C1.pin1" to="net.IN" />
    <trace from="C1.pin2" to="net.GND" />`)
  const run = simulateCircuit(circuit, none, { set: { IN: 12, GND: 0 } })
  expect(run.text).toMatch(/D1 carries 9\d\.\d mA, over its ifmax 25.0 mA/)
  expect(run.text).toMatch(/D2 takes \d+ mW, over its pdmax 100 mW/)
  expect(run.text).toContain("C1 has 12.0 V across it, over its voltageRating 6.30 V")
})

test("a MOSFET between off and fully on is named with its gate and threshold", async () => {
  const circuit = await circuitOf(`
    <resistor name="R1" resistance="400" footprint="2512" />
    <mosfet name="Q1" vth="1.45V" rdson="48mohm" rdsonAt="2.5V" footprint="sot23" />
    <trace from="R1.pin1" to="net.V12" />
    <trace from="R1.pin2" to="Q1.drain" />
    <trace from="Q1.source" to="net.GND" />
    <trace from="Q1.gate" to="net.G" />`)
  const between = simulateCircuit(circuit, none, { set: { V12: 12, GND: 0, G: 2 } })
  expect(between.text).toContain("Q1 is between off and on: gate 2.00 V, threshold 1.45 V, fully on from 2.50 V")
  const on = simulateCircuit(circuit, none, { set: { V12: 12, GND: 0, G: 3.3 } })
  expect(on.text).toContain("Beyond a limit: none")
  expect(on.text).toContain("Q1 nmos 817 µV 30.0 mA 24.5 µW, gate 3.30 V, on (Vds 817 µV)")
  expect(between.text).toMatch(/Q1 nmos .*, gate 2.00 V, between off and on/)
  const off = simulateCircuit(circuit, none, { set: { V12: 12, GND: 0, G: 0 } })
  expect(off.text).toMatch(/Q1 nmos .*, gate 0 V, off/)
  expect(on.ok && on.figures.get("Q1.vgs")).toBeCloseTo(3.3)
})

test("a MOSFET or transistor without figures is refused with what to set", async () => {
  const circuit = await circuitOf(`
    <mosfet name="Q1" footprint="sot23" />
    <transistor name="Q2" type="npn" footprint="sot23" />`)
  const run = simulateCircuit(circuit, none, { set: {} })
  expect(run.ok).toBe(false)
  expect(run.text).toContain("Q1 (nmos) has no vth, rdson, rdsonAt: set the props vth, rdson, rdsonAt from its datasheet; a transistor or MOSFET is not guessed")
  expect(run.text).toContain("Q2 (npn) has no hfe, vbe, vbeAt")
})

test("a diode or LED without figures uses generic ones, marked assumed", async () => {
  const circuit = await circuitOf(`
    <resistor name="R1" resistance="1k" footprint="0603" />
    <led name="D1" footprint="0603" />
    <trace from="R1.pin1" to="net.IN" />
    <trace from="R1.pin2" to="D1.anode" />
    <trace from="D1.cathode" to="net.GND" />`)
  const run = simulateCircuit(circuit, none, { set: { IN: 5, GND: 0 } })
  expect(run.text).toContain("Assumed, not from a datasheet: D1 vf 2 V at 10 mA, n 2 (one forward point)")
})

test("a floating net is reported, not a crash", async () => {
  const circuit = await circuitOf(`
    <resistor name="R1" resistance="1k" footprint="0603" />
    <capacitor name="C1" capacitance="1uF" footprint="0603" />
    <trace from="R1.pin1" to="net.IN" />
    <trace from="R1.pin2" to="net.GND" />
    <trace from="C1.pin1" to="net.IN" />
    <trace from="C1.pin2" to="net.ISLAND" />`)
  const run = simulateCircuit(circuit, none, { set: { IN: 5, GND: 0 } })
  expect(run.ok).toBe(true)
  expect(run.text).toContain("ISLAND floating")
  expect(run.ok && Number.isNaN(run.figures.get("ISLAND"))).toBe(true)
})

test("two sources fighting are reported: two set nets joined by a fuse", async () => {
  const circuit = await circuitOf(`
    <fuse name="F1" currentRating="1A" footprint="1206" />
    <trace from="F1.pin1" to="net.A" />
    <trace from="F1.pin2" to="net.B" />`)
  const run = simulateCircuit(circuit, none, { set: { A: 5, B: 3.3 } })
  expect(run.ok).toBe(false)
  expect(run.text).toContain("Sources fight: A is set to 5 V and B to 3.3 V, but they are one node (joined by a wire or a short)")
})

test("an unknown net or part is refused with the nets there are", async () => {
  const circuit = await circuitOf(`
    <resistor name="R1" resistance="1k" footprint="0603" />
    <trace from="R1.pin1" to="net.IN" />
    <trace from="R1.pin2" to="net.GND" />`)
  expect(simulateCircuit(circuit, none, { set: { VIN: 5 } }).text).toContain("There is no net VIN; the nets are GND, IN")
  expect(simulateCircuit(circuit, none, { set: { IN: 5 }, closed: ["SW9"] }).text).toContain("There is no part SW9")
})

test("a switch is open unless the case closes it", async () => {
  const circuit = await circuitOf(`
    <switch name="SW1" footprint="0603" />
    <resistor name="R1" resistance="1k" footprint="0603" />
    <trace from="SW1.pin1" to="net.IN" />
    <trace from="SW1.pin2" to="net.OUT" />
    <trace from="R1.pin1" to="net.OUT" />
    <trace from="R1.pin2" to="net.GND" />`)
  const open = simulateCircuit(circuit, none, { set: { IN: 5, GND: 0 } })
  expect(open.ok && open.figures.get("OUT")).toBeCloseTo(0)
  const closed = simulateCircuit(circuit, none, { set: { IN: 5, GND: 0 }, closed: ["SW1"] })
  expect(closed.ok && closed.figures.get("OUT")).toBeCloseTo(5)
})

test("a chip is not modelled: listed with its power pins' voltages, and a load the model gives is counted", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-sim-chip-"))
  const ldo = `export const Reg = (props: { name: string }) => <chip footprint="sot23" pinLabels={{ pin1: "VDD", pin2: "GND", pin3: "OUT" }} pinAttributes={{ pin1: { requiresPower: true }, pin2: { requiresGround: true }, pin3: { isOutput: true } }} {...props} />\n`
  await mkdir(join(root, "parts", "Reg"), { recursive: true })
  await writeFile(join(root, "parts", "Reg", "Reg.tsx"), ldo)
  await writeFile(
    join(root, "main.circuit.tsx"),
    `import { Reg } from "./parts/Reg/Reg"\nexport default () => (\n  <board width="20mm" height="20mm">\n    <Reg name="U1" />\n    <resistor name="R1" resistance="100" footprint="0603" />\n    <trace from="R1.pin1" to="net.IN" />\n    <trace from="R1.pin2" to="U1.VDD" />\n    <trace from="U1.GND" to="net.GND" />\n  </board>\n)\n`,
  )
  const circuit = (await inProcessEngine.build(root, "main.circuit.tsx")).circuit
  const bare = simulateCircuit(circuit, none, { set: { IN: 5, GND: 0 } })
  expect(bare.text).toContain("Not modelled, their pins draw nothing: U1 (VDD 5.00 V, GND 0 V)")
  const loaded = simulateCircuit(circuit, new Map([["Reg", { kind: "chip", loads: { VDD: 0.01 } } as Model]]), { set: { IN: 5, GND: 0 } })
  expect(loaded.text).toContain("U1 (VDD 4.00 V, GND 0 V)")
})

test("the answer is cut at 40 lines with the count of parts left out", async () => {
  const body = Array.from({ length: 60 }, (_, k) => `    <resistor name="R${k + 1}" resistance="${k + 1}k" footprint="0603" />\n    <trace from="R${k + 1}.pin1" to="net.IN" />\n    <trace from="R${k + 1}.pin2" to="net.GND" />`).join("\n")
  const run = simulateCircuit(await circuitOf(body), none, { set: { IN: 5, GND: 0 } })
  const lines = run.text.split("\n")
  expect(lines.length).toBe(ANSWER_LINES)
  expect(lines.at(-1)).toMatch(/^ {2}… \d+ more parts$/)
  expect(lines).toContain("  R1 resistor 5.00 V 5.00 mA 25.0 mW")
})
