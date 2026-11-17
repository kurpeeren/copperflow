import { expect, test } from "vitest"
import { fitBjt, fitDiode, fitMos, VT, type DiodeModel, type MosModel } from "../src/engine/sim/devices.js"
import type { Element, SimCircuit } from "../src/engine/sim/elements.js"
import { solveOperatingPoint, type Solved } from "../src/engine/sim/solve.js"

const r = (part: string, a: number, b: number, ohms: number): Element => ({ kind: "resistor", part, a, b, ohms })

function solved(circuit: SimCircuit): Solved {
  const result = solveOperatingPoint(circuit)
  if (!result.converged) throw new Error(`did not converge: ${JSON.stringify(result.moved)}`)
  return result
}

test("a divider: 12 V over 10k and 10k gives 6 V and 0.6 mA", () => {
  // nodes: 1 IN, 2 OUT
  const out = solved({ nodes: ["IN", "OUT"], sources: [{ name: "IN", node: 1, volts: 12 }], elements: [r("R1", 1, 2, 10e3), r("R2", 2, 0, 10e3)] })
  expect(out.volts[2]).toBeCloseTo(6, 6)
  expect(out.sources[0]?.amps).toBeCloseTo(0.6e-3, 9)
})

test("a loaded divider: 10k over 10k with 10k load gives 12 x 5k / 15k = 4 V", () => {
  const out = solved({ nodes: ["IN", "OUT"], sources: [{ name: "IN", node: 1, volts: 12 }], elements: [r("R1", 1, 2, 10e3), r("R2", 2, 0, 10e3), r("R3", 2, 0, 10e3)] })
  expect(out.volts[2]).toBeCloseTo(4, 6)
})

test("a diode and resistor meet the fitted point: 1.7 V through 1k puts the diode at 0.7 V, 1 mA", () => {
  // The fit puts 1 mA at 0.7 V; 1.7 V - 1k x 1 mA = 0.7 V, so that point is the solution.
  const model: DiodeModel = fitDiode({ vf: 0.7, vfAt: 1e-3, n: 1.8 })
  const out = solved({ nodes: ["IN", "A"], sources: [{ name: "IN", node: 1, volts: 1.7 }], elements: [r("R1", 1, 2, 1e3), { kind: "diode", part: "D1", anode: 2, cathode: 0, model }] })
  expect(out.volts[2]).toBeCloseTo(0.7, 6)
  expect(out.elements[1]?.i).toBeCloseTo(1e-3, 9)
})

test("a diode with series resistance still meets its point", () => {
  const model = fitDiode({ vf: 0.9, vfAt: 10e-3, rs: 5, n: 1.5 })
  // 1.9 V through 100 ohm: 10 mA leaves 0.9 V across diode and rs together.
  const out = solved({ nodes: ["IN", "A"], sources: [{ name: "IN", node: 1, volts: 1.9 }], elements: [r("R1", 1, 2, 100), { kind: "diode", part: "D1", anode: 2, cathode: 0, model }] })
  expect(out.volts[2]).toBeCloseTo(0.9, 6)
})

test("an LED: 12 V through 4.7k to 2.65 V at 2 mA (n 2) settles at 2.6497 V, 1.989 mA", () => {
  // i = (12 - v) / 4.7k; v = 2.65 + 2 VT ln(i / 2 mA): v = 2.65 + 0.0517 ln(0.99470) = 2.64973
  const model = fitDiode({ vf: 2.65, vfAt: 2e-3, n: 2 })
  const out = solved({ nodes: ["V12", "A"], sources: [{ name: "V12", node: 1, volts: 12 }], elements: [r("R3", 1, 2, 4.7e3), { kind: "diode", part: "LED1", anode: 2, cathode: 0, model }] })
  expect(out.volts[2]).toBeCloseTo(2.6497, 4)
  expect(out.elements[1]?.i).toBeCloseTo(1.9894e-3, 6)
})

const zener = (): DiodeModel => ({ ...fitDiode({ vf: 0.9, vfAt: 10e-3, n: 1.5 }), breakdown: { vz: 3.6, iz: 5e-3, nvt: VT } })

test("a zener clamp below breakdown passes the input: 3 V through 1k stays 3.00 V", () => {
  // Reverse current at 3 V: 5 mA e^(-0.6 / VT) = 0.4 nA, 0.4 uV across 1k.
  const out = solved({ nodes: ["IN", "K"], sources: [{ name: "IN", node: 1, volts: 3 }], elements: [r("R1", 1, 2, 1e3), { kind: "diode", part: "D1", anode: 0, cathode: 2, model: zener() }] })
  expect(out.volts[2]).toBeCloseTo(3, 5)
})

test("a zener clamp in breakdown: 10 V through 1k holds 3.6 + VT ln(6.39 / 5) = 3.6063 V", () => {
  const out = solved({ nodes: ["IN", "K"], sources: [{ name: "IN", node: 1, volts: 10 }], elements: [r("R1", 1, 2, 1e3), { kind: "diode", part: "D1", anode: 0, cathode: 2, model: zener() }] })
  expect(out.volts[2]).toBeCloseTo(3.6063, 3)
  expect(-(out.elements[1]?.i ?? 0)).toBeCloseTo(6.394e-3, 5)
})

