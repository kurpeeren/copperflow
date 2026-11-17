// A built circuit as the solver's nodes and elements. Nets joined by a short (a fuse, an inductor without series
// resistance, a closed switch, a relay's closed contact) are one node; each set net is a source to ground; parts that
// are not modelled draw nothing unless their model says what a pin draws, and their power pins are listed.
import type { Circuit, Component } from "../model.js"
import { naturalCompare } from "../order.js"
import { fitBjt, fitDiode, fitMos, VT, type DiodeModel } from "./devices.js"
import type { Element, SimCircuit } from "./elements.js"
import type { Model, ModelKind } from "./model-schema.js"
import { GENERIC, partFigures, type PartFigures } from "./part-models.js"
import { parseQuantity } from "./values.js"

export interface SimRequest {
  /** Net name to volts, or "open" to leave it floating. */
  set: Readonly<Record<string, number | "open">>
  /** Switches, jumpers and push buttons that are closed. */
  closed?: readonly string[]
  /** Relays whose coil is energised: their contacts are as when it is. */
  coil?: readonly string[]
}

/** A modelled part: its elements by index, its limits and the figures that were assumed. */
export interface SimPart {
  name: string
  kind: ModelKind | "resistor" | "relay"
  /** The element whose voltage and current are the part's; the others add their power. */
  main: number
  elements: number[]
  assumed: string[]
  figures: PartFigures["figures"]
  footprint?: string
}

export interface Unmodelled {
  part: string
  kind: string
  /** The part's power and ground pins with their nodes. */
  power: { pin: string; node: number }[]
}

export interface Built {
  sim: SimCircuit
  parts: SimPart[]
  unmodelled: Unmodelled[]
  /** Every net name and the node it is on. */
  netNodes: Map<string, number>
  /** The nodes no element path reaches from a set net. Node numbers: named groups first, in natural order. */
  floating: Set<number>
  capacitors: { part: string; a: number; b: number; rating?: number }[]
}

export type BuildResult = Built | { refused: string[] }

