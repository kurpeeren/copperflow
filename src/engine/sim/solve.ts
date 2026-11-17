// The DC operating point by modified nodal analysis (node voltages and the currents of the voltage sources as the
// unknowns) and Newton's method, as in F. N. Najm, "Circuit Simulation" (Wiley 2010), ch. 2 and 3: junction voltage
// steps are limited, every node has a small conductance to ground, and a circuit that does not converge is tried
// again with its sources raised from zero in steps. Pure: numbers in, numbers out.
import { bjtCurve, criticalVoltage, diodeCurve, GATE_STEP, limitJunction, mosCurve, VT, type DiodeModel } from "./devices.js"
import type { Element, SimCircuit } from "./elements.js"
import { solveLinear } from "./linear.js"

/** The conductance from every node to ground, in siemens: a node with no other path has a defined voltage. */
export const GMIN = 1e-12
const MAX_ITERATIONS = 150
const ABS_TOL = 1e-9
const REL_TOL = 1e-6
/** The smallest step of source stepping before it gives up. */
const MIN_STEP = 1e-4

export interface ElementResult {
  /** The voltage across the element (first terminal minus second; drain to source; collector to emitter). */
  v: number
  /** The current through it in the same direction (drain current; collector current). */
  i: number
  /** The power it takes. */
  p: number
  region?: "off" | "linear" | "saturation"
  /** A MOSFET's gate to source, or a transistor's base to emitter, in the channel's own sense. */
  control?: number
}

export interface Solved {
  converged: true
  /** By node number; volts[0] is the reference, 0 V. */
  volts: number[]
  /** Each source's current into the circuit, in the order of the circuit's sources. */
  sources: { name: string; volts: number; amps: number }[]
  /** In the order of the circuit's elements. */
  elements: ElementResult[]
  iterations: number
}

export interface NotConverged {
  converged: false
  /** The nodes whose voltage changed most in the last step, largest first. */
  moved: { node: string; delta: number }[]
}

export interface SolveOptions {
  maxIterations?: number
  sourceStepping?: boolean
}

/** Where each element's internal node is (a diode with series resistance has one) and the size of the system. */
interface Layout {
  nodeCount: number
  internal: Map<number, number>
  size: number
}

function layout(circuit: SimCircuit): Layout {
  const internal = new Map<number, number>()
  let next = circuit.nodes.length
  circuit.elements.forEach((element, index) => {
    if (element.kind === "diode" && element.model.rs > 0) internal.set(index, ++next)
  })
  return { nodeCount: next, internal, size: next + circuit.sources.length }
}

/** The controlling voltages a nonlinear element is linearised at, kept from step to step for the limiting. */
type State = number[]

class System {
  readonly matrix: Float64Array
  readonly rhs: Float64Array
  constructor(readonly size: number) {
    this.matrix = new Float64Array(size * size)
    this.rhs = new Float64Array(size)
  }
  /** Adds g at (row, col) of node numbers; node 0 is the reference and has no row. */
  add(row: number, col: number, g: number): void {
    if (row > 0 && col > 0) this.matrix[(row - 1) * this.size + (col - 1)] += g
  }
  inject(node: number, amps: number): void {
    if (node > 0) this.rhs[node - 1] += amps
  }
  conductance(a: number, b: number, g: number): void {
    this.add(a, a, g)
    this.add(b, b, g)
    this.add(a, b, -g)
    this.add(b, a, -g)
  }
  /** A current leaving `node` into the element of i0 + sum g_k (v(p_k) - v(q_k) - v0_k), linearised. */
  controlled(node: number, i0: number, terms: readonly { p: number; q: number; g: number; v0: number }[]): void {
    let constant = i0
    for (const term of terms) {
      this.add(node, term.p, term.g)
      this.add(node, term.q, -term.g)
      constant -= term.g * term.v0
    }
    this.inject(node, -constant)
  }
}

