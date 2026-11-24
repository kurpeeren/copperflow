// The findings about a perfboard's or stripboard's paths: nets not joined yet, two nets joined, cuts that part a net
// or sit on a pin, links that are not straight or run over a leg or another link, solder steps that are not to a
// neighbour, and records that do not belong on the board. Pure.
import type { CutRecord, LinkRecord, ProtoRecord, SolderRecord } from "../../core/layout-proto.js"
import { protoWords } from "../../core/layout-proto.js"
import { violation, type Violation } from "../checks/violation.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout, WorldPad } from "../pcb.js"
import { alongStrip, holeKey, holeName, holePoint, linkSpan, neighbours, sameStrip, stripName, type Hole, type ProtoGrid } from "./grid.js"
import { gridHole, protoSets, type HoleSets } from "./joins.js"
import { pinHoles, type PinHole } from "./placement.js"

/** How many pins a message names before it counts the rest. */
const SHOWN = 4

type NameOf = (net: string) => string

const pinOf = (pad: WorldPad) => pad.pin ?? `${pad.component}.pin${pad.number}`

function listed(items: readonly string[]): string {
  const shown = items.slice(0, SHOWN).join(", ")
  return items.length > SHOWN ? `${shown} and ${items.length - SHOWN} more` : shown
}

interface Board {
  grid: ProtoGrid
  sets: HoleSets
  pins: Map<number, PinHole>
  /** The nets of each island's pins, by island. */
  netsOf: Map<number, Map<string, PinHole[]>>
  nameOf: NameOf
}

function islandNets(sets: HoleSets, pins: Map<number, PinHole>): Map<number, Map<string, PinHole[]>> {
  const found = new Map<number, Map<string, PinHole[]>>()
  for (const [key, pin] of pins) {
    if (pin.pad.net === undefined) continue
    const island = sets.find(key)
    const nets = found.get(island) ?? new Map<string, PinHole[]>()
    nets.set(pin.pad.net, [...(nets.get(pin.pad.net) ?? []), pin])
    found.set(island, nets)
  }
  return found
}

/** A net whose pins lie on more than one island: the pins of each piece. */
function openNets(board: Board): Violation[] {
  const pieces = new Map<string, PinHole[][]>()
  for (const nets of board.netsOf.values()) for (const [net, pins] of nets) pieces.set(net, [...(pieces.get(net) ?? []), pins])
  return [...pieces]
    .filter(([, parts]) => parts.length > 1 && parts.flat().length > 1)
    .sort(([a], [b]) => naturalCompare(a, b))
    .map(([net, parts]) => {
      const words = parts.map((pins) => listed(pins.map((one) => pinOf(one.pad)).sort(naturalCompare))).join(" | ")
      const first = parts[0]?.[0]?.pad
      return violation("proto-open", "warning", `net ${board.nameOf(net)} is in ${parts.length} pieces not joined yet: ${words}; run autoroute or add solder or a link`, [net], "pcb", first)
    })
}

/** Whether two holes lie on one strip with no cut between them: the strip is what joins them. */
function stripJoins(board: Board, a: Hole, b: Hole): boolean {
  if (board.grid.kind !== "stripboard") return false
  const along = board.grid.strips === "columns" ? a.col === b.col : a.row === b.row
  return along && board.sets.find(holeKey(board.grid, a)) === board.sets.find(holeKey(board.grid, b))
}

