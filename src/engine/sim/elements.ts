// The circuit as the solver sees it: numbered nodes (0 is the reference, ground), sources from a node to the
// reference, and elements between nodes. Built from a design by from-circuit.ts, or by hand in tests.
import type { BjtModel, DiodeModel, MosModel } from "./devices.js"

/** A set net: an ideal voltage source from `node` to the reference. */
export interface Source {
  name: string
  node: number
  volts: number
}

export type Element =
  | { kind: "resistor"; part: string; a: number; b: number; ohms: number }
  | { kind: "diode"; part: string; anode: number; cathode: number; model: DiodeModel }
  | { kind: "mos"; part: string; drain: number; gate: number; source: number; polarity: 1 | -1; model: MosModel }
  | { kind: "bjt"; part: string; collector: number; base: number; emitter: number; polarity: 1 | -1; model: BjtModel }
  /** A pin that draws `amps` into the part, from `node` to the reference. */
  | { kind: "load"; part: string; node: number; amps: number }

export interface SimCircuit {
  /** Node names; node k is `nodes[k - 1]`. */
  nodes: string[]
  sources: Source[]
  elements: Element[]
}