class Groups {
  private readonly parent = new Map<string, string>()
  find(item: string): string {
    const up = this.parent.get(item)
    if (up === undefined || up === item) {
      if (up === undefined) this.parent.set(item, item)
      return item
    }
    const root = this.find(up)
    this.parent.set(item, root)
    return root
  }
  join(a: string, b: string): void {
    const [ra, rb] = [this.find(a), this.find(b)]
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

type Draft =
  | { kind: "resistor"; part: string; a: string; b: string; ohms: number }
  | { kind: "diode"; part: string; anode: string; cathode: string; model: DiodeModel }
  | { kind: "mos"; part: string; drain: string; gate: string; source: string; polarity: 1 | -1; model: Extract<Element, { kind: "mos" }>["model"] }
  | { kind: "bjt"; part: string; collector: string; base: string; emitter: string; polarity: 1 | -1; model: Extract<Element, { kind: "bjt" }>["model"] }
  | { kind: "load"; part: string; node: string; amps: number }

const SHORT_KINDS = new Set(["fuse"])
const OPEN_KINDS = new Set(["capacitor", "crystal", "resonator", "testpoint", "pinheader", "connector"])
const POWER_PINS = new Set(["power_in", "power_out", "ground"])

class Builder {
  readonly groups = new Groups()
  readonly drafts: Draft[] = []
  readonly parts: (Omit<SimPart, "main" | "elements"> & { drafts: number[]; main: number })[] = []
  readonly unmodelled: { part: string; kind: string; power: { pin: string; net: string }[] }[] = []
  readonly capacitors: { part: string; a: string; b: string; rating?: number }[] = []
  readonly refused: string[] = []
  private readonly pinNet = new Map<string, string>()

  constructor(
    readonly circuit: Circuit,
    private readonly request: SimRequest,
  ) {
    for (const net of circuit.nets) for (const pin of net.pins) this.pinNet.set(pin, net.id)
    for (const net of circuit.nets) this.groups.find(net.id)
  }

  /** The net of a component's pin by one of its names, or undefined (with a refusal) when it has none. */
  net(component: Component, name: string): string | undefined {
    const pin = component.pins.find((p) => p.names.includes(name))
    if (!pin) {
      this.refused.push(`${component.id} has no pin ${name}`)
      return undefined
    }
    return this.pinNet.get(pin.id) ?? `pin:${pin.id}`
  }

  private add(component: Component, kind: SimPart["kind"], drafts: Draft[], figures: PartFigures | undefined): void {
    const first = this.drafts.length
    this.drafts.push(...drafts)
    const indices = drafts.map((_, k) => first + k)
    this.parts.push({ name: component.id, kind, drafts: indices, main: first, assumed: figures?.assumed ?? [], figures: figures?.figures ?? {}, ...(component.footprint ? { footprint: component.footprint } : {}) })
  }

  private unmodelledPart(component: Component, loads: Record<string, number> = {}): void {
    const power = component.pins.filter((pin) => POWER_PINS.has(pin.type)).map((pin) => ({ pin: pin.names[1] ?? pin.names[0] ?? pin.id, net: this.pinNet.get(pin.id) ?? `pin:${pin.id}` }))
    this.unmodelled.push({ part: component.id, kind: component.library ? `part ${component.library}` : component.kind, power })
    const drafts: Draft[] = []
    for (const [pin, amps] of Object.entries(loads)) {
      const net = this.net(component, pin)
      if (net !== undefined) drafts.push({ kind: "load", part: component.id, node: net, amps })
    }
    if (drafts.length > 0) this.add(component, "chip", drafts, undefined)
  }

  /** The two ends of a two-pin part: pin1 and pin2. */
  private ends(component: Component, roles?: Record<string, string>): [string, string] | undefined {
    const a = this.net(component, roles?.["a"] ?? "pin1")
    const b = this.net(component, roles?.["b"] ?? "pin2")
    return a === undefined || b === undefined ? undefined : [a, b]
  }

  part(component: Component, models: ReadonlyMap<string, Model>): void {
    const kind = component.kind
    if (component.library === undefined && kind === "resistor") return this.resistor(component)
    if (component.library === undefined && OPEN_KINDS.has(kind)) {
      if (kind === "capacitor") this.capacitor(component)
      return
    }
    if (component.library === undefined && SHORT_KINDS.has(kind)) return this.short(component)
    if (component.library === undefined && (kind === "switch" || kind === "pushbutton")) return this.switch(component)
    const figures = partFigures(component, models)
    if (figures === undefined) return this.unmodelledPart(component)
    if ("refusal" in figures) {
      this.refused.push(figures.refusal)
      return
    }
    this.modelled(component, figures)
  }

  private resistor(component: Component): void {
    const ohms = parseQuantity(component.props["resistance"] ?? component.value)
    const ends = this.ends(component)
    if (ohms === undefined || !(ohms > 0)) {
      this.refused.push(`${component.id} has no resistance the simulator can read`)
      return
    }
    if (ends) this.add(component, "resistor", [{ kind: "resistor", part: component.id, a: ends[0], b: ends[1], ohms }], undefined)
  }

  private capacitor(component: Component): void {
    const ends = this.ends(component)
    const rating = parseQuantity(component.props["voltageRating"] ?? component.props["maxVoltageRating"])
    if (ends) this.capacitors.push({ part: component.id, a: ends[0], b: ends[1], ...(rating !== undefined ? { rating } : {}) })
  }

  private short(component: Component, roles?: Record<string, string>): void {
    const ends = this.ends(component, roles)
    if (ends) this.groups.join(ends[0], ends[1])
  }

  private switch(component: Component): void {
    if (!(this.request.closed ?? []).includes(component.id)) return
    const nets = component.pins.map((pin) => this.pinNet.get(pin.id) ?? `pin:${pin.id}`)
    for (const net of nets.slice(1)) this.groups.join(nets[0] as string, net)
  }

  private modelled(component: Component, figures: PartFigures): void {
    const role = (name: string, fallback: string) => this.net(component, figures.pins[name] ?? fallback)
    const f = figures.figures
    switch (figures.kind) {
      case "diode":
      case "led":
      case "schottky":
      case "zener": {
        const [anode, cathode] = [role("anode", "anode"), role("cathode", "cathode")]
        if (anode === undefined || cathode === undefined) return
        const model = this.diodeModel(component, figures)
        if (model) this.add(component, figures.kind, [{ kind: "diode", part: component.id, anode, cathode, model }], figures)
        return
      }
      case "nmos":
      case "pmos": {
        const [drain, gate, source] = [role("drain", "drain"), role("gate", "gate"), role("source", "source")]
        if (drain === undefined || gate === undefined || source === undefined) return
        const vth = f.vth as number
        const k = fitMos({ vth, rdson: f.rdson as number, rdsonAt: f.rdsonAt as number })
        const bodyPoint = f.vsd !== undefined && f.vsdAt !== undefined ? { vf: f.vsd, vfAt: f.vsdAt, n: GENERIC.body.n } : GENERIC.body
        const assumed = [...figures.assumed, ...(f.vsd === undefined ? [`body diode ${GENERIC.body.vf} V at ${GENERIC.body.vfAt} A`] : []), `body diode n ${GENERIC.body.n}`]
        const body = fitDiode(bodyPoint)
        const polarity = figures.kind === "nmos" ? 1 : -1
        this.add(component, figures.kind, [{ kind: "mos", part: component.id, drain, gate, source, polarity, model: { vth, k, vgsOn: f.rdsonAt as number, body } }], { ...figures, assumed })
        return
      }
      case "npn":
      case "pnp": {
        const [collector, base, emitter] = [role("collector", "collector"), role("base", "base"), role("emitter", "emitter")]
        if (collector === undefined || base === undefined || emitter === undefined) return
        const model = fitBjt({ hfe: f.hfe as number, vbe: f.vbe as number, vbeAt: f.vbeAt as number, ...(f.vcesat !== undefined ? { vcesat: f.vcesat } : {}) })
        const assumed = [...figures.assumed, ...(f.vcesat === undefined ? ["reverse gain 1 (no vcesat)"] : [])]
        this.add(component, figures.kind, [{ kind: "bjt", part: component.id, collector, base, emitter, polarity: figures.kind === "npn" ? 1 : -1, model }], { ...figures, assumed })
        return
      }
      case "relay":
        return this.relay(component, figures)
      case "inductor":
      case "ferrite":
      case "fuse": {
        const ends = this.ends(component, figures.pins)
        if (!ends) return
        if (f.dcr !== undefined && f.dcr > 0) this.add(component, figures.kind, [{ kind: "resistor", part: component.id, a: ends[0], b: ends[1], ohms: f.dcr }], figures)
        else this.groups.join(ends[0], ends[1])
        return
      }
      case "chip":
        return this.unmodelledPart(component, figures.loads)
    }
  }

  private diodeModel(component: Component, figures: PartFigures): DiodeModel | undefined {
    const f = figures.figures
    const kind = figures.kind as keyof typeof GENERIC
    const twoPoints = f.vf2 !== undefined && f.vf2At !== undefined
    if (!twoPoints) figures.assumed.push(`n ${GENERIC[kind].n} (one forward point)`)
    try {
      const fitted = fitDiode({ vf: f.vf as number, vfAt: f.vfAt as number, ...(twoPoints ? { vf2: f.vf2 as number, vf2At: f.vf2At as number } : {}), ...(f.rs !== undefined ? { rs: f.rs } : {}), n: GENERIC[kind].n })
      if (figures.kind !== "zener") return fitted
      if (f.zz === undefined) figures.assumed.push("zener knee e-fold every VT (no zz)")
      const nvt = f.zz !== undefined ? f.zz * (f.vzAt as number) : VT
      return { ...fitted, breakdown: { vz: f.vz as number, iz: f.vzAt as number, nvt } }
    } catch (error) {
      this.refused.push(`${component.id}: ${(error as Error).message}`)
      return undefined
    }
  }

  private relay(component: Component, figures: PartFigures): void {
    const coil1 = this.net(component, figures.pins["coil1"] ?? "COIL1")
    const coil2 = this.net(component, figures.pins["coil2"] ?? "COIL2")
    const common = this.net(component, figures.pins["com"] ?? "COM")
    if (coil1 === undefined || coil2 === undefined || common === undefined) return
    const energised = (this.request.coil ?? []).includes(component.id)
    const closedPin = figures.pins[energised ? "no" : "nc"]
    const closed = closedPin === undefined ? undefined : this.net(component, closedPin)
    if (closed !== undefined) this.groups.join(common, closed)
    this.add(component, "relay", [{ kind: "resistor", part: component.id, a: coil1, b: coil2, ohms: figures.figures.coil as number }], figures)
  }
}

/** The display name of a group of nets: its first named net, else its first net id. */
function groupNames(circuit: Circuit, groups: Groups): Map<string, { name: string; named: boolean }> {
  const byGroup = new Map<string, string[]>()
  for (const net of circuit.nets) for (const name of net.names) byGroup.set(groups.find(net.id), [...(byGroup.get(groups.find(net.id)) ?? []), name])
  const result = new Map<string, { name: string; named: boolean }>()
  for (const net of circuit.nets) {
    const root = groups.find(net.id)
    if (result.has(root)) continue
    const names = (byGroup.get(root) ?? []).sort(naturalCompare)
    result.set(root, names[0] !== undefined ? { name: names[0], named: true } : { name: net.id.replace(/^net:/, ""), named: false })
  }
  return result
}

function checkNames(builder: Builder, circuit: Circuit, request: SimRequest): void {
  const ids = new Set(circuit.components.map((component) => component.id))
  for (const name of [...(request.closed ?? []), ...(request.coil ?? [])]) if (!ids.has(name)) builder.refused.push(`There is no part ${name} to close or energise`)
}

/** The nodes no element path reaches from a set net: their voltage is not defined by the circuit. */
function floatingNodes(sim: SimCircuit): Set<number> {
  const links = new Map<number, number[]>()
  const link = (a: number, b: number) => {
    links.set(a, [...(links.get(a) ?? []), b])
    links.set(b, [...(links.get(b) ?? []), a])
  }
  for (const element of sim.elements) {
    if (element.kind === "resistor") link(element.a, element.b)
    if (element.kind === "diode") link(element.anode, element.cathode)
    if (element.kind === "mos") link(element.drain, element.source)
    if (element.kind === "bjt") {
      link(element.base, element.emitter)
      link(element.collector, element.emitter)
    }
  }
  const reached = new Set<number>(sim.sources.map((source) => source.node))
  const queue = [...reached]
  while (queue.length > 0) {
    for (const next of links.get(queue.pop() as number) ?? []) {
      if (reached.has(next)) continue
      reached.add(next)
      queue.push(next)
    }
  }
  return new Set(sim.nodes.map((_, k) => k + 1).filter((node) => !reached.has(node)))
}

/** The solver's circuit for `circuit` with the request's sources, or the reasons it cannot be run. */
export function buildSimCircuit(circuit: Circuit, models: ReadonlyMap<string, Model>, request: SimRequest): BuildResult {
  const builder = new Builder(circuit, request)
  checkNames(builder, circuit, request)
  for (const component of circuit.components) builder.part(component, models)
  if (builder.refused.length > 0) return { refused: builder.refused }
  const names = groupNames(circuit, builder.groups)
  const roots = [...new Set([...names.keys()])].sort((a, b) => {
    const [na, nb] = [names.get(a), names.get(b)]
    if (na?.named !== nb?.named) return na?.named ? -1 : 1
    return naturalCompare(na?.name ?? a, nb?.name ?? b)
  })
  const nodeOf = new Map<string, number>(roots.map((root, k) => [root, k + 1]))
  const extra: string[] = []
  const node = (net: string): number => {
    const root = builder.groups.find(net)
    let found = nodeOf.get(root)
    if (found === undefined) {
      extra.push(net)
      found = roots.length + extra.length
      nodeOf.set(root, found)
    }
    return found
  }
  const netNodes = new Map<string, number>()
  for (const net of circuit.nets) for (const name of [...net.names, net.id]) netNodes.set(name, node(net.id))
  const sources = setSources(circuit, request, netNodes)
  if ("refused" in sources) return sources
  const elements = builder.drafts.map((draft): Element => {
    switch (draft.kind) {
      case "resistor":
        return { ...draft, a: node(draft.a), b: node(draft.b) }
      case "diode":
        return { ...draft, anode: node(draft.anode), cathode: node(draft.cathode) }
      case "mos":
        return { ...draft, drain: node(draft.drain), gate: node(draft.gate), source: node(draft.source) }
      case "bjt":
        return { ...draft, collector: node(draft.collector), base: node(draft.base), emitter: node(draft.emitter) }
      case "load":
        return { ...draft, node: node(draft.node) }
    }
  })
  const capacitors = builder.capacitors.map((c) => ({ ...c, a: node(c.a), b: node(c.b) }))
  const unmodelled = builder.unmodelled.map((u) => ({ part: u.part, kind: u.kind, power: u.power.map((p) => ({ pin: p.pin, node: node(p.net) })) }))
  const nodes = [...roots.map((root) => names.get(root)?.name ?? root), ...extra]
  const sim: SimCircuit = { nodes, sources: sources.list, elements }
  const parts = builder.parts.map(({ drafts, main, ...part }) => ({ ...part, main, elements: drafts }))
  return { sim, parts, unmodelled, netNodes, floating: floatingNodes(sim), capacitors }
}

/** Each set net as a source; a net named twice with two voltages, or two set nets joined by a short, fight. */
function setSources(circuit: Circuit, request: SimRequest, netNodes: Map<string, number>): { list: SimCircuit["sources"] } | { refused: string[] } {
  const named = circuit.nets.flatMap((net) => net.names)
  const byNode = new Map<number, { name: string; volts: number }>()
  const refused: string[] = []
  for (const [name, volts] of Object.entries(request.set)) {
    const at = netNodes.get(name)
    if (at === undefined) {
      refused.push(`There is no net ${name}; the nets are ${named.slice(0, 12).join(", ")}${named.length > 12 ? ", …" : ""}`)
      continue
    }
    if (volts === "open") continue
    const before = byNode.get(at)
    if (before !== undefined && before.volts !== volts) {
      refused.push(`Sources fight: ${before.name} is set to ${before.volts} V and ${name} to ${volts} V, but they are one node (joined by a wire or a short)`)
      continue
    }
    if (before === undefined) byNode.set(at, { name, volts })
  }
  if (refused.length > 0) return { refused }
  return { list: [...byNode.entries()].map(([node, { name, volts }]) => ({ name, node, volts })) }
}