const voltage = (x: Float64Array, node: number) => (node === 0 ? 0 : (x[node - 1] ?? 0))

/** The junction node of a diode: its internal node, or the anode when it has no series resistance. */
const junctionNode = (lay: Layout, index: number, anode: number) => lay.internal.get(index) ?? anode

function stampDiode(sys: System, model: DiodeModel, anode: number, cathode: number, v0: number): void {
  const { i, g } = diodeCurve(model, v0)
  sys.controlled(anode, i, [{ p: anode, q: cathode, g, v0 }])
  sys.controlled(cathode, -i, [{ p: anode, q: cathode, g: -g, v0 }])
}

function stamp(circuit: SimCircuit, lay: Layout, state: readonly State[], scale: number): System {
  const sys = new System(lay.size)
  for (let node = 1; node <= lay.nodeCount; node++) sys.add(node, node, GMIN)
  circuit.elements.forEach((element, index) => {
    const s = state[index] ?? []
    switch (element.kind) {
      case "resistor":
        return sys.conductance(element.a, element.b, 1 / element.ohms)
      case "load":
        return sys.inject(element.node, -element.amps * scale)
      case "diode": {
        const junction = junctionNode(lay, index, element.anode)
        if (junction !== element.anode) sys.conductance(element.anode, junction, 1 / element.model.rs)
        return stampDiode(sys, element.model, junction, element.cathode, s[0] ?? 0)
      }
      case "mos":
        return stampMos(sys, element, s)
      case "bjt":
        return stampBjt(sys, element, s)
    }
  })
  circuit.sources.forEach((source, k) => {
    const row = lay.nodeCount + 1 + k
    sys.add(source.node, row, 1)
    sys.add(row, source.node, 1)
    sys.rhs[row - 1] = source.volts * scale
  })
  return sys
}

type Mos = Extract<Element, { kind: "mos" }>
type Bjt = Extract<Element, { kind: "bjt" }>

/** The channel with drain and source swapped when the drain is below the source, in the channel's own polarity. */
function mosOrientation(element: Mos, vgs: number, vds: number) {
  const pol = element.polarity
  const swapped = pol * vds < 0
  // The current from the orientation's drain to its source is pol x the N channel's current in that frame.
  return swapped
    ? { d: element.source, s: element.drain, vgs: pol * (vgs - vds), vds: -pol * vds, sign: pol, swapped }
    : { d: element.drain, s: element.source, vgs: pol * vgs, vds: pol * vds, sign: pol, swapped }
}

function stampMos(sys: System, element: Mos, s: State): void {
  const [vgs = 0, vds = 0, vbody = 0] = s
  const o = mosOrientation(element, vgs, vds)
  const point = mosCurve(element.model, o.vgs, o.vds)
  // The drain current in the orientation's frame, as a current leaving the orientation's drain into the channel.
  const terms = [
    { p: element.gate, q: o.s, g: point.gm, v0: o.sign * o.vgs },
    { p: o.d, q: o.s, g: point.gds, v0: o.sign * o.vds },
  ]
  sys.controlled(o.d, o.sign * point.id, terms)
  sys.controlled(o.s, -o.sign * point.id, terms.map((term) => ({ ...term, g: -term.g })))
  // The body diode: anode at the source of an N channel, at the drain of a P channel.
  const [anode, cathode] = element.polarity === 1 ? [element.source, element.drain] : [element.drain, element.source]
  stampDiode(sys, element.model.body, anode, cathode, vbody)
}

