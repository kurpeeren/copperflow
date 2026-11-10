import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { fastestMs } from "../helpers/fastest.js"
import { checkRoutedAll, routeDesign } from "../helpers/route-check.js"

const CAN_FOLDER = join(import.meta.dirname, "..", "fixtures", "can-module")
const CAN_MAIN = "can-module.circuit.tsx"

function filesIn(folder: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else files[relative(folder, path).split("\\").join("/")] = readFileSync(path, "utf8")
    }
  }
  walk(folder)
  return files
}

/**
 * The CAN board's target is 2 s on an idle machine. The limit is 1.5 times that, 3 s, because the perf suite runs
 * beside the rest of the machine's work and the fastest of three runs still swings with the load; a real slowdown
 * of the router goes well past it.
 */
const CAN_LIMIT_MS = 3000

test("routes the CAN module board fully in under 3 s (2 s idle target)", () => {
  const files = filesIn(CAN_FOLDER)
  const design = buildDesign(files, CAN_MAIN)
  const report = routeDesign(design)
  expect(report.unrouted).toEqual([])
  expect(checkRoutedAll(files, CAN_MAIN, report.routed.map((route) => route.copper)).copper).toEqual([])
  const fastest = fastestMs(() => void routeDesign(design), 3)
  console.log(`routeBoard CAN module, ${report.routed.length} connections in ${report.passes} passes, fastest of 3: ${fastest.toFixed(1)} ms`)
  expect(fastest).toBeLessThan(CAN_LIMIT_MS)
}, 60_000)

const COLUMNS = 20
const SPACING_MM = 3

/**
 * The 200 parts of the checks' speed test (100 resistors, 50 capacitors, 50 LEDs in rows 3 mm apart), centred on the
 * 100 × 60 mm board so every pad is on it, with pin 1 of every part on GND and pin 2 on VCC: 398 connections whose
 * two nets interleave along every row, so each one has to make room for the other.
 */
function benchmarkBoard(): string {
  const parts = [
    ...Array.from({ length: 100 }, (_, i) => ({ tag: "resistor", name: `R${i + 1}`, props: `resistance="1k" footprint="0402"` })),
    ...Array.from({ length: 50 }, (_, i) => ({ tag: "capacitor", name: `C${i + 1}`, props: `capacitance="1uF" footprint="0603"` })),
    ...Array.from({ length: 50 }, (_, i) => ({ tag: "led", name: `D${i + 1}`, props: `footprint="0603"` })),
  ]
  const centreX = ((COLUMNS - 1) * SPACING_MM) / 2
  const centreY = ((parts.length / COLUMNS - 1) * SPACING_MM) / 2
  const elements = parts.map((p, i) => `<${p.tag} name="${p.name}" ${p.props} pcbX={${(i % COLUMNS) * SPACING_MM - centreX}} pcbY={${Math.floor(i / COLUMNS) * SPACING_MM - centreY}} />`)
  const traces = parts.flatMap((p) => [`<trace from=".${p.name} > .pin1" to="net.GND" />`, `<trace from=".${p.name} > .pin2" to="net.VCC" />`])
  return `export default () => (<board width="100mm" height="60mm">${elements.join("")}${traces.join("")}</board>)`
}

test("routes the 200-part board's 398 connections in under 30 s", () => {
  const files = { "big.circuit.tsx": benchmarkBoard() }
  const design = buildDesign(files, "big.circuit.tsx")
  expect(design.circuit.components).toHaveLength(200)
  expect(design.pcb.ratsnest).toHaveLength(398)
  const started = performance.now()
  const report = routeDesign(design)
  const elapsed = performance.now() - started
  console.log(`routeBoard 200 parts, ${report.routed.length} of ${design.pcb.ratsnest.length} connections in ${report.passes} passes: ${elapsed.toFixed(0)} ms`)
  expect(report.unrouted).toEqual([])
  expect(checkRoutedAll(files, "big.circuit.tsx", report.routed.map((route) => route.copper)).copper).toEqual([])
  expect(elapsed).toBeLessThan(30_000)
}, 120_000)