// AO3400A-like: vth 1.45 V, 48 mOhm at 2.5 V gives k = 1 / (0.048 x 1.05) = 19.84 A/V².
const mos = (): MosModel => ({ vth: 1.45, k: fitMos({ vth: 1.45, rdson: 0.048, rdsonAt: 2.5 }), vgsOn: 2.5, body: fitDiode({ vf: 0.7, vfAt: 1, n: 1.5 }) })
const switchCircuit = (gate: number): SimCircuit => ({
  nodes: ["V12", "DRV", "G"],
  sources: [
    { name: "V12", node: 1, volts: 12 },
    { name: "G", node: 3, volts: gate },
  ],
  elements: [r("K1", 1, 2, 400), { kind: "mos", part: "Q1", drain: 2, gate: 3, source: 0, polarity: 1, model: mos() }],
})

test("a MOSFET switch off: gate 0 V, the drain sits at 12 V", () => {
  // Only the body diode's reverse current (its fitted is, 14 nA) flows: 6 uV across the 400 ohm coil.
  const out = solved(switchCircuit(0))
  expect(out.volts[2]).toBeCloseTo(12, 4)
  expect(out.elements[1]?.region).toBe("off")
})

test("a MOSFET switch on: gate 3.3 V, 30 mA through 27 mOhm leaves 0.82 mV", () => {
  // rds = 1 / (k (3.3 - 1.45)) = 27.2 mOhm; 12 / 400.027 = 29.998 mA; vds = 0.816 mV.
  const out = solved(switchCircuit(3.3))
  expect(out.volts[2]).toBeCloseTo(0.000816, 5)
  expect(out.elements[1]?.region).toBe("linear")
})

test("a MOSFET between: gate 1.5 V saturates at k/2 x 0.05² = 24.8 mA, drain at 12 - 9.92 = 2.08 V", () => {
  const out = solved(switchCircuit(1.5))
  expect(out.elements[1]?.i).toBeCloseTo(0.0248, 4)
  expect(out.volts[2]).toBeCloseTo(2.08, 2)
  expect(out.elements[1]?.region).toBe("saturation")
})

test("a P channel conducts with its gate below its source", () => {
  // 12 V source, gate at 8.7 V (vgs -3.3 V), 400 ohm drain load to ground: about 30 mA.
  const out = solved({
    nodes: ["V12", "D", "G"],
    sources: [
      { name: "V12", node: 1, volts: 12 },
      { name: "G", node: 3, volts: 8.7 },
    ],
    elements: [{ kind: "mos", part: "Q1", drain: 2, gate: 3, source: 1, polarity: -1, model: mos() }, r("RL", 2, 0, 400)],
  })
  expect(out.volts[2]).toBeCloseTo(12 - 0.000816, 4)
})

test("a transistor switch saturates: 5 V, 4.7k to the base, 1k to the collector", () => {
  // ib = (5 - 0.7) / 4.7k = 0.9 mA, while 5 V / 1k allows 5 mA: forced gain 5.5 < 10, so vce falls below vcesat 0.2 V.
  const model = fitBjt({ hfe: 100, vbe: 0.7, vbeAt: 10e-3, vcesat: 0.2 })
  const out = solved({
    nodes: ["V5", "B", "C"],
    sources: [{ name: "V5", node: 1, volts: 5 }],
    elements: [r("RB", 1, 2, 4.7e3), r("RC", 1, 3, 1e3), { kind: "bjt", part: "Q1", collector: 3, base: 2, emitter: 0, polarity: 1, model }],
  })
  expect(out.volts[3]).toBeGreaterThan(0)
  expect(out.volts[3]).toBeLessThan(0.2)
  expect(out.elements[2]?.i).toBeGreaterThan(4.8e-3)
})

test("a bridge of resistors: A = 80/13 V, B = 50/13 V", () => {
  // KCL x 6k: 60 = 11A - 2B, 30 = 11B - 2A, so B = 450/117 = 3.8462 V and A = 6.1538 V.
  const out = solved({
    nodes: ["TOP", "A", "B"],
    sources: [{ name: "TOP", node: 1, volts: 10 }],
    elements: [r("R1", 1, 2, 1e3), r("R2", 2, 0, 2e3), r("R3", 1, 3, 2e3), r("R4", 3, 0, 1e3), r("R5", 2, 3, 3e3)],
  })
  expect(out.volts[2]).toBeCloseTo(80 / 13, 5)
  expect(out.volts[3]).toBeCloseTo(50 / 13, 5)
})

test("a load draws its current from its node", () => {
  const out = solved({ nodes: ["IN", "VDD"], sources: [{ name: "IN", node: 1, volts: 5 }], elements: [r("R1", 1, 2, 100), { kind: "load", part: "U1", node: 2, amps: 0.01 }] })
  expect(out.volts[2]).toBeCloseTo(4, 6)
})

test("a circuit that does not converge answers so, with the nodes that moved most and no figures", () => {
  const result = solveOperatingPoint(switchCircuit(3.3), { maxIterations: 1, sourceStepping: false })
  expect(result.converged).toBe(false)
  if (result.converged) return
  expect(result.moved.length).toBeGreaterThan(0)
  expect(result.moved[0]?.node).toBe("V12")
  expect("volts" in result).toBe(false)
})