function stampBjt(sys: System, element: Bjt, s: State): void {
  const [vbe = 0, vbc = 0] = s
  const pol = element.polarity
  const point = bjtCurve(element.model, vbe, vbc)
  const { base, collector, emitter } = element
  const icTerms = [
    { p: base, q: emitter, g: point.dic.be, v0: pol * vbe },
    { p: base, q: collector, g: point.dic.bc, v0: pol * vbc },
  ]
  const ibTerms = [
    { p: base, q: emitter, g: point.dib.be, v0: pol * vbe },
    { p: base, q: collector, g: point.dib.bc, v0: pol * vbc },
  ]
  sys.controlled(collector, pol * point.ic, icTerms)
  sys.controlled(base, pol * point.ib, ibTerms)
  const ieTerms = [...icTerms, ...ibTerms].map((term) => ({ ...term, g: -term.g }))
  sys.controlled(emitter, -pol * (point.ic + point.ib), ieTerms)
}

/** The next controlling voltages from the solution, limited against the previous ones; `limited` when any was. */
function nextState(circuit: SimCircuit, lay: Layout, x: Float64Array, previous: readonly State[]): { state: State[]; limited: boolean } {
  let limited = false
  const limit = (next: number, before: number, model: { is: number; n: number }) => {
    const value = limitJunction(next, before, model.n * VT, criticalVoltage(model))
    if (value !== next) limited = true
    return value
  }
  const reverse = (next: number, before: number, model: DiodeModel) => {
    const b = model.breakdown
    if (!b) return next
    // The breakdown is a junction mirrored at -vz: its steps are limited the same way.
    const crit = b.nvt * Math.log(b.nvt / (Math.SQRT2 * b.iz))
    const value = -b.vz - limitJunction(-next - b.vz, -before - b.vz, b.nvt, crit)
    if (value !== next) limited = true
    return value
  }
  const v = (node: number) => voltage(x, node)
  const state = circuit.elements.map((element, index): State => {
    const before = previous[index] ?? []
    switch (element.kind) {
      case "diode": {
        const raw = v(junctionNode(lay, index, element.anode)) - v(element.cathode)
        const old = before[0] ?? 0
        return [raw < old ? reverse(raw, old, element.model) : limit(raw, old, element.model)]
      }
      case "mos": {
        const oldGate = before[0] ?? 0
        const rawGate = v(element.gate) - v(element.source)
        const gate = Math.abs(rawGate - oldGate) > GATE_STEP ? oldGate + Math.sign(rawGate - oldGate) * GATE_STEP : rawGate
        if (gate !== rawGate) limited = true
        const [anode, cathode] = element.polarity === 1 ? [element.source, element.drain] : [element.drain, element.source]
        return [gate, v(element.drain) - v(element.source), limit(v(anode) - v(cathode), before[2] ?? 0, element.model.body)]
      }
      case "bjt": {
        const pol = element.polarity
        const junction = { is: element.model.is, n: 1 }
        const vbe = limit(pol * (v(element.base) - v(element.emitter)), before[0] ?? 0, junction)
        const vbc = limit(pol * (v(element.base) - v(element.collector)), before[1] ?? 0, junction)
        return [vbe, vbc]
      }
      default:
        return []
    }
  })
  return { state, limited }
}

type Attempt = { ok: true; x: Float64Array; state: State[]; iterations: number } | { ok: false; x: Float64Array; delta: Float64Array }

function newton(circuit: SimCircuit, lay: Layout, start: Float64Array, startState: State[], scale: number, maxIterations: number): Attempt {
  let x = start
  let state = startState
  let delta = new Float64Array(lay.size)
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const sys = stamp(circuit, lay, state, scale)
    const next = solveLinear(sys.matrix, sys.rhs, lay.size)
    if (next === undefined) return { ok: false, x, delta }
    delta = next.map((value, k) => value - (x[k] ?? 0))
    const moved = next.some((value, k) => Math.abs(value - (x[k] ?? 0)) > ABS_TOL + REL_TOL * Math.abs(value))
    const stepped = nextState(circuit, lay, next, state)
    x = next
    state = stepped.state
    if (!moved && !stepped.limited && iteration > 1) return { ok: true, x, state, iterations: iteration }
  }
  return { ok: false, x, delta }
}