/** An island that joins pins of two or more nets. */
function shorts(board: Board): Violation[] {
  const found: Violation[] = []
  for (const nets of board.netsOf.values()) {
    if (nets.size < 2) continue
    const ordered = [...nets].sort(([a], [b]) => naturalCompare(a, b))
    const [[, pinsA], [, pinsB]] = ordered as [[string, PinHole[]], [string, PinHole[]]]
    const [a, b] = [pinsA[0] as PinHole, pinsB[0] as PinHole]
    const names = ordered.map(([net]) => board.nameOf(net))
    const where = `${pinOf(a.pad)} (${holeName(a.hole)}) and ${pinOf(b.pad)} (${holeName(b.hole)})`
    const fix = stripJoins(board, a.hole, b.hole) ? `${stripName(board.grid, a.hole)} joins them: cut it between the two` : "remove the solder or link that joins them"
    found.push(violation("proto-short", "error", `${names.join(" and ")} are joined: ${where} are on one piece of copper; ${fix}`, [...ordered.map(([net]) => net), a.pad.id], "pcb", a.pad))
  }
  return found
}

/** The nets of the island a hole is on. */
function netsAt(board: Board, hole: Hole): Map<string, PinHole[]> | undefined {
  return board.netsOf.get(board.sets.find(holeKey(board.grid, hole)))
}

/** The holes a cut parts: the neighbours on either side along the strip. */
function cutSides(grid: ProtoGrid, cut: CutRecord): [Hole, Hole] | undefined {
  if (cut.between !== undefined) {
    const [a, b] = cut.between.map((name) => gridHole(grid, name))
    return a && b ? [a, b] : undefined
  }
  const at = cut.at === undefined ? undefined : gridHole(grid, cut.at)
  if (!at) return undefined
  const before = grid.strips === "columns" ? { col: at.col, row: at.row - 1 } : { col: at.col - 1, row: at.row }
  const after = alongStrip(grid, at)
  return before.col >= 0 && before.row >= 0 && after ? [before, after] : undefined
}

function cutFindings(board: Board, cut: CutRecord): Violation[] {
  const { grid } = board
  const where = gridHole(grid, cut.at ?? "")
  if (where && board.pins.has(holeKey(grid, where))) {
    const pin = board.pins.get(holeKey(grid, where)) as PinHole
    return [violation("proto-cut", "error", `${protoWords(cut)} is in the hole of ${pinOf(pin.pad)}; cut beside it instead`, [cut.id], "pcb", holePoint(grid, where))]
  }
  const sides = cutSides(grid, cut)
  if (cut.between !== undefined && sides && !(neighbours(sides[0], sides[1]) && sameStrip(grid, sides[0], sides[1]))) {
    return [violation("proto-cut", "error", `${protoWords(cut)}: the two holes must be neighbours on one strip`, [cut.id], "pcb", holePoint(grid, sides[0]))]
  }
  if (!sides) return cut.at !== undefined && !where ? [violation("proto-record", "warning", `${protoWords(cut)} is outside the board's holes`, [cut.id], "pcb")] : []
  const [left, right] = [netsAt(board, sides[0]), netsAt(board, sides[1])]
  const shared = [...(left?.keys() ?? [])].filter((net) => right?.has(net))
  if (shared.length === 0 || board.sets.find(holeKey(grid, sides[0])) === board.sets.find(holeKey(grid, sides[1]))) return []
  const net = shared[0] as string
  const pins = [left?.get(net)?.[0], right?.get(net)?.[0]].map((one) => (one ? pinOf(one.pad) : "?"))
  return [violation("proto-cut-splits", "error", `${protoWords(cut)} parts net ${board.nameOf(net)} (${pins[0]} from ${pins[1]}) and nothing else joins them; remove the cut or join the two sides`, [cut.id], "pcb", holePoint(grid, sides[0]))]
}

