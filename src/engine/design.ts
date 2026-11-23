import { layoutPathFor, parseLayout, type LayoutRecord } from "../core/layout-file.js"
import type { ReferenceRecord } from "../core/layout-references.js"
import { isCopperNote } from "./checks/copper-notes.js"
import { checkDesign } from "./checks/index.js"
import type { Violation } from "./checks/violation.js"
import { lineRows, viaThickness, type LineRow } from "./checks/fast-lines.js"
import { classPairs, hasFastClasses } from "./rules/pairs.js"
import { elaborate } from "./elaborate.js"
import { evaluateCircuit } from "./evaluate.js"
import { generateFootprint, type FootprintResult } from "./footprints/index.js"
import { diagnostic } from "./diagnostics.js"
import type { Board, Diagnostic, Circuit } from "./model.js"
import { withDesignators } from "./fab/designators.js"
import { layoutPcb, type PcbLayout } from "./pcb.js"
import type { PourFiller } from "./pour/resolve.js"
import { cachedPourFills } from "./pour/cache.js"
import { netClasses } from "./rules/classes.js"
import { DEFAULT_CLASS } from "./rules/profiles.js"
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
  /** The lengths of the nets of pair, length and impedance classes; absent on a board without such classes. */
  lines?: LineRow[]
  /** The reference images drawn under the PCB (layout-references.ts); absent when there are none. Never made. */
  references?: ReferenceRecord[]
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
function readCopper(files: Files, main: string): { records: LayoutRecord[]; references?: ReferenceRecord[]; diagnostics: Diagnostic[] } {
  const file = main.endsWith(".circuit.tsx") ? layoutPathFor(main) : undefined
  const text = file === undefined ? undefined : files[file]
  if (text === undefined) return { records: [], diagnostics: [] }
  const { records, references, errors } = parseLayout(text)
  return { records, ...(references ? { references } : {}), diagnostics: errors.map((error) => diagnostic("layout-file", "error", `${file}: ${error}`, [])) }
}

/** Fills the board's pours from the placed pads, the resolved copper, the board and the rules; none without pours. */
function pourFiller(board: Board | undefined, rules: Rules, byNet: ReadonlyMap<string, string>): PourFiller | undefined {
  if (!board?.pours) return undefined
  const classOf = (net: string | undefined) => (net === undefined ? DEFAULT_CLASS.name : (byNet.get(net) ?? DEFAULT_CLASS.name))
  return (pads, copper) => cachedPourFills({ board, pads, tracks: copper.tracks, vias: copper.vias, rules, classOf })
}

/** Evaluates the circuit code in `main`, then lays out the schematic and the board. Throws CircuitCodeError. */
export function buildDesign(files: Files, main: string): Design {
  const footprintOf = footprintCache(files)
  const circuit = elaborate(evaluateCircuit(files, main), main, { padCount: (text) => pinPads(footprintOf(text)), readFile: (path) => files[path] })
  const { layout: schematic, diagnostics: wiring } = layoutSchematicWithDiagnostics(circuit)
  const copper = readCopper(files, main)
  const loaded = loadRules(files)
  const classes = netClasses(loaded.rules, circuit.nets)
  const pcb = layoutPcb(circuit, (component) => footprintOf(component.footprint as string), copper.records, pourFiller(circuit.board, loaded.rules, classes.byNet))
  const layers = layerCountWarnings(loaded.rules, circuit.board)
  const notes = pcb.diagnostics.filter(isCopperNote)
  const placement = pcb.diagnostics.filter((d) => !isCopperNote(d))
  const fast = hasFastClasses(loaded.rules)
  const pairs = fast ? classPairs(loaded.rules, circuit.nets, classes.byNet).diagnostics : []
  const diagnostics = [...circuit.diagnostics, ...wiring, ...copper.diagnostics, ...placement, ...loaded.diagnostics, ...layers, ...classes.diagnostics, ...pairs]
  const layout = pcb.layout
  const violations = checkDesign(circuit, schematic, layout, loaded.rules, notes)
  const board = withDesignators(layout, loaded.rules.fabrication)
  const lines = fast ? lineRows(circuit.nets, layout, loaded.rules, viaThickness(circuit.board?.thickness, loaded.rules)) : undefined
  return { version: 1, file: main, circuit, schematic, pcb: board, rules: loaded.rules, diagnostics, violations, ...(lines ? { lines } : {}), ...(copper.references ? { references: copper.references } : {}) }
}
