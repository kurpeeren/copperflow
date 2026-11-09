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

const LONG = 60

/** 200 resistors in a 20 x 10 grid, or with no position at all so the engine places them. */
function gridParts(placed: boolean): string[] {
  const parts: string[] = []
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const at = placed ? ` schX={${column * PITCH_X}} schY={${-row * PITCH_Y}}` : ""
      parts.push(`<resistor name="${name(row, column)}"${at} />`)
    }
  }
  return parts
}

const sheet = (traces: readonly string[], placed = true): string =>
  `export default () => (<board width="100mm" height="60mm">${gridParts(placed).join("")}${traces.join("")}</board>)`

/** The grid with 400 traces: along each row, down each column, and 30 more between columns. */
function bigSheet(placed = true): string {
  const traces: string[] = []
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      if (column + 1 < COLUMNS) traces.push(trace(`${name(row, column)}.pin2`, `${name(row, column + 1)}.pin1`))
      if (row + 1 < ROWS) traces.push(trace(`${name(row, column)}.pin1`, `${name(row + 1, column)}.pin2`))
    }
  }
  for (let i = 0; i < EXTRA; i++) traces.push(trace(`${name(i % (ROWS - 1), i % COLUMNS)}.pin2`, `${name((i % (ROWS - 1)) + 1, i % COLUMNS)}.pin2`))
  return sheet(traces, placed)
}

/** The grid with 60 traces between far parts, as code with no corners writes them: part a to part (37a + 101) mod 200. */
function longSheet(): string {
  const traces = Array.from({ length: LONG }, (_, a) => trace(`R${a + 1}.pin1`, `R${((37 * a + 101) % 200) + 1}.pin2`))
  return sheet(traces)
}

function measure(label: string, source: string, connections: number): number {
  const circuit = elaborate(evaluateCircuit({ [MAIN]: source }, MAIN), MAIN, { padCount: () => undefined })
  expect(circuit.components).toHaveLength(200)
  expect(circuit.connections).toHaveLength(connections)
  const result = layoutSchematicWithDiagnostics(circuit)
  console.log(`${label}: auto-route fallbacks ${result.diagnostics.length} of ${connections}`)
  const fastest = fastestMs(() => void layoutSchematicWithDiagnostics(circuit), 5)
  console.log(`${label}: layoutSchematic, fastest of 5: ${fastest.toFixed(1)} ms`)
  return fastest
}

test("routes a 200-part, 400-trace schematic in under 50 ms", () => {
  expect(measure("400 near traces", bigSheet(), 400)).toBeLessThan(50)
})

test("routes 60 traces across a 200-part schematic in under 50 ms", () => {
  expect(measure("60 long traces", longSheet(), LONG)).toBeLessThan(50)
})

test("places and routes the same 200 parts and 400 traces with no position given in under 50 ms", () => {
  expect(measure("400 near traces, nothing placed", bigSheet(false), 400)).toBeLessThan(50)
})

const CHIPS = 50
const pins = `pinLabels={{ pin1: "VDD", pin2: "GND", pin3: "IN", pin4: "OUT" }} pinAttributes={{ pin1: { requiresPower: true }, pin2: { requiresGround: true }, pin3: { isInput: true }, pin4: { isOutput: true } }}`

/** 50 chips with nothing placed, each with a decoupling capacitor, a pull-up on its input and a series resistor to the next chip. */
function chipSheet(): string {
  const parts: string[] = []
  const traces: string[] = []
  for (let i = 1; i <= CHIPS; i++) {
    parts.push(`<chip name="U${i}" ${pins} />`, `<capacitor name="C${i}" capacitance="100nF" />`, `<resistor name="RP${i}" resistance="10k" />`, `<resistor name="RS${i}" resistance="33" />`)
    const next = i < CHIPS ? `U${i + 1}.IN` : "net.END"
    const pairs = [[`U${i}.VDD`, "net.V3_3"], [`U${i}.GND`, "net.GND"], [`C${i}.pin1`, "net.V3_3"], [`C${i}.pin2`, "net.GND"], [`RP${i}.pin1`, `U${i}.IN`], [`RP${i}.pin2`, "net.V3_3"], [`RS${i}.pin1`, `U${i}.OUT`], [`RS${i}.pin2`, next]]
    traces.push(...pairs.map(([from, to]) => trace(from as string, to as string)))
  }
  return `export default () => (<board width="100mm" height="60mm">${parts.join("")}${traces.join("")}</board>)`
}

test("places and routes 50 chips with their passives, nothing placed, in under 50 ms", () => {
  expect(measure("50 chips with passives, nothing placed", chipSheet(), CHIPS * 8)).toBeLessThan(50)
})
