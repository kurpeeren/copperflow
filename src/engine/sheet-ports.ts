// A sub-sheet's ports as its file writes them: `<port name side order bus />`, and the symbol size `<sheet width height>`.
// Each port gets a place on the sheet symbol: the side and order written, else the defaults (inputs and power left,
// outputs right, ground bottom, in source order). The geometry of the symbol is sheet-symbol.ts.
import { diagnostic } from "./diagnostics.js"
import { busMembers } from "./drawing-kinds.js"
import { isElement, type CfElement } from "./jsx-runtime.js"
import type { Diagnostic, PinType, SheetCard, SheetSize, Side, SourceRef } from "./model.js"
import { labelStyle } from "./schematic-nets.js"
import { NET_NAME } from "./selectors.js"

export const PORT_SIDES: readonly Side[] = ["left", "right", "top", "bottom"]
/** The pin types a port may be: the instance's pin is of that type. */
export const PORT_TYPES: readonly PinType[] = ["power_in", "power_out", "ground", "input", "output", "bidirectional", "passive"]
/** The longest `does`, `carries` and source a card holds, and how many sources. */
export const CARD_LIMITS = { does: 160, carries: 80, source: 200, sources: 8 } as const

const WHOLE_NET_NAME = new RegExp(`^${NET_NAME.source}$`)
/** A name an output is known by: OUT, VOUT, DOUT, OUT1, TX_OUT. */
const OUTPUT_NAME = /OUT/i

/** One `<port>` as written. `side` and `order` are absent when not written (or written badly). */
export interface WrittenPort {
  name: string
  side?: Side
  order?: number
  /** A bus port: its name is a bus name ("D[0:7]" or a plain net name) and it joins the bus's members by name. */
  bus: boolean
  type?: PinType
  carries?: string
}

/** A port with its place on the symbol: the side, and the 1-based slot along it, from the top or from the left. */
export interface PlacedPortSpec extends WrittenPort {
  side: Side
  order: number
}

/** Whether a port name is usable: a net name, or for a bus port a bus name too. */
export function portNameOk(name: unknown, bus: boolean): name is string {
  if (typeof name !== "string") return false
  return bus ? busMembers(name) !== undefined : WHOLE_NET_NAME.test(name)
}

/** The nets a bus port joins, by name: "D[0:7]" is D0 … D7. */
export const portMembers = (port: Pick<WrittenPort, "name" | "bus">): string[] => (port.bus ? (busMembers(port.name) ?? []) : [])

/** The side a port goes to when it writes none: ground at the bottom, outputs right, inputs and power left. */
export function defaultPortSide(name: string): Side {
  if (labelStyle(name) === "ground") return "bottom"
  return OUTPUT_NAME.test(name) ? "right" : "left"
}

function readOne(element: CfElement, at: SourceRef, found: Diagnostic[]): WrittenPort | undefined {
  const { name, side, order, bus, type, carries } = element.props
  const isBus = bus === true
  const bad = (what: string, item: string) => found.push(diagnostic("bad-value", "error", what, [item], at))
  if (bus !== undefined && typeof bus !== "boolean") bad(`<port> bus must be true or false; it is read as false`, "port.bus")
  if (!portNameOk(name, isBus)) {
    const wanted = isBus ? `a bus name such as "D[0:7]" or "DATA"` : `a name made of letters, digits, "_" and "-"`
    bad(`<port> needs ${wanted}; it is ignored`, "port")
    return undefined
  }
  const port: WrittenPort = { name, bus: isBus }
  if (side !== undefined) {
    if (typeof side === "string" && (PORT_SIDES as readonly string[]).includes(side)) port.side = side as Side
    else bad(`Port ${name}: side must be one of ${PORT_SIDES.join(", ")}; the default side is used`, `${name}.side`)
  }
  if (order !== undefined) {
    if (typeof order === "number" && Number.isInteger(order) && order > 0) port.order = order
    else bad(`Port ${name}: order must be a whole number above 0; the next free place is used`, `${name}.order`)
  }
  if (type !== undefined) {
    if (typeof type === "string" && (PORT_TYPES as readonly string[]).includes(type)) port.type = type as PinType
    else bad(`Port ${name}: type must be one of ${PORT_TYPES.join(", ")}; it is read as passive`, `${name}.type`)
  }
  if (carries !== undefined) {
    if (typeof carries === "string" && carries.trim() !== "" && carries.length <= CARD_LIMITS.carries) port.carries = carries
    else bad(`Port ${name}: carries must be a text of at most ${CARD_LIMITS.carries} characters; it is ignored`, `${name}.carries`)
  }
  return port
}

