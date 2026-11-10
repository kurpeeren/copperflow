import type { Net } from "../model.js"
import type { PcbLayout, WorldPad } from "../pcb.js"
import { netClasses } from "../rules/classes.js"
import { DEFAULT_CLASS } from "../rules/profiles.js"
import type { Rules } from "../rules/schema.js"
import { trackWidth, viaSize } from "../rules/track-defaults.js"
import { searchPath, type SearchOptions } from "./astar.js"
import { endCells, joinedTo } from "./ends.js"
import { rasterise, type NetRule } from "./grid.js"
import { pathCopper, type RoutedCopper } from "./path.js"

/** What the router reads: the built layout, the rules and the circuit's nets. */
export interface RouteInput {
  layout: PcbLayout
  rules: Rules
  nets: readonly Net[]
}

export type ConnectionResult = { routed: true; copper: RoutedCopper; cost: number } | { routed: false; reason: string; blockers: string[] }

const listed = (words: readonly string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`)
const failed = (reason: string, blockers: string[] = []): ConnectionResult => ({ routed: false, reason, blockers })

/** A net's class by net id, as the copper checks see it: no net or an unclaimed one is the default class. */
export function classLookup(rules: Rules, nets: readonly Net[]): (net: string | undefined) => string {
  const byNet = netClasses(rules, nets).byNet
  return (net) => (net === undefined ? DEFAULT_CLASS.name : (byNet.get(net) ?? DEFAULT_CLASS.name))
}

/** The track width and via a net is routed with: its class's, raised to the fabrication minimums, as for hand-drawn copper. */
export function netRule(rules: Rules, nets: readonly Net[], netId: string): NetRule {
  const net: Net = nets.find((one) => one.id === netId) ?? { id: netId, names: [], pins: [] }
  return { net: netId, className: classLookup(rules, nets)(netId), width: trackWidth(rules, net), via: viaSize(rules, net) }
}

const padName = (pad: WorldPad) => pad.pin ?? pad.id

function why(from: WorldPad, to: WorldPad, blockers: readonly string[], reason: "no-path" | "limit", expanded: number): string {
  const ends = `could not route ${padName(from)} to ${padName(to)}`
  if (reason === "limit") return `${ends}: the search gave up after ${expanded} steps`
  if (blockers.length === 0) return `${ends}: no room`
  return blockers.length === 1 ? `${ends}: no way past ${blockers[0]}` : `${ends}: no room between ${listed(blockers)}`
}

/**
 * Routes one connection of a net: from the pad `fromId` (and the copper already joined to it) to the pad `toId` (and
 * its copper), on the board's layers, around everything of other nets. The result is the copper to lay, or why
 * there is none, naming the objects that closed the way.
 */
export function routeConnection(input: RouteInput, fromId: string, toId: string, options: SearchOptions = {}): ConnectionResult {
  const pads = input.layout.parts.flatMap((part) => part.pads)
  const [from, to] = [pads.find((pad) => pad.id === fromId), pads.find((pad) => pad.id === toId)]
  if (from === undefined || to === undefined) return failed(`no pad ${from === undefined ? fromId : toId}`)
  if (from.net === undefined || from.net !== to.net) return failed(`${padName(from)} and ${padName(to)} are not on one net`)
  const rule = netRule(input.rules, input.nets, from.net)
  const grid = rasterise(input.layout, input.rules, classLookup(input.rules, input.nets), rule)
  const [start, end] = [joinedTo(input.layout, fromId), joinedTo(input.layout, toId)]
  if (start.some((piece) => piece.id === toId)) return failed(`${padName(from)} and ${padName(to)} are already connected`)
  const [sources, targets] = [endCells(grid, start), endCells(grid, end)]
  for (const [pad, cells] of [[from, sources], [to, targets]] as const) {
    if (cells.length === 0) return failed(`could not route ${padName(from)} to ${padName(to)}: ${padName(pad)} has no free grid cell`)
  }
  const result = searchPath(grid, sources, targets, options)
  if (!result.found) return failed(why(from, to, result.blockers, result.reason, result.expanded), result.blockers)
  return { routed: true, copper: pathCopper(grid, result.steps, rule), cost: result.cost }
}
