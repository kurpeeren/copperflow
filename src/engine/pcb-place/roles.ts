import type { Design } from "../design.js"
import type { Component, Net, Pin } from "../model.js"
import { naturalCompare } from "../order.js"

/** What a part is to the placer: placed first, beside a supply pin, against the edge, or anywhere its nets pull it. */
export type Role = "chip" | "decoupling" | "connector" | "other"

/** A decoupling capacitor's supply pin: the part and the index of its pad, and the capacitor's own pad on that net. */
export interface Decoupling {
  part: string
  pad: number
  ownPad: number
}

const CONNECTOR_KINDS = new Set(["pinheader", "connector"])
/** Footprints that are connectors whatever the kind says. A pin row is not one by itself: crystals use them too. */
const CONNECTOR_FOOTPRINT = /connector|header|terminal|usb|jst|screw/i
const SUPPLY_NAME = /^\+?(?:\d+V\d*|V(?:CC|DD|BUS)\w*|[AD]V(?:CC|DD)\w*)$/i
const GROUND_NAME = /^(?:\w*GND\w*|V(?:SS|EE)\w*)$/i

export const isConnector = (c: Component): boolean => CONNECTOR_KINDS.has(c.kind) || CONNECTOR_FOOTPRINT.test(c.footprint ?? "")

/** The last segment of each name: "PS1/VCC" is a VCC. */
const shortNames = (net: Net): string[] => net.names.map((n) => n.split("/").pop() as string)

/** Reads which parts are chips, connectors and decoupling capacitors, and which supply pin each capacitor decouples. */
export function roles(design: Design): { role: (part: string) => Role; decouples: (part: string) => Decoupling | undefined } {
  const { components, nets } = design.circuit
  const pinById = new Map(components.flatMap((c) => c.pins.map((p) => [p.id, p] as const)))
  const netOfPin = new Map(nets.flatMap((n) => n.pins.map((pin) => [pin, n] as const)))
  const hasType = (net: Net, type: Pin["type"]) => net.pins.some((id) => pinById.get(id)?.type === type)
  const isSupply = (net: Net) => !isGround(net) && (hasType(net, "power_in") || shortNames(net).some((n) => SUPPLY_NAME.test(n)))
  const isGround = (net: Net) => hasType(net, "ground") || shortNames(net).some((n) => GROUND_NAME.test(n))
  const padsOf = new Map(design.pcb.parts.map((p) => [p.component, p.pads]))
  const padIndex = (part: string, pin: string) => padsOf.get(part)?.findIndex((pad) => pad.pin === pin) ?? -1

  /** The capacitor's pin on a supply net when its other pin is on ground. */
  const supplyPin = (c: Component): Pin | undefined => {
    if (c.kind !== "capacitor" || c.pins.length !== 2) return undefined
    const [a, b] = c.pins.map((p) => netOfPin.get(p.id))
    if (!a || !b) return undefined
    if (isSupply(a) && isGround(b)) return c.pins[0]
    if (isSupply(b) && isGround(a)) return c.pins[1]
    return undefined
  }

  const assigned = new Map<string, Decoupling>()
  const load = new Map<string, number>()
  for (const cap of [...components].sort((a, b) => naturalCompare(a.id, b.id))) {
    const own = supplyPin(cap)
    if (!own) continue
    const net = netOfPin.get(own.id) as Net
    const candidates = net.pins
      .map((id) => pinById.get(id))
      .filter((p): p is Pin => p !== undefined && p.type === "power_in" && p.component !== cap.id)
      .sort((x, y) => (load.get(x.id) ?? 0) - (load.get(y.id) ?? 0) || naturalCompare(x.component, y.component) || x.number - y.number)
    const pin = candidates.find((p) => padIndex(p.component, p.id) >= 0)
    if (!pin) continue
    load.set(pin.id, (load.get(pin.id) ?? 0) + 1)
    assigned.set(cap.id, { part: pin.component, pad: padIndex(pin.component, pin.id), ownPad: padIndex(cap.id, own.id) })
  }

  const byId = new Map(components.map((c) => [c.id, c]))
  const role = (part: string): Role => {
    const c = byId.get(part)
    if (!c) return "other"
    if (isConnector(c)) return "connector"
    if (assigned.has(part)) return "decoupling"
    return c.kind === "chip" ? "chip" : "other"
  }
  return { role, decouples: (part) => assigned.get(part) }
}
