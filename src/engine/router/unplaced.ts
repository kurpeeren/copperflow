// The parts nobody has placed yet (auto-placed: the build packed them only to draw them) have no position copper could
// keep: a track to one of their pads would end where the part is not once it is placed, maybe off the board. So the
// router leaves them out: their connections wait (reported as unrouted, with the reason) and their pads are no
// obstacle, as for an instance's own run (route-board blockOnly).
import type { WorldPad } from "../pcb.js"
import { cannot } from "./connect.js"
import type { RouteBoardInput, UnroutedConnection } from "./route-board.js"

const componentOf = (padId: string) => padId.split("#")[0] ?? padId

/** The board without the parts that have no position, and the connections that wait for them. */
export interface WithoutUnplaced {
  input: RouteBoardInput
  /** The connections to an unplaced part, as unrouted connections whose reason names the part. */
  waiting: UnroutedConnection[]
  /** The unplaced parts some connection waits for, in the order first met. */
  parts: string[]
}

/** The reason a connection waits: "could not route J1.TIP to U1.VIN: J1 is not placed". */
function waitingFor(from: WorldPad | undefined, to: WorldPad | undefined, line: { net: string; from: string; to: string }, unplaced: ReadonlySet<string>): UnroutedConnection {
  const parts = [componentOf(line.from), componentOf(line.to)].filter((part, i, all) => unplaced.has(part) && all.indexOf(part) === i)
  const head = from && to ? cannot(from, to) : `could not route ${line.from} to ${line.to}`
  const what = parts.length === 1 ? `${parts[0]} is not placed` : `${parts.join(" and ")} are not placed`
  return { net: line.net, from: line.from, to: line.to, reason: `${head}: ${what}`, blockers: [] }
}

/**
 * Splits off the parts with no position (see the module comment). `inScope` picks the lines the run covers, so only
 * those are reported as waiting. Unchanged when every part has a position.
 */
export function withoutUnplaced(input: RouteBoardInput, inScope: (input: RouteBoardInput) => readonly { net: string; from: string; to: string }[]): WithoutUnplaced {
  const unplaced = new Set(input.layout.parts.filter((part) => part.autoPlaced).map((part) => part.component))
  if (unplaced.size === 0) return { input, waiting: [], parts: [] }
  const touches = (line: { from: string; to: string }) => unplaced.has(componentOf(line.from)) || unplaced.has(componentOf(line.to))
  const pads = new Map(input.layout.parts.flatMap((part) => part.pads).map((pad) => [pad.id, pad]))
  const waiting = inScope(input)
    .filter(touches)
    .map((line) => waitingFor(pads.get(line.from), pads.get(line.to), line, unplaced))
  const parts = [...new Set(waiting.flatMap((one) => [componentOf(one.from), componentOf(one.to)]).filter((part) => unplaced.has(part)))]
  const layout = { ...input.layout, parts: input.layout.parts.filter((part) => !part.autoPlaced), ratsnest: input.layout.ratsnest.filter((line) => !touches(line)) }
  return { input: { ...input, layout }, waiting, parts }
}
