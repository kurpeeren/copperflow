import { elaborate } from "./elaborate.js"
import { evaluateCircuit } from "./evaluate.js"
import { generateFootprint, padCount, type FootprintResult } from "./footprints/index.js"
import type { Circuit, Diagnostic } from "./model.js"
import { layoutPcb, type PcbLayout } from "./pcb.js"
import { layoutSchematic, type SchematicLayout } from "./schematic.js"

/** Everything the Studio draws from one circuit file. Only JSON values, so it crosses a worker and HTTP unchanged. */
export interface Design {
  version: 1
  file: string
  circuit: Circuit
  schematic: SchematicLayout
  pcb: PcbLayout
  diagnostics: Diagnostic[]
}

type Files = Readonly<Record<string, string>>

/** The pad count of a footprint string; a footprint file is read from the project files. */
function padCountIn(files: Files): (footprint: string) => number | undefined {
  return (text) => {
    if (!text.includes("/")) return padCount(text)
    const result = generateFootprint(text, (path) => files[path])
    return "error" in result ? undefined : new Set(result.pads.map((pad) => pad.number)).size
  }
}

/** One footprint per distinct string in the circuit. */
function footprintsOf(circuit: Circuit, files: Files): Map<string, FootprintResult> {
  const texts = new Set(circuit.components.flatMap((c) => (c.footprint === undefined ? [] : [c.footprint])))
  return new Map([...texts].map((text) => [text, generateFootprint(text, (path) => files[path])] as const))
}

/** Evaluates the circuit code in `main`, then lays out the schematic and the board. Throws CircuitCodeError. */
export function buildDesign(files: Files, main: string): Design {
  const circuit = elaborate(evaluateCircuit(files, main), main, { padCount: padCountIn(files) })
  const footprints = footprintsOf(circuit, files)
  const schematic = layoutSchematic(circuit)
  const pcb = layoutPcb(circuit, (component) => footprints.get(component.footprint as string) as FootprintResult)
  return { version: 1, file: main, circuit, schematic, pcb: pcb.layout, diagnostics: [...circuit.diagnostics, ...pcb.diagnostics] }
}