function linkFindings(board: Board, links: readonly LinkRecord[]): Violation[] {
  const { grid } = board
  const found: Violation[] = []
  const over = new Map<number, string>()
  for (const link of links) {
    const [from, to] = [gridHole(grid, link.from), gridHole(grid, link.to)]
    if (!from || !to) {
      found.push(violation("proto-link", "error", `${protoWords(link)} ends outside the board's holes`, [link.id], "pcb"))
      continue
    }
    const span = linkSpan(from, to)
    const at = holePoint(grid, from)
    if (span === undefined) {
      found.push(violation("proto-link", "error", `${protoWords(link)} is not straight: a link runs along one row or one column`, [link.id], "pcb", at))
      continue
    }
    const leg = span.find((hole) => board.pins.has(holeKey(grid, hole)))
    if (leg) found.push(violation("proto-link", "error", `${protoWords(link)} runs over the leg of ${pinOf((board.pins.get(holeKey(grid, leg)) as PinHole).pad)} at ${holeName(leg)}`, [link.id], "pcb", at))
    for (const hole of span) {
      const key = holeKey(grid, hole)
      const other = over.get(key)
      if (other !== undefined) found.push(violation("proto-link", "error", `${protoWords(link)} crosses link ${other} at ${holeName(hole)}; links on the top side do not cross`, [link.id, other], "pcb", holePoint(grid, hole)))
      else over.set(key, link.id)
    }
  }
  return found
}

function solderFindings(board: Board, solder: SolderRecord): Violation[] {
  const holes = solder.holes.map((name) => gridHole(board.grid, name))
  const outside = solder.holes.find((name, i) => holes[i] === undefined)
  if (outside !== undefined) return [violation("proto-solder", "error", `${protoWords(solder)}: ${outside} is outside the board's holes`, [solder.id], "pcb")]
  const step = holes.findIndex((hole, i) => i > 0 && !neighbours(holes[i - 1] as Hole, hole as Hole))
  if (step < 0) return []
  return [violation("proto-solder", "error", `${protoWords(solder)} steps from ${solder.holes[step - 1]} to ${solder.holes[step]}, which are not neighbours; solder joins one hole to the next`, [solder.id], "pcb", holePoint(board.grid, holes[step] as Hole))]
}

/** A record whose net is not the net of the pins it joins. */
function netFindings(board: Board, record: SolderRecord | LinkRecord): Violation[] {
  if (record.net === undefined) return []
  const first = gridHole(board.grid, record.t === "solder" ? (record.holes[0] as string) : record.from)
  const nets = first ? netsAt(board, first) : undefined
  if (!nets || nets.size !== 1) return []
  const [net] = [...nets.keys()] as [string]
  const named = (one: string) => one.replace(/^net[.:]/, "")
  if (named(net) === named(record.net) || board.nameOf(net) === record.net) return []
  return [violation("proto-record", "warning", `${protoWords(record)} says net ${record.net} but joins pins of ${board.nameOf(net)}`, [record.id], "pcb")]
}

/** Every finding about the paths of a proto board, in no particular order (checkDesign sorts them). */
export function protoPathChecks(layout: Pick<PcbLayout, "board" | "parts" | "proto">, nameOf: NameOf): Violation[] {
  const grid = layout.board?.proto
  if (!grid) return []
  const records: readonly ProtoRecord[] = layout.proto ?? []
  const sets = protoSets(grid, records)
  const pins = pinHoles(grid, layout.parts)
  const board: Board = { grid, sets, pins, netsOf: islandNets(sets, pins), nameOf }
  const cuts = records.filter((r): r is CutRecord => r.t === "cut")
  const onPerfboard = grid.kind === "perfboard" ? cuts.map((cut) => violation("proto-record", "warning", `${protoWords(cut)}: a perfboard has no strips to cut`, [cut.id], "pcb")) : []
  return [
    ...openNets(board),
    ...shorts(board),
    ...(grid.kind === "stripboard" ? cuts.flatMap((cut) => cutFindings(board, cut)) : onPerfboard),
    ...linkFindings(board, records.filter((r): r is LinkRecord => r.t === "link")),
    ...records.filter((r): r is SolderRecord => r.t === "solder").flatMap((one) => solderFindings(board, one)),
    ...records.filter((r): r is SolderRecord | LinkRecord => r.t !== "cut").flatMap((one) => netFindings(board, one)),
  ]
}
