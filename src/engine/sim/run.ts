// One run of the simulator over a built circuit: the circuit as nodes and elements, the operating point, the answer.
import type { Circuit } from "../model.js"
import { figureValues, formatAnswer, formatNotConverged, HONEST_LINE } from "./answer.js"
import { buildSimCircuit, type SimRequest } from "./from-circuit.js"
import type { Model } from "./model-schema.js"
import { solveOperatingPoint } from "./solve.js"

export type SimRun = { ok: true; text: string; figures: Map<string, number> } | { ok: false; text: string }

export function simulateCircuit(circuit: Circuit, models: ReadonlyMap<string, Model>, request: SimRequest, options: { all?: boolean } = {}): SimRun {
  const built = buildSimCircuit(circuit, models, request)
  if ("refused" in built) return { ok: false, text: [HONEST_LINE, "Not run:", ...built.refused.map((line) => `  ${line}`)].join("\n") }
  const solved = solveOperatingPoint(built.sim)
  if (!solved.converged) return { ok: false, text: formatNotConverged(solved) }
  return { ok: true, text: formatAnswer(built, solved, options), figures: figureValues(built, solved) }
}