/** What a `<sheet does sources>` says of itself; a bad one is an error and left out. */
export function readSheetCard(props: Readonly<Record<string, unknown>>, sheet: string, at: SourceRef): { card: SheetCard; diagnostics: Diagnostic[] } {
  const card: SheetCard = {}
  const diagnostics: Diagnostic[] = []
  const bad = (what: string, item: string) => diagnostics.push(diagnostic("bad-value", "error", `${sheet}: <sheet> ${what}; it is ignored`, [`${sheet}.${item}`], at))
  const { does, sources } = props
  if (does !== undefined) {
    if (typeof does === "string" && does.trim() !== "" && does.length <= CARD_LIMITS.does) card.does = does
    else bad(`does must be a text of at most ${CARD_LIMITS.does} characters`, "does")
  }
  if (sources !== undefined) {
    const ok = (item: unknown) => typeof item === "string" && item.trim() !== "" && item.length <= CARD_LIMITS.source
    if (Array.isArray(sources) && sources.length <= CARD_LIMITS.sources && sources.every(ok)) card.sources = [...(sources as string[])]
    else bad(`sources must be a list of at most ${CARD_LIMITS.sources} texts of at most ${CARD_LIMITS.source} characters`, "sources")
  }
  return { card, diagnostics }
}

/**
 * The `<port>` elements of a sheet in the order written, each name once, with their diagnostics. Components inside
 * are not entered. A bad port is an error and left out.
 */
export function readPorts(children: readonly unknown[], source: (element: CfElement) => SourceRef): { ports: WrittenPort[]; diagnostics: Diagnostic[] } {
  const ports: WrittenPort[] = []
  const diagnostics: Diagnostic[] = []
  const walk = (nodes: readonly unknown[]): void => {
    for (const node of nodes) {
      if (!isElement(node) || typeof node.type !== "string") continue
      if (node.type === "port") {
        const port = readOne(node, source(node), diagnostics)
        if (port && !ports.some((known) => known.name === port.name)) ports.push(port)
      }
      walk(node.children)
    }
  }
  walk(children)
  return { ports, diagnostics }
}

/** The symbol size a `<sheet>` writes: each a number above 0, in sheet units; a bad one is an error and the default is used. */
export function readSheetSize(props: Readonly<Record<string, unknown>>, sheet: string, at: SourceRef): { size: SheetSize; diagnostics: Diagnostic[] } {
  const size: SheetSize = {}
  const diagnostics: Diagnostic[] = []
  for (const key of ["width", "height"] as const) {
    const value = props[key]
    if (value === undefined) continue
    if (typeof value === "number" && Number.isFinite(value) && value > 0) size[key] = value
    else diagnostics.push(diagnostic("bad-value", "error", `${sheet}: <sheet> ${key} must be a number above 0; the default is used`, [`${sheet}.${key}`], at))
  }
  return { size, diagnostics }
}

/**
 * Every port's place on the symbol. A written side and order are kept; a port without an order takes the first free
 * slot on its side, in source order. Two ports written at one place are an error, and the later one moves to the next
 * free slot.
 */
export function placePorts(ports: readonly WrittenPort[], sheet: string, at?: SourceRef): { ports: PlacedPortSpec[]; diagnostics: Diagnostic[] } {
  const taken = new Map<Side, Set<number>>(PORT_SIDES.map((side) => [side, new Set<number>()]))
  const diagnostics: Diagnostic[] = []
  const sideOf = (port: WrittenPort): Side => port.side ?? defaultPortSide(port.name)
  const orders = new Map<string, number>()
  for (const port of ports) {
    if (port.order === undefined) continue
    const slots = taken.get(sideOf(port)) as Set<number>
    if (!slots.has(port.order)) {
      slots.add(port.order)
      orders.set(port.name, port.order)
      continue
    }
    const message = `${sheet}: port ${port.name} is at ${sideOf(port)} ${port.order}, where another port is; it moves to the next free place`
    diagnostics.push(diagnostic("port-place", "error", message, [`${sheet}.${port.name}`], at))
  }
  const placed = ports.map((port): PlacedPortSpec => {
    const side = sideOf(port)
    const slots = taken.get(side) as Set<number>
    let order = orders.get(port.name)
    if (order === undefined) {
      order = 1
      while (slots.has(order)) order++
      slots.add(order)
    }
    return { ...port, side, order }
  })
  return { ports: placed, diagnostics }
}
