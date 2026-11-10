import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { expect, test } from "vitest"
import { buildDesign, type Design } from "../../src/engine/design.js"
import { fillPours, type PourInputs } from "../../src/engine/pour/fill.js"
import { netClasses } from "../../src/engine/rules/classes.js"
import { DEFAULT_CLASS } from "../../src/engine/rules/profiles.js"
import { fastestMs } from "../helpers/fastest.js"

const CAN_FOLDER = join(import.meta.dirname, "..", "fixtures", "can-module")
const CAN_MAIN = "can-module.circuit.tsx"
const GROUND_POURS = `<copperpour net="GND" layer="top" /><copperpour net="GND" layer="bottom" />`
/** The plan's bounds: the CAN board in under 200 ms, the 200-part board in under 3 s. */
const CAN_LIMIT_MS = 200
const BENCHMARK_LIMIT_MS = 3000

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

const withPours = (code: string) => code.replace("</board>", `${GROUND_POURS}</board>`)

/** The fill's inputs as buildDesign gives them, so the timing is the fill alone, without the cache. */
function inputsOf(design: Design): PourInputs {
  const board = design.pcb.board
  if (!board) throw new Error("no board")
  const byNet = netClasses(design.rules, design.circuit.nets).byNet
  const classOf = (net: string | undefined) => (net === undefined ? DEFAULT_CLASS.name : (byNet.get(net) ?? DEFAULT_CLASS.name))
  const pads = design.pcb.parts.flatMap((part) => part.pads)
  return { board, pads, tracks: design.pcb.tracks, vias: design.pcb.vias, rules: design.rules, classOf }
}

test("fills the CAN board's GND pours on both layers in under 200 ms", () => {
  const files = filesIn(CAN_FOLDER)
  const design = buildDesign({ ...files, [CAN_MAIN]: withPours(files[CAN_MAIN] ?? "") }, CAN_MAIN)
  expect(design.pcb.pours.map((pour) => pour.polygons.length > 0)).toEqual([true, true])
  const inputs = inputsOf(design)
  const fastest = fastestMs(() => void fillPours(inputs), 3)
  console.log(`fillPours CAN module, 2 pours, fastest of 3: ${fastest.toFixed(1)} ms`)
  expect(fastest).toBeLessThan(CAN_LIMIT_MS)
}, 60_000)

const COLUMNS = 20
const SPACING_MM = 3

/** The router benchmark's 200 parts on a 100 × 60 mm board, pin 1 on GND and pin 2 on VCC, with a GND pour on each side. */
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
  return `export default () => (<board width="100mm" height="60mm">${elements.join("")}${traces.join("")}${GROUND_POURS}</board>)`
}

test("fills the 200-part board's two pours in under 3 s", () => {
  const design = buildDesign({ "big.circuit.tsx": benchmarkBoard() }, "big.circuit.tsx")
  expect(design.circuit.components).toHaveLength(200)
  const inputs = inputsOf(design)
  const fastest = fastestMs(() => void fillPours(inputs), 3)
  console.log(`fillPours 200 parts, 2 pours, fastest of 3: ${fastest.toFixed(1)} ms`)
  expect(fastest).toBeLessThan(BENCHMARK_LIMIT_MS)
}, 120_000)
