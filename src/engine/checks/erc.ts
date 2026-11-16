import type { Circuit, Component, Net, Pin, PinType, Point } from "../model.js"
import { flaggedPinSet } from "../no-connect.js"
import { naturalCompare } from "../order.js"
import type { SchematicLayout } from "../schematic.js"
import type { Rules } from "../rules/schema.js"
import { violation, type Violation } from "./violation.js"

/**
 * Electrical rule checks on the connections: floating pins, wired no-connect pins, outputs driving
 * the same net, power inputs nothing supplies, and named nets with one pin.
 */

const ERROR_WHEN_UNCONNECTED: ReadonlySet<PinType> = new Set(["power_in", "ground", "input"])
const DRIVERS: ReadonlySet<PinType> = new Set(["output", "power_out"])
/** Parts that bring power in from outside the board. */
const SUPPLY_KINDS: ReadonlySet<string> = new Set(["connector", "pinheader", "battery"])

/** Everything a check looks up: pins, the part each belongs to, the net each is on, and where it is drawn. */
interface Context {
  pins: Pin[]
  kindOf: Map<string, string>
  netOf: Map<string, Net>
  ends: Map<string, Point>
  globalNets: ReadonlySet<string>
  /** The pins a no connect flag marks (no-connect.ts): meant to stay unconnected, as a no_connect pin is. */
  flagged: ReadonlySet<string>
  /** By net id: the typed ports of instances on it, each a pin "<instance>.<port>" of its port's type. */
  portPins: Map<string, Pin[]>
  /** By part id: the instance it is in. */
  instanceOf: Map<string, string>
}

/** Each sub-sheet instance's typed ports as pins of the net they join, so a check sees across blocks; passive ones add nothing. */
function portPinsOf(circuit: Circuit): Map<string, Pin[]> {
  const byName = new Map(circuit.nets.flatMap((net) => net.names.map((name): [string, Net] => [name, net])))
  const found = new Map<string, Pin[]>()
  for (const instance of circuit.instances ?? []) {
    for (const port of instance.ports) {
      const net = byName.get(port.net)
      if (port.bus || !port.type || port.type === "passive" || !net) continue
      const pin: Pin = { id: `${instance.path}.${port.name}`, component: instance.path, number: 0, names: [port.name], type: port.type }
      found.set(net.id, [...(found.get(net.id) ?? []), pin])
    }
  }
  return found
}

function contextOf(circuit: Circuit, schematic: SchematicLayout, rules: Rules): Context {
  const pins = circuit.components.flatMap((c: Component) => c.pins)
  const kindOf = new Map(pins.map((p) => [p.id, circuit.components.find((c) => c.id === p.component)?.kind ?? ""]))
  const netOf = new Map(circuit.nets.flatMap((net) => net.pins.map((pin): [string, Net] => [pin, net])))
  const ends = new Map(schematic.symbols.flatMap((s) => Object.entries(s.pinEnds)))
  const instanceOf = new Map(circuit.components.flatMap((c): [string, string][] => (c.instance ? [[c.id, c.instance]] : [])))
  return { pins, kindOf, netOf, ends, globalNets: new Set(rules.globalNets), flagged: flaggedPinSet(circuit.components), portPins: portPinsOf(circuit), instanceOf }
}

/** "U1.pin3 (EN)": the pin id and its first name beyond pin<n>, when it has one. */
function describePin(pin: Pin): string {
  const name = pin.names[1]
  return name === undefined ? pin.id : `${pin.id} (${name})`
}

const netLabel = (net: Net) => net.names[0] ?? net.id

/** The position to point at: the pin's end when exactly one pin is involved, else none. */
function singleAt(context: Context, pinIds: readonly string[]): Point | undefined {
  return pinIds.length === 1 ? context.ends.get(pinIds[0] as string) : undefined
}

function pinsOn(context: Context, net: Net): Pin[] {
  const wanted = new Set(net.pins)
  return context.pins.filter((p) => wanted.has(p.id))
}

// ---- pins ----

/** True when the pin shares its net with no other pin, or is on no net at all. */
const isAlone = (context: Context, pin: Pin) => (context.netOf.get(pin.id)?.pins.length ?? 1) <= 1

