import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { spiceNetlist } from "../src/engine/sim/spice.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

// The figures by hand (VT = 0.025852 V): the LED's is = 1 mA / (e^(0.7 / (2 VT)) - 1) = 1.31904e-09 A; the MOSFET's
// KP = 1 / (0.048 x (2.5 - 1.45)) = 19.8413 A/V²; its generic body diode's is = 1 A / (e^(0.8 / (1.5 VT)) - 1) = 1.09747e-09 A.
const EXPECTED = `* copperflow netlist of main.circuit.tsx, SPICE3 syntax as the ngspice manual documents it
* DC operating point from ideal sources and simple models: no time, no frequency, no temperature, no tolerance; chips are not modelled.
V_IN IN 0 DC 5
* GND is set to 0 V: it is node 0
R_R1 IN OUT 10000
R_R2 OUT 0 10000
D_D1 OUT 0 DM_D1
.model DM_D1 D(IS=1.31904e-9 N=2 RS=0)
M_Q1 OUT IN 0 0 MM_Q1 L=1 W=1
.model MM_Q1 NMOS(LEVEL=1 VTO=1.45 KP=19.8413)
D_Q1_BODY 0 OUT DM_Q1_BODY
.model DM_Q1_BODY D(IS=1.09747e-9 N=1.5 RS=0)
* C1 capacitor: open at DC
.op
.end
`

test("the netlist of a small circuit, byte for byte", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-spice-"))
  await writeFile(
    join(root, "main.circuit.tsx"),
    `export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R1" resistance="10k" footprint="0603" />
    <resistor name="R2" resistance="10k" footprint="0603" />
    <led name="D1" vf="0.7V" vfAt="1mA" footprint="0603" />
    <mosfet name="Q1" vth="1.45V" rdson="48mohm" rdsonAt="2.5V" footprint="sot23" />
    <capacitor name="C1" capacitance="100nF" footprint="0603" />
    <trace from="R1.pin1" to="net.IN" />
    <trace from="R1.pin2" to="net.OUT" />
    <trace from="R2.pin1" to="net.OUT" />
    <trace from="R2.pin2" to="net.GND" />
    <trace from="D1.anode" to="net.OUT" />
    <trace from="D1.cathode" to="net.GND" />
    <trace from="Q1.drain" to="net.OUT" />
    <trace from="Q1.gate" to="net.IN" />
    <trace from="Q1.source" to="net.GND" />
    <trace from="C1.pin1" to="net.OUT" />
    <trace from="C1.pin2" to="net.GND" />
  </board>
)
`,
  )
  const circuit = (await inProcessEngine.build(root, "main.circuit.tsx")).circuit
  expect(spiceNetlist(circuit, new Map(), { set: { IN: 5, GND: 0 } }, "main.circuit.tsx")).toBe(EXPECTED)
})
