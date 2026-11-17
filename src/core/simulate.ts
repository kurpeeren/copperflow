// simulate: the DC operating point of a circuit file or of one of its sheets, with the sources a request sets, or the
// sheet's own cases when it sets none. The library parts' models come from their part.yaml.
import { readFile } from "node:fs/promises"
import { posix } from "node:path"
import { runCases } from "../engine/sim/cases.js"
import { HONEST_LINE } from "../engine/sim/answer.js"
import type { Model } from "../engine/sim/model-schema.js"
import { simulateCircuit } from "../engine/sim/run.js"
import { spiceNetlist } from "../engine/sim/spice.js"
import type { Circuit } from "../engine/model.js"
import { recordCaseResults } from "./case-results.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { readPart } from "./library.js"
import { readCard } from "./sheet-card.js"
import { resolveCircuit } from "./workspace.js"

const SHEET_NAME = /^[A-Z][A-Za-z0-9_]*$/

export interface SimulateInput {
  file: string
  set?: Record<string, number | "open"> | undefined
  sheet?: string | undefined
  closed?: string[] | undefined
  coil?: string[] | undefined
  all?: boolean | undefined
}

/** The models of the library parts the circuit uses, by part id; a part.yaml that cannot be read is an error. */
export async function libraryModels(root: string, circuit: Circuit): Promise<Map<string, Model>> {
  const models = new Map<string, Model>()
  for (const id of new Set(circuit.components.flatMap((component) => (component.library ? [component.library] : [])))) {
    const part = await readPart(root, id)
    if (part.model) models.set(id, part.model)
  }
  return models
}

/** The file simulated: the circuit, or with `sheet` the sheet file of that name beside it. */
async function target(root: string, input: SimulateInput): Promise<{ path: string; file: string }> {
  if (input.sheet === undefined) return resolveCircuit(root, input.file)
  if (!SHEET_NAME.test(input.sheet)) throw new Error(`"${input.sheet}" is not a sheet name: a capital letter, then letters, digits and _`)
  const place = posix.dirname((await resolveCircuit(root, input.file)).file)
  return resolveCircuit(root, posix.join(place === "." ? "" : place, `${input.sheet}.sheet.tsx`))
}

export async function simulate(root: string, input: SimulateInput, engine?: DesignSource): Promise<string> {
  const file = await target(root, input)
  const design = await buildWith(root, file.file, engine)
  const errors = design.diagnostics.filter((d) => d.severity === "error")
  if (errors.length > 0) return [`${file.file} has errors; fix them first:`, ...errors.slice(0, 5).map((d) => `  ${d.message}`)].join("\n")
  const models = await libraryModels(root, design.circuit)
  if (input.set !== undefined && Object.keys(input.set).length > 0) {
    const request = { set: input.set, ...(input.closed ? { closed: input.closed } : {}), ...(input.coil ? { coil: input.coil } : {}) }
    return simulateCircuit(design.circuit, models, request, { all: input.all === true }).text
  }
  const name = posix.basename(file.file).replace(/\.(sheet|circuit)\.tsx$/, "")
  const cases = readCard(await readFile(file.path, "utf8")).cases ?? []
  if (cases.length === 0) return `${file.file} has no cases: give set (net to volts), or write cases on the sheet's card with describe_sheet`
  const lines = runCases(design.circuit, models, cases)
  recordCaseResults(name, lines)
  const passed = lines.filter((line) => line.passed).length
  return [HONEST_LINE, `Cases of ${name}: ${passed} of ${lines.length} passed`, ...lines.map((line) => `  ${line.text}`)].join("\n")
}

/**
 * The SPICE netlist of the circuit or sheet, with the sources the input sets, else those of the sheet's first case,
 * else none (another simulator's user adds them).
 */
export async function spiceText(root: string, input: SimulateInput, engine?: DesignSource): Promise<string> {
  const file = await target(root, input)
  const design = await buildWith(root, file.file, engine)
  const models = await libraryModels(root, design.circuit)
  const first = readCard(await readFile(file.path, "utf8")).cases?.[0]
  const given = input.set !== undefined && Object.keys(input.set).length > 0
  const chosen = given ? input : first
  const request = { set: chosen?.set ?? {}, ...(chosen?.closed ? { closed: chosen.closed } : {}), ...(chosen?.coil ? { coil: chosen.coil } : {}) }
  const text = spiceNetlist(design.circuit, models, request, file.file)
  if (given || first === undefined) return text
  const [title, ...rest] = text.split("\n")
  return [title, `* sources of the case "${first.name}"`, ...rest].join("\n")
}