function unconnectedPin(context: Context, pin: Pin): Violation[] {
  if (pin.type === "no_connect" || context.flagged.has(pin.id) || !isAlone(context, pin)) return []
  const severity = ERROR_WHEN_UNCONNECTED.has(pin.type) ? "error" : "warning"
  return [violation("pin-unconnected", severity, `${describePin(pin)} is not connected`, [pin.id], "schematic", context.ends.get(pin.id))]
}

function connectedNoConnect(context: Context, pin: Pin): Violation[] {
  const flagged = context.flagged.has(pin.id)
  if ((pin.type !== "no_connect" && !flagged) || isAlone(context, pin)) return []
  const why = flagged ? "has a no connect flag" : "must stay unconnected"
  return [violation("nc-connected", "error", `${describePin(pin)} ${why} but is wired to other pins`, [pin.id], "schematic", context.ends.get(pin.id))]
}

// ---- nets ----

/** Each `output` pin is a source; all `power_out` pins of one component are one, as paralleled supply pins. */
function sourceCount(drivers: readonly Pin[]): number {
  const outputs = drivers.filter((p) => p.type === "output").length
  const supplies = new Set(drivers.filter((p) => p.type === "power_out").map((p) => p.component))
  return outputs + supplies.size
}

/** The pins and typed instance ports on a net. */
const allOn = (context: Context, net: Net): Pin[] => [...pinsOn(context, net), ...(context.portPins.get(net.id) ?? [])]

/** Whether a pin is inside an instance at `path`: a part in it, or a port of an instance in it. */
function inside(context: Context, pin: Pin, path: string): boolean {
  // A port's pin is numbered 0 and belongs to its instance; a part's pin belongs to the instance the part is in.
  if (pin.number === 0) return pin.component.startsWith(`${path}/`)
  const owner = context.instanceOf.get(pin.component)
  return owner !== undefined && (owner === path || owner.startsWith(`${path}/`))
}

/** The net's sources: a driving port speaks for what drives the net inside its instance. */
function driversOn(context: Context, net: Net): Pin[] {
  const drivers = allOn(context, net).filter((p) => DRIVERS.has(p.type))
  const ports = drivers.filter((p) => p.number === 0).map((p) => p.component)
  return drivers.filter((p) => !ports.some((path) => inside(context, p, path)))
}

function outputConflict(context: Context, net: Net): Violation[] {
  const drivers = driversOn(context, net)
  if (sourceCount(drivers) < 2) return []
  const ids = drivers.map((p) => p.id)
  const message = `net ${netLabel(net)} is driven by more than one output: ${ids.join(", ")}`
  return [violation("output-conflict", "error", message, ids, "schematic", singleAt(context, ids))]
}

function hasSource(context: Context, net: Net, pins: readonly Pin[]): boolean {
  if (net.names.some((name) => context.globalNets.has(name))) return true
  return pins.some((p) => p.type === "power_out" || SUPPLY_KINDS.has(context.kindOf.get(p.id) ?? ""))
}

function noPowerSource(context: Context, net: Net): Violation[] {
  const pins = allOn(context, net)
  const inputs = pins.filter((p) => p.type === "power_in")
  if (inputs.length === 0 || hasSource(context, net, pins)) return []
  const ids = inputs.map((p) => p.id)
  const message = `net ${netLabel(net)} has a power input but nothing that supplies it`
  return [violation("no-power-source", "warning", message, ids, "schematic", singleAt(context, ids))]
}

function singlePinNet(context: Context, net: Net): Violation[] {
  const [only] = net.pins
  if (net.names.length === 0 || net.pins.length !== 1 || only === undefined) return []
  const message = `net ${netLabel(net)} has only one pin (${only})`
  return [violation("single-pin-net", "warning", message, [net.id], "schematic", context.ends.get(only))]
}

/** Every electrical check on the circuit, sorted by id. Nothing here changes the circuit or the schematic. */
export function electricalChecks(circuit: Circuit, schematic: SchematicLayout, rules: Rules): Violation[] {
  const context = contextOf(circuit, schematic, rules)
  const found = [
    ...context.pins.flatMap((pin) => [...unconnectedPin(context, pin), ...connectedNoConnect(context, pin)]),
    ...circuit.nets.flatMap((net) => [...outputConflict(context, net), ...noPowerSource(context, net), ...singlePinNet(context, net)]),
  ]
  return found.sort((a, b) => naturalCompare(a.id, b.id))
}
