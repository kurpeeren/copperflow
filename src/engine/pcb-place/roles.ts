import type { Design } from "../design.js"
import type { Component, Net, Pin } from "../model.js"
import { naturalCompare } from "../order.js"

/** What a part is to the placer: placed first, beside a supply pin, against the edge, or anywhere its nets pull it. */
export type Role = "chip" | "decoupling" | "connector" | "other"

/** One of a part's own pads and the pad of another part it should sit beside (pad indexes in footprint order). */
export interface PadTie {
  pad: number
  ownPad: number
}

/**
 * The part a small part sits beside, and the pads that tie them: a decoupling capacitor's supply pin, a crystal's two
 * pins on a chip (`also` is the second), a load capacitor's crystal pad, a pull-up's chip pin, an LED's pad for its
 * resistor. `part` is placed before it, and it moves with `part` in the refinement.
 */
export interface Beside extends PadTie {
  part: string
  also?: PadTie
}

const CONNECTOR_KINDS = new Set(["pinheader", "connector"])
/** Footprints that are connectors whatever the kind says. A pin row is not one by itself: crystals use them too. */
const CONNECTOR_FOOTPRINT = /connector|header|terminal|usb|jst|screw/i
const SUPPLY_NAME = /^\+?(?:\d+V\d*|V(?:CC|DD|BUS)\w*|[AD]V(?:CC|DD)\w*)$/i
const GROUND_NAME = /^(?:\w*GND\w*|V(?:SS|EE)\w*)$/i
/**
 * A signal net with more pins than this is a bus or a shared line, not one pin's own wire. A crystal net carries the
 * chip pin, the crystal, its load capacitor, and often a feedback resistor and a test point: 5. Six leaves one more
 * for a damping resistor; seven or more pins (an SPI clock to several chips, a reset bus) is shared, and its parts
 * are placed by their wiring like any other.
 */
export const SATELLITE_NET_PINS = 6
/** Parts a load capacitor sits beside before any other part across the same two chip pins. */
const OSCILLATOR_KINDS = new Set(["crystal", "resonator"])
/** Parts an LED's (or diode's) series resistor sits beside when no chip pin is on the net. */
const LIGHT_KINDS = new Set(["led", "diode"])

export const isConnector = (c: Component): boolean => CONNECTOR_KINDS.has(c.kind) || CONNECTOR_FOOTPRINT.test(c.footprint ?? "")

/** The last segment of each name: "PS1/VCC" is a VCC. */
const shortNames = (net: Net): string[] => net.names.map((n) => n.split("/").pop() as string)

const POWER_TYPES: ReadonlySet<Pin["type"]> = new Set(["power_in", "power_out", "ground"])

/** A supply or ground net: a pin on it takes or gives power, or a name reads like one (VCC, 5V, GND, VSS). */
export function isPowerNet(net: Net, typeOf: (pin: string) => Pin["type"] | undefined): boolean {
  return net.pins.some((pin) => POWER_TYPES.has(typeOf(pin) as Pin["type"])) || shortNames(net).some((n) => SUPPLY_NAME.test(n) || GROUND_NAME.test(n))
}

/** What `roles` reads: each part's role, and the part (and pads) it sits beside. */
export interface Roles {
  role: (part: string) => Role
  beside: (part: string) => Beside | undefined
}

/**
 * Reads which parts are chips, connectors and decoupling capacitors, and which pins the small parts sit beside:
 * decoupling capacitors their supply pin, then (in name order) every other two-pin part whose nets tie it to one
 * chip, the crystals first so their load capacitors sit beside the crystal rather than the chip.
 */
