import { layoutPathFor, parseLayout, type LayoutRecord } from "../core/layout-file.js"
import { isCopperNote } from "./checks/copper-notes.js"
import { checkDesign } from "./checks/index.js"
import type { Violation } from "./checks/violation.js"
import { elaborate } from "./elaborate.js"
import { evaluateCircuit } from "./evaluate.js"
import { generateFootprint, type FootprintResult } from "./footprints/index.js"
import { diagnostic } from "./diagnostics.js"
import type { Diagnostic, Circuit } from "./model.js"
import { layoutPcb, type PcbLayout } from "./pcb.js"
import { netClasses } from "./rules/classes.js"
import { layerCountWarnings, loadRules } from "./rules/load.js"
import type { Rules } from "./rules/schema.js"
import { layoutSchematicWithDiagnostics, type SchematicLayout } from "./schematic.js"

/** Everything the Studio draws from one circuit file. Only JSON values, so it crosses a worker and HTTP unchanged. */
export interface Design {
  version: 1
  file: string
  circuit: Circuit
  schematic: SchematicLayout
  pcb: PcbLayout
  rules: Rules
  diagnostics: Diagnostic[]
  /** Electrical and design-rule findings about the design itself, apart from the diagnostics about the code. */
  violations: Violation[]
}

type Files = Readonly<Record<string, string>>

/** Makes each distinct footprint string once per build; a footprint file is read through the project files. */
function footprintCache(files: Files): (text: string) => FootprintResult {
  const results = new Map<string, FootprintResult>()
  return (text) => {
    const known = results.get(text)
    if (known) return known
    const made = generateFootprint(text, (path) => files[path])
    results.set(text, made)
    return made
  }
}

/** Pads with one number are one pin, however many pads there are. */
const pinPads = (footprint: FootprintResult): number | undefined =>
  "error" in footprint ? undefined : new Set(footprint.pads.map((pad) => pad.number)).size

/** The copper in the layout file beside `main`, when there is one; each bad line is an error and is left out. */
function readCopper(files: Files, main: string): { records: LayoutRecord[]; diagnostics: Diagnostic[] } {
  const file = main.endsWith(".circuit.tsx") ? layoutPathFor(main) : undefined
  const text = file === undefined ? undefined : files[file]
  if (text === undefined) return { records: [], diagnostics: [] }
  const { records, errors } = parseLayout(text)
  return { records, diagnostics: errors.map((error) => diagnostic("layout-file", "error", `${file}: ${error}`, [])) }
}

/** Evaluates the circuit code in `main`, then lays out the schematic and the board. Throws CircuitCodeError. */
export function buildDesign(files: Files, main: string): Design {
  const footprintOf = footprintCache(files)
  const circuit = elaborate(evaluateCircuit(files, main), main, { padCount: (text) => pinPads(footprintOf(text)) })
  const { layout: schematic, diagnostics: wiring } = layoutSchematicWithDiagnostics(circuit)
  const copper = readCopper(files, main)
  const pcb = layoutPcb(circuit, (component) => footprintOf(component.footprint as string), copper.records)
  const loaded = loadRules(files)
  const classes = netClasses(loaded.rules, circuit.nets)
  const layers = layerCountWarnings(loaded.rules, circuit.board)
  const notes = pcb.diagnostics.filter(isCopperNote)
  const placement = pcb.diagnostics.filter((d) => !isCopperNote(d))
  const diagnostics = [...circuit.diagnostics, ...wiring, ...copper.diagnostics, ...placement, ...loaded.diagnostics, ...layers, ...classes.diagnostics]
  const violations = checkDesign(circuit, schematic, pcb.layout, loaded.rules, notes)
  return { version: 1, file: main, circuit, schematic, pcb: pcb.layout, rules: loaded.rules, diagnostics, violations }
}
