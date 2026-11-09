// Chains of the parts no chip claims: two-pin parts joined end to end, by a trace of their own or by a net of
// just the two pins, line up left to right as a person draws a series chain. Every other part is a chain of one.
import type { Circuit, Component, Pin, Side } from "./model.js"
import { naturalCompare } from "./order.js"
import type { SchSymbol } from "./symbols/index.js"

type Symbols = ReadonlyMap<string, SchSymbol>

/** One part of a chain, turned so that its joined pins face its neighbours. */
export interface Link {
  part: Component
  rotation: 0 | 180
}

/** A two-pin symbol drawn horizontally, its pins level and either side of the origin. */
export function isPair(symbol: SchSymbol | undefined): boolean {
  const [a, b] = symbol?.pins ?? []
  if (!symbol || symbol.pins.length !== 2 || !a || !b) return false
  return a.end.y === 0 && b.end.y === 0 && a.end.x === -b.end.x && a.side !== b.side
}

/** Pins joined to each pin by a trace between the two or by a net of only the two, in natural order. */
function partnersOf(circuit: Circuit): Map<string, string[]> {
  const partners = new Map<string, Set<string>>()
  const link = (a: string, b: string): void => {
    partners.set(a, (partners.get(a) ?? new Set()).add(b))
    partners.set(b, (partners.get(b) ?? new Set()).add(a))
  }
  for (const { from, to } of circuit.connections) if (!from.startsWith("net.") && !to.startsWith("net.")) link(from, to)
  for (const net of circuit.nets) {
    const [a, b] = net.pins
    if (net.pins.length === 2 && a !== undefined && b !== undefined) link(a, b)
  }
  return new Map([...partners].map(([pin, set]) => [pin, [...set].sort(naturalCompare)]))
}

const MIRROR: Readonly<Record<Side, Side>> = { left: "right", right: "left", top: "top", bottom: "bottom" }
const facing = (side: Side, rotation: 0 | 180): Side => (rotation === 0 ? side : MIRROR[side])

interface Chaining {
  symbols: Symbols
  partners: ReadonlyMap<string, readonly string[]>
  owners: ReadonlyMap<string, Component>
  used: Set<string>
}

/** The part's pin that faces `side` when the part is turned by `rotation`. */
export function pinFacing(part: Component, side: Side, rotation: 0 | 180, symbols: Symbols): Pin | undefined {
  const out = symbols.get(part.id)?.pins.find((pin) => facing(pin.side, rotation) === side)
  return out && part.pins.find((pin) => pin.number === out.number)
}

/** The two outer pins of a chain, left end first; a lone part that is not a pair gives its pins when it has two. */
export function chainEnds(chain: readonly Link[], symbols: Symbols): Pin[] | undefined {
  const [first, last] = [chain[0], chain[chain.length - 1]]
  if (!first || !last) return undefined
  if (!isPair(symbols.get(first.part.id))) return chain.length === 1 && first.part.pins.length === 2 ? [...first.part.pins] : undefined
  const ends = [pinFacing(first.part, "left", first.rotation, symbols), pinFacing(last.part, "right", last.rotation, symbols)]
  return ends.every((pin) => pin !== undefined) ? (ends as Pin[]) : undefined
}

/** The chain turned end for end. */
export const reversed = (chain: readonly Link[]): Link[] => [...chain].reverse().map((link) => ({ ...link, rotation: link.rotation === 0 ? 180 : 0 }))

/**
 * A pin joined to this one whose part is a free two-pin part, and that part. Parts named after `from` come first,
 * nearest name first, since chains are mostly numbered along their length (R1, R2, R3); then the rest by name.
 */
function freePartner(pin: string | undefined, from: string, chaining: Chaining): { owner: Component; pin: string } | undefined {
  const found = ((pin === undefined ? undefined : chaining.partners.get(pin)) ?? []).flatMap((partner) => {
    const owner = chaining.owners.get(partner)
    return owner && !chaining.used.has(owner.id) && isPair(chaining.symbols.get(owner.id)) ? [{ owner, pin: partner }] : []
  })
  return found.find((candidate) => naturalCompare(candidate.owner.id, from) > 0) ?? found[0]
}

/** The free two-pin part joined to the link's right-facing pin, turned so the joined pin faces left. */
function nextLink(link: Link, chaining: Chaining): Link | undefined {
  const found = freePartner(pinFacing(link.part, "right", link.rotation, chaining.symbols)?.id, link.part.id, chaining)
  if (!found) return undefined
  const number = found.owner.pins.find((pin) => pin.id === found.pin)?.number
  const side = chaining.symbols.get(found.owner.id)?.pins.find((pin) => pin.number === number)?.side
  return { part: found.owner, rotation: side === "left" ? 0 : 180 }
}

/** A part that can start a chain: one end joined to no free two-pin part, turned so that end faces left. */
function headOf(part: Component, chaining: Chaining): Link | undefined {
  if (!isPair(chaining.symbols.get(part.id))) return { part, rotation: 0 }
  if (!freePartner(pinFacing(part, "left", 0, chaining.symbols)?.id, part.id, chaining)) return { part, rotation: 0 }
  if (!freePartner(pinFacing(part, "right", 0, chaining.symbols)?.id, part.id, chaining)) return { part, rotation: 180 }
  return undefined
}

/** The first free part, in name order, that can start a chain as it stands; else the first that can turned round. */
function firstHead(free: readonly Component[], chaining: Chaining): Link | undefined {
  let turned: Link | undefined
  for (const part of free) {
    const head = headOf(part, chaining)
    if (head?.rotation === 0) return head
    turned ??= head
  }
  return turned
}

/** The chain from `head`, grown to the right while a free two-pin part joins its last link. */
function chainFrom(head: Link, chaining: Chaining): Link[] {
  chaining.used.add(head.part.id)
  const chain: Link[] = [head]
  if (!isPair(chaining.symbols.get(head.part.id))) return chain
  for (let next = nextLink(head, chaining); next; next = nextLink(next, chaining)) {
    chaining.used.add(next.part.id)
    chain.push(next)
  }
  return chain
}

/**
 * The parts as chains. Each chain starts at the first free part that can start one (firstHead); when only loops
 * are left, at the first free part.
 */
export function chainsOf(rest: readonly Component[], circuit: Circuit, symbols: Symbols): Link[][] {
  const owners = new Map(rest.flatMap((part) => part.pins.map((pin) => [pin.id, part] as const)))
  const chaining: Chaining = { symbols, partners: partnersOf(circuit), owners, used: new Set() }
  const chains: Link[][] = []
  for (let free = rest; free.length > 0; free = free.filter((part) => !chaining.used.has(part.id))) {
    chains.push(chainFrom(firstHead(free, chaining) ?? { part: free[0] as Component, rotation: 0 }, chaining))
  }
  return chains
}