export function roles(design: Design): Roles {
  const { components, nets } = design.circuit
  const pinById = new Map(components.flatMap((c) => c.pins.map((p) => [p.id, p] as const)))
  const netOfPin = new Map(nets.flatMap((n) => n.pins.map((pin) => [pin, n] as const)))
  const byId = new Map(components.map((c) => [c.id, c]))
  const hasType = (net: Net, type: Pin["type"]) => net.pins.some((id) => pinById.get(id)?.type === type)
  const isSupply = (net: Net) => !isGround(net) && (hasType(net, "power_in") || shortNames(net).some((n) => SUPPLY_NAME.test(n)))
  const isGround = (net: Net) => hasType(net, "ground") || shortNames(net).some((n) => GROUND_NAME.test(n))
  const padsOf = new Map(design.pcb.parts.map((p) => [p.component, p.pads]))
  const padIndex = (part: string, pin: string) => padsOf.get(part)?.findIndex((pad) => pad.pin === pin) ?? -1
  const sorted = [...components].sort((a, b) => naturalCompare(a.id, b.id))

  /** The capacitor's pin on a supply net when its other pin is on ground. */
  const supplyPin = (c: Component): Pin | undefined => {
    if (c.kind !== "capacitor" || c.pins.length !== 2) return undefined
    const [a, b] = c.pins.map((p) => netOfPin.get(p.id))
    if (!a || !b) return undefined
    if (isSupply(a) && isGround(b)) return c.pins[0]
    if (isSupply(b) && isGround(a)) return c.pins[1]
    return undefined
  }

  const decoupling = new Map<string, Beside>()
  const load = new Map<string, number>()
  for (const cap of sorted) {
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
    decoupling.set(cap.id, { part: pin.component, pad: padIndex(pin.component, pin.id), ownPad: padIndex(cap.id, own.id) })
  }

  const isChip = (part: string) => byId.get(part)?.kind === "chip"
  /** A small part that may hang on a pin: two pins, no connector or chip, not a decoupling capacitor. */
  const small = (c: Component) => c.pins.length === 2 && !isConnector(c) && c.kind !== "chip" && !decoupling.has(c.id)
  /** The pins on the part's own short signal net other than its own, when it has one there. */
  const signalPeers = (pin: Pin): Pin[] => {
    const net = netOfPin.get(pin.id)
    if (!net || isSupply(net) || isGround(net) || net.pins.length > SATELLITE_NET_PINS) return []
    return net.pins.flatMap((id) => {
      const p = pinById.get(id)
      return p && p.component !== pin.component && padIndex(p.component, p.id) >= 0 ? [p] : []
    })
  }
  const tie = (own: Pin, host: Pin): PadTie & { part: string } => ({ part: host.component, pad: padIndex(host.component, host.id), ownPad: padIndex(own.component, own.id) })
  /** The one chip pin among `peers`, when exactly one chip is there. */
  const chipPin = (peers: readonly Pin[]): Pin | undefined => {
    const chips = peers.filter((p) => isChip(p.component))
    return new Set(chips.map((p) => p.component)).size === 1 ? chips[0] : undefined
  }

  const satellites = new Map<string, Beside>()
  // Two pins on one chip's two signal pins: a crystal or resonator (or a part like it) across them.
  for (const c of sorted.filter(small)) {
    const [a, b] = c.pins as [Pin, Pin]
    const [ha, hb] = [chipPin(signalPeers(a)), chipPin(signalPeers(b))]
    if (!ha || !hb || ha.component !== hb.component || ha.id === hb.id) continue
    const second = tie(b, hb)
    satellites.set(c.id, { ...tie(a, ha), also: { pad: second.pad, ownPad: second.ownPad } })
  }
  // One pin on a short signal net: beside a crystal pad there, else the one chip pin there, else an LED's pad.
  for (const c of sorted.filter((one) => small(one) && !satellites.has(one.id))) {
    const choices = c.pins.flatMap((own) => {
      const peers = signalPeers(own)
      // Across two chip pins: a crystal or resonator first, so a feedback resistor across the same pins is not taken for it.
      const across = peers.filter((p) => satellites.get(p.component)?.also !== undefined)
      const crystal = across.find((p) => OSCILLATOR_KINDS.has(byId.get(p.component)?.kind ?? "")) ?? across[0]
      const chip = chipPin(peers)
      const light = LIGHT_KINDS.has(c.kind) ? undefined : peers.length === 1 ? peers.find((p) => LIGHT_KINDS.has(byId.get(p.component)?.kind ?? "")) : undefined
      const host = crystal ?? chip ?? light
      return host ? [{ own, host, rank: crystal ? 0 : chip ? 1 : 2 }] : []
    })
    const hosts = new Set(choices.map((one) => one.host.component))
    const best = [...choices].sort((x, y) => x.rank - y.rank)[0]
    // Tied to two different chips (a series resistor between them): it belongs to neither.
    if (!best || (best.rank === 1 && [...hosts].filter(isChip).length > 1)) continue
    satellites.set(c.id, tie(best.own, best.host))
  }

  const role = (part: string): Role => {
    const c = byId.get(part)
    if (!c) return "other"
    if (isConnector(c)) return "connector"
    if (decoupling.has(part)) return "decoupling"
    return c.kind === "chip" ? "chip" : "other"
  }
  return { role, beside: (part) => decoupling.get(part) ?? satellites.get(part) }
}
