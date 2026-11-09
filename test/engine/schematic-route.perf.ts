import { expect, test } from "vitest"
import { fastestMs } from "../helpers/fastest.js"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import { layoutSchematicWithDiagnostics } from "../../src/engine/schematic.js"

const MAIN = "sheet.circuit.tsx"
const COLUMNS = 20
const ROWS = 10
const PITCH_X = 2
const PITCH_Y = 1.5
const EXTRA = 30

const name = (row: number, column: number): string => `R${row * COLUMNS + column + 1}`
const trace = (from: string, to: string): string => `<trace from="${from}" to="${to}" />`

/** 200 placed resistors in a grid, with 400 traces: along each row, down each column, and 30 more between columns. */
function bigSheet(): string {
  const parts: string[] = []
  const traces: string[] = []
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      parts.push(`<resistor name="${name(row, column)}" schX={${column * PITCH_X}} schY={${-row * PITCH_Y}} />`)
      if (column + 1 < COLUMNS) traces.push(trace(`${name(row, column)}.pin2`, `${name(row, column + 1)}.pin1`))
      if (row + 1 < ROWS) traces.push(trace(`${name(row, column)}.pin1`, `${name(row + 1, column)}.pin2`))
    }
  }
  for (let i = 0; i < EXTRA; i++) traces.push(trace(`${name(i % (ROWS - 1), i % COLUMNS)}.pin2`, `${name((i % (ROWS - 1)) + 1, i % COLUMNS)}.pin2`))
  return `export default () => (<board width="100mm" height="60mm">${parts.join("")}${traces.join("")}</board>)`
}

test("routes a 200-part, 400-trace schematic in under 50 ms", () => {
  const circuit = elaborate(evaluateCircuit({ [MAIN]: bigSheet() }, MAIN), MAIN, { padCount: () => undefined })
  expect(circuit.components).toHaveLength(200)
  expect(circuit.connections).toHaveLength(400)
  const result = layoutSchematicWithDiagnostics(circuit)
  console.log(`auto-route fallbacks: ${result.diagnostics.length} of ${circuit.connections.length}`)
  const fastest = fastestMs(() => void layoutSchematicWithDiagnostics(circuit), 5)
  console.log(`layoutSchematic 200 parts / 400 traces, fastest of 5: ${fastest.toFixed(1)} ms`)
  expect(fastest).toBeLessThan(50)
})