/** Raises the sources from zero to full in steps, halving a step that fails. */
function sourceStepping(circuit: SimCircuit, lay: Layout, maxIterations: number): Attempt {
  let x = new Float64Array(lay.size)
  let state: State[] = circuit.elements.map(() => [])
  let scale = 0
  let step = 0.1
  let last: Attempt = { ok: false, x, delta: new Float64Array(lay.size) }
  let iterations = 0
  while (scale < 1) {
    const target = Math.min(1, scale + step)
    const attempt = newton(circuit, lay, x, state, target, maxIterations)
    if (attempt.ok) {
      ;({ x, state } = attempt)
      iterations += attempt.iterations
      scale = target
      step = Math.min(step * 2, 0.5)
    } else {
      last = attempt
      step /= 2
      if (step < MIN_STEP) return last
    }
  }
  return { ok: true, x, state, iterations }
}

function results(circuit: SimCircuit, lay: Layout, x: Float64Array, iterations: number): Solved {
  const v = (node: number) => voltage(x, node)
  const elements = circuit.elements.map((element, index): ElementResult => {
    switch (element.kind) {
      case "resistor": {
        const across = v(element.a) - v(element.b)
        return { v: across, i: across / element.ohms, p: (across * across) / element.ohms }
      }
      case "load":
        return { v: v(element.node), i: element.amps, p: v(element.node) * element.amps }
      case "diode": {
        const across = v(element.anode) - v(element.cathode)
        const { i } = diodeCurve(element.model, v(junctionNode(lay, index, element.anode)) - v(element.cathode))
        return { v: across, i, p: across * i }
      }
      case "mos": {
        const vgs = v(element.gate) - v(element.source)
        const vds = v(element.drain) - v(element.source)
        const o = mosOrientation(element, vgs, vds)
        const point = mosCurve(element.model, o.vgs, o.vds)
        const [anode, cathode] = element.polarity === 1 ? [element.source, element.drain] : [element.drain, element.source]
        const body = diodeCurve(element.model.body, v(anode) - v(cathode))
        const channel = (o.swapped ? -1 : 1) * o.sign * point.id
        const id = channel - element.polarity * body.i
        return { v: vds, i: id, p: vds * channel + (v(anode) - v(cathode)) * body.i, region: point.region, control: element.polarity * vgs }
      }
      case "bjt": {
        const pol = element.polarity
        const vbe = v(element.base) - v(element.emitter)
        const point = bjtCurve(element.model, pol * vbe, pol * (v(element.base) - v(element.collector)))
        const vce = v(element.collector) - v(element.emitter)
        return { v: vce, i: pol * point.ic, p: vce * pol * point.ic + vbe * pol * point.ib, control: pol * vbe }
      }
    }
  })
  const sources = circuit.sources.map((source, k) => ({ name: source.name, volts: source.volts, amps: -(x[lay.nodeCount + k] ?? 0) }))
  return { converged: true, volts: [0, ...Array.from({ length: circuit.nodes.length }, (_, k) => x[k] ?? 0)], sources, elements, iterations }
}

const MOVED_SHOWN = 3

/** The operating point, or the nodes that kept moving when Newton's method and source stepping both fail. */
export function solveOperatingPoint(circuit: SimCircuit, options: SolveOptions = {}): Solved | NotConverged {
  const lay = layout(circuit)
  const maxIterations = options.maxIterations ?? MAX_ITERATIONS
  const initial = circuit.elements.map((): State => [])
  let attempt = newton(circuit, lay, new Float64Array(lay.size), initial, 1, maxIterations)
  if (!attempt.ok && options.sourceStepping !== false) attempt = sourceStepping(circuit, lay, maxIterations)
  if (attempt.ok) return results(circuit, lay, attempt.x, attempt.iterations)
  const delta = attempt.delta
  const moved = circuit.nodes
    .map((node, k) => ({ node, delta: delta[k] ?? 0 }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, MOVED_SHOWN)
  return { converged: false, moved }
}
