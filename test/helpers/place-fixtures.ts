import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type { PlacedPosition } from "../../src/engine/pcb-place/index.js"

export const CAN_MAIN = "can-module.circuit.tsx"
const CAN_FOLDER = join(import.meta.dirname, "..", "fixtures", "can-module")

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

/** The CAN module with every board position taken out, so the build packs every part. */
export function canUnplaced(): Record<string, string> {
  const files = filesIn(CAN_FOLDER)
  const main = (files[CAN_MAIN] as string).replace(/ pcbX=\{[^}]*\} pcbY=\{[^}]*\} pcbRotation=\{[^}]*\}/g, "")
  if (/pcbX/.test(main)) throw new Error("the CAN fixture still has a board position")
  return { ...files, [CAN_MAIN]: main }
}

export const BENCHMARK_MAIN = "big.circuit.tsx"

/**
 * The router's 200-part benchmark (100 resistors, 50 capacitors, 50 LEDs on a 100 × 60 mm board, pin 1 of every part
 * on GND and pin 2 on VCC) without positions, so the build packs it.
 */
export function benchmarkUnplaced(): Record<string, string> {
  const parts = [
    ...Array.from({ length: 100 }, (_, i) => ({ tag: "resistor", name: `R${i + 1}`, props: `resistance="1k" footprint="0402"` })),
    ...Array.from({ length: 50 }, (_, i) => ({ tag: "capacitor", name: `C${i + 1}`, props: `capacitance="1uF" footprint="0603"` })),
    ...Array.from({ length: 50 }, (_, i) => ({ tag: "led", name: `D${i + 1}`, props: `footprint="0603"` })),
  ]
  const elements = parts.map((p) => `<${p.tag} name="${p.name}" ${p.props} />`)
  const traces = parts.flatMap((p) => [`<trace from=".${p.name} > .pin1" to="net.GND" />`, `<trace from=".${p.name} > .pin2" to="net.VCC" />`])
  return { [BENCHMARK_MAIN]: `export default () => (<board width="100mm" height="60mm">${elements.join("")}${traces.join("")}</board>)` }
}

/** The source with each placed part's pcbX, pcbY and pcbRotation written after its name (top-level parts only). */
export function withPositions(source: string, positions: ReadonlyMap<string, PlacedPosition>): string {
  let out = source
  for (const [name, at] of positions) {
    const before = out
    out = out.replace(`name="${name}"`, `name="${name}" pcbX={${at.x}} pcbY={${at.y}} pcbRotation={${at.rotation}}`)
    if (out === before) throw new Error(`no part named ${name} in the source`)
  }
  return out
}
