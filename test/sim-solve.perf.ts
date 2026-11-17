import { expect, test } from "vitest"
import type { Element } from "../src/engine/sim/elements.js"
import { solveOperatingPoint } from "../src/engine/sim/solve.js"

// A ladder of 300 resistors: 150 series 1k between 151 nodes, each node with 1k to ground. Linear, so Newton's method
// needs two solves of a 151-node system.
test("a circuit of 300 resistors solves in under 50 ms", () => {
  const elements: Element[] = []
  for (let k = 1; k <= 150; k++) {
    elements.push({ kind: "resistor", part: `RS${k}`, a: k, b: k + 1, ohms: 1e3 })
    elements.push({ kind: "resistor", part: `RG${k}`, a: k + 1, b: 0, ohms: 1e3 })
  }
  const circuit = { nodes: Array.from({ length: 151 }, (_, k) => `N${k + 1}`), sources: [{ name: "N1", node: 1, volts: 10 }], elements }
  solveOperatingPoint(circuit)
  const started = performance.now()
  const result = solveOperatingPoint(circuit)
  const took = performance.now() - started
  console.log(`300 resistors: ${took.toFixed(1)} ms`)
  expect(elements.length).toBe(300)
  expect(result.converged).toBe(true)
  expect(took).toBeLessThan(50)
})
