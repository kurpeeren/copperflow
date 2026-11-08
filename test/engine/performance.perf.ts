import { expect, test } from "vitest"
import { fastestMs } from "../helpers/fastest.js"
import { checkDesign } from "../../src/engine/checks/index.js"
import { buildDesign } from "../../src/engine/design.js"

const COLUMNS = 20
const SPACING_MM = 3

interface Part {
  tag: string
  name: string
  props: string
}

/** 100 resistors, 50 capacitors and 50 LEDs in rows, each tied to GND and to its neighbour. */
function bigBoard(): string {
  const parts: Part[] = [
    ...Array.from({ length: 100 }, (_, i) => ({ tag: "resistor", name: `R${i + 1}`, props: `resistance="1k" footprint="0402"` })),
    ...Array.from({ length: 50 }, (_, i) => ({ tag: "capacitor", name: `C${i + 1}`, props: `capacitance="1uF" footprint="0603"` })),
    ...Array.from({ length: 50 }, (_, i) => ({ tag: "led", name: `D${i + 1}`, props: `footprint="0603"` })),
  ]
  const elements = parts.map((p, i) => {
    const x = (i % COLUMNS) * SPACING_MM
    const y = Math.floor(i / COLUMNS) * SPACING_MM
    return `<${p.tag} name="${p.name}" ${p.props} pcbX={${x}} pcbY={${y}} />`
  })
  const traces = parts.flatMap((p, i) => {
    const next = parts[i + 1]
    const ground = `<trace from=".${p.name} > .pin1" to="net.GND" />`
    return next ? [ground, `<trace from=".${p.name} > .pin2" to=".${next.name} > .pin1" />`] : [ground]
  })
  return `export default () => (<board width="100mm" height="60mm">${elements.join("")}${traces.join("")}</board>)`
}

test("builds a 200-part board quickly", () => {
  const files = { "big.circuit.tsx": bigBoard() }
  const run = () => buildDesign(files, "big.circuit.tsx")
  expect(run().circuit.components).toHaveLength(200)
  const fastest = fastestMs(() => void run(), 5)
  console.log(`buildDesign 200 parts, fastest of 5: ${fastest.toFixed(1)} ms`)
  expect(fastest).toBeLessThan(300)
})

test("checks a 200-part board in under a second", () => {
  const built = buildDesign({ "big.circuit.tsx": bigBoard() }, "big.circuit.tsx")
  const fastest = fastestMs(() => void checkDesign(built.circuit, built.schematic, built.pcb, built.rules), 5)
  console.log(`checkDesign 200 parts, fastest of 5: ${fastest.toFixed(1)} ms`)
  expect(fastest).toBeLessThan(1000)
})
