import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { checkPlainSheet } from "../src/core/plain-sheet.js"
import { describeSheet, readCard } from "../src/core/sheet-card.js"
import { scanCircuit } from "../src/core/analyze.js"
import { CaseSchema, runCases, type SimCase } from "../src/engine/sim/cases.js"
import type { Model } from "../src/engine/sim/model-schema.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const SHEET = `export default function Divider() {
  return (
    <sheet does="halves IN" cases={[{ name: "12 V in", set: { IN: 12, GND: 0 }, expect: { OUT: [5.9, 6.1], "R1.i": [0.00059, 0.00061] } }, { name: "wrong on purpose", set: { IN: 12, GND: 0 }, expect: { OUT: [3.2, 3.6] } }]}>
      <port name="IN" type="input" />
      <port name="OUT" type="output" />
      <port name="GND" type="ground" />
      <resistor name="R1" resistance="10k" footprint="0603" />
      <resistor name="R2" resistance="10k" footprint="0603" />
      <trace from="R1.pin1" to="net.IN" />
      <trace from="R1.pin2" to="net.OUT" />
      <trace from="R2.pin1" to="net.OUT" />
      <trace from="R2.pin2" to="net.GND" />
    </sheet>
  )
}
`

test("a sheet with cases stays plain: the plain check takes literal objects and arrays", () => {
  expect(checkPlainSheet(SHEET).name).toBe("Divider")
})

test("the card reads its cases", () => {
  const card = readCard(SHEET)
  expect(card.cases?.map((c) => c.name)).toEqual(["12 V in", "wrong on purpose"])
  expect(card.cases?.[0]?.expect).toEqual({ OUT: [5.9, 6.1], "R1.i": [0.00059, 0.00061] })
})

test("a case schema refuses a range that runs backwards and keys it does not know", () => {
  expect(CaseSchema.safeParse({ name: "x", set: { A: 1 }, expect: { OUT: [3, 2] } }).success).toBe(false)
  expect(CaseSchema.safeParse({ name: "x", set: { A: 1 }, expect: {}, other: 1 }).success).toBe(false)
  expect(CaseSchema.safeParse({ name: "x", set: { A: "open" }, expect: { A: [0, 1] } }).success).toBe(true)
})

test("cases run one line each: passed, or the figure and the range it missed", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-cases-"))
  await writeFile(join(root, "Divider.sheet.tsx"), SHEET)
  const circuit = (await inProcessEngine.build(root, "Divider.sheet.tsx")).circuit
  const lines = runCases(circuit, new Map<string, Model>(), readCard(SHEET).cases ?? [])
  expect(lines.map((line) => line.text)).toEqual(["passed: 12 V in", "MISSED: wrong on purpose: OUT 6.00 V, wanted 3.20 V to 3.60 V"])
  expect(lines.map((line) => line.passed)).toEqual([true, false])
})

test("a figure the circuit does not have is a miss that says so", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-cases-"))
  await writeFile(join(root, "Divider.sheet.tsx"), SHEET)
  const circuit = (await inProcessEngine.build(root, "Divider.sheet.tsx")).circuit
  const [line] = runCases(circuit, new Map(), [{ name: "odd", set: { IN: 1 }, expect: { "R9.i": [0, 1] } }])
  expect(line?.text).toBe("MISSED: odd: R9.i is no net or figure of this circuit")
})

test("describe_sheet writes cases, and they read back the same", () => {
  const plain = SHEET.replace(/ cases=\{\[.*\]\}/, "")
  const cases: SimCase[] = [{ name: "low", set: { IN: 5, GND: 0 }, expect: { OUT: [2.4, 2.6] } }]
  const written = describeSheet(plain, scanCircuit(plain), { cases })
  expect(readCard(written).cases).toEqual(cases)
  expect(checkPlainSheet(written).name).toBe("Divider")
  const removed = describeSheet(written, scanCircuit(written), { cases: null })
  expect(readCard(removed).cases).toBeUndefined()
})
