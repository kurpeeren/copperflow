// The agent's placement tools. autoplace runs the same placer as the Studio's Place → Autoplace, in this process
// within a time budget, and writes the positions through the same core path: one history entry by the agent, the
// pcbX/pcbY/pcbRotation of each part as its own props mean them, locked and hand-placed parts left where they are. As
// autoroute does, it hashes the files a build reads before placing and again in the write queue, and discards the
// result when they changed. fit_board reshapes a rectangular board round the parts as one entry.
import { z } from "zod"
import { editCircuit, resolveCircuit } from "../core/index.js"
import { placementWrites, writePlacement } from "../core/placement-write.js"
import { strandedCopper, strandedLines } from "../engine/checks/stranded-copper.js"
import type { Design } from "../engine/design.js"
import { DEFAULT_FIT_MARGIN, placeBoard, type Placement } from "../engine/pcb-place/index.js"
import { placeBoardFitting } from "../engine/pcb-place/grow.js"
import type { PlaceScope } from "../engine/pcb-place/scope.js"
import { ratsnestLength } from "../engine/pcb-place/score.js"
import { fitBoardEdit } from "../studio/fit-board.js"
import { checkedPlaceScope, lockedNames } from "../studio/place-runner.js"
import { placeSummary } from "../studio/place-events.js"
import { discardReason } from "../studio/route-events.js"
import { contentHashes } from "../studio/route-runner.js"
import { buildOf, type Ports } from "./copper-tools.js"

export const DEFAULT_PLACE_BUDGET_SECONDS = 20
const MAX_BUDGET_SECONDS = 300
/** The unplaced parts and notes an answer names; the rest are counted. */
const SHOWN = 10

export const autoplaceInput = {
  file: z.string().describe("Circuit file"),
  parts: z.array(z.string().min(1)).min(1).max(500).optional().describe('e.g. ["U1"]'),
  instance: z.string().min(1).optional().describe('e.g. "PS1"'),
  fit: z.boolean().optional().describe("Also fit the board round the parts"),
  budgetSeconds: z.number().positive().max(MAX_BUDGET_SECONDS).optional().describe(`Default ${DEFAULT_PLACE_BUDGET_SECONDS}`),
  connectors: z.enum(["last", "ahead"]).optional().describe("last (default): connectors after the rest; ahead: each just before the part it serves"),
}

export const fitBoardInput = {
  file: z.string().describe("Circuit file"),
  margin: z.number().min(0).max(50).optional().describe(`mm; default ${DEFAULT_FIT_MARGIN}`),
}

export const AUTOPLACE_DESCRIPTION =
  "Place parts by their connections as ONE change: every part without a position, or only some parts or one instance. Placed and locked parts stay. Run it before autoroute. With fit: true a part with no room grows the board. The answer gives wire length, board size, overlaps, parts with no room and copper a move left behind."
export const FIT_BOARD_DESCRIPTION =
  "Shrink or grow a rectangular board round the parts plus a margin, as ONE change. Refused for a non-rectangular outline."

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
const mm = (v: number) => String(Math.round(v * 10) / 10)

/** The scope the arguments ask for: at most one of parts and instance. */
function scopeOf(design: Design, input: { parts?: string[] | undefined; instance?: string | undefined }): PlaceScope {
  if (input.parts && input.instance !== undefined) throw new Error("Give parts or instance, or neither to place the board. Nothing was written.")
  const scope: PlaceScope = input.parts ? { kind: "parts", parts: input.parts } : input.instance !== undefined ? { kind: "instance", instance: input.instance } : { kind: "all" }
  return checkedPlaceScope(design, scope)
}

export function budgetOf(asked: number | undefined): number {
  if (asked === undefined) return DEFAULT_PLACE_BUDGET_SECONDS
  if (!(asked > 0)) throw new Error(`budgetSeconds must be more than 0 (it was ${asked}). Nothing was written.`)
  return Math.min(asked, MAX_BUDGET_SECONDS)
}

/** "board 42 × 28 mm" from the built outline, or nothing without one. */
function boardText(design: Design): string | undefined {
  const outline = design.pcb.board?.outline ?? []
  if (outline.length < 3) return undefined
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  return `board ${mm(Math.max(...xs) - Math.min(...xs))} × ${mm(Math.max(...ys) - Math.min(...ys))} mm`
}

/**
 * "Placed 12 parts; wire length 184 mm (was 412); board 42 × 28 mm; 0 overlaps": the wire length is that of the board
 * as rebuilt from the written files, so parts the build packs round the placed ones count where they end up.
 */
export function placedLine(placed: number, placement: Pick<Placement, "before">, after: Design): string {
  const overlaps = after.violations.filter((v) => v.code === "courtyard-overlap").length
  const board = boardText(after)
  return [`Placed ${plural(placed, "part")}`, `wire length ${Math.round(ratsnestLength(after.pcb.parts))} mm (was ${Math.round(placement.before.wireLength)})`, ...(board ? [board] : []), plural(overlaps, "overlap")].join("; ")
}

/** A net's first name ("GND"), or its id when it has none. */
const netName = (design: Design, id: string): string => design.circuit.nets.find((net) => net.id === id)?.names[0] ?? id

/** A list line naming at most SHOWN items. */
function listLine(head: string, items: readonly string[]): string[] {
  if (items.length === 0) return []
  const more = items.length > SHOWN ? `, … and ${items.length - SHOWN} more` : ""
  return [`${head}: ${items.slice(0, SHOWN).join("; ")}${more}`]
}

export interface AutoplaceOptions {
  /** The clock the budget is measured on, in ms; tests pass their own. */
  clock?: () => number
}

/** autoplace: places in this process within the budget and writes the positions as one change by the agent. */
export async function autoplace(
  ports: Ports,
  input: {
    file: string
    parts?: string[] | undefined
    instance?: string | undefined
    fit?: boolean | undefined
    budgetSeconds?: number | undefined
    connectors?: "last" | "ahead" | undefined
  },
  options: AutoplaceOptions = {},
): Promise<string> {
  const budgetSeconds = budgetOf(input.budgetSeconds)
  const ahead = input.connectors === "ahead" ? { connectorsAhead: true } : {}
  const circuit = await resolveCircuit(ports.root, input.file)
  if (!circuit.file.endsWith(".circuit.tsx")) throw new Error(`${circuit.file} is a sub-sheet; place the board of the circuit that uses it. Nothing was written.`)
  const start = await contentHashes(ports.root, circuit.file)
  const design = await buildOf(ports, circuit.file)
  const scope = scopeOf(design, input)
  const locked = await lockedNames(circuit.path, design)
  // With fit the board is reshaped anyway, so a part with no free spot grows it rather than staying unplaced.
  const placement = (input.fit ? placeBoardFitting : placeBoard)(design, { scope, locked, budgetMs: budgetSeconds * 1000, ...ahead, ...(options.clock ? { clock: options.clock } : {}) })
  const writes = placementWrites(design, placement.positions, placement.blocks)
  // A block put beside the board is on it once the board is fitted round it; without fit it is named as not placed.
  const beside = input.fit ? [] : placement.beside.map((b) => `${b.instance} (${b.reason}; fit: true grows the board round it)`)
  const grown = input.fit ? placement.beside.map((b) => `${b.instance} had no free room on the board; the board was grown round it`) : []
  const unplaced = listLine("Not placed", [...placement.unplaced.map((u) => `${u.name} (${u.reason})`), ...beside])
  if (writes.circuit.length + writes.sheets.length + writes.blocks.length === 0 && !input.fit) {
    const which = scope.kind === "instance" ? `every part of ${scope.instance}` : "every part in the scope"
    const none = placement.unplaced.length === 0 ? `Nothing to place: ${which} already has a position or is locked; autoplace moves only parts without one.` : "No part was placed."
    return [`${none} Nothing was written.`, ...unplaced].join("\n")
  }
  const guard = async () => {
    const why = discardReason(start, await contentHashes(ports.root, circuit.file))
    if (why !== undefined) throw new Error(`${why.replace("while the board was routed", "while the board was placed").replace("; route again", "; place again")}. Nothing was written.`)
  }
  const written = await writePlacement(ports.root, circuit.file, writes, { author: "ai", summary: placeSummary(scope, placement.positions.size), guard, ...(input.fit ? { fit: { margin: DEFAULT_FIT_MARGIN } } : {}) })
  const fitError = written.board && "error" in written.board ? [`The board was not fitted: ${written.board.error}`] : []
  const after = written.entry ? await buildOf(ports, circuit.file) : undefined
  const head = after && written.entry
    ? [placedLine(written.written.length, placement, after), `Change ${written.entry.id}; undo_change takes it back.`, ...strandedLines(strandedCopper(design, after), (net) => netName(after, net))]
    : [`Nothing to move: ${written.skipped.length > 0 ? "the parts placed could not be written (see the notes)" : "the parts are already where the placer put them"}. Nothing was written.`]
  return [
    ...head,
    ...unplaced,
    ...listLine("Notes", [...placement.notes, ...grown, ...writes.notes, ...written.skipped.map((s) => `${s}; it was not moved`), ...fitError, ...(written.copperNote ? [written.copperNote] : [])]),
    ...(placement.budgetSpent ? [`Stopped at the ${budgetSeconds} s time budget; run autoplace again (with a larger budgetSeconds) to do better.`] : []),
  ].join("\n")
}

/** fit_board: the board reshaped round the parts as one change by the agent. */
export async function fitBoardTool(ports: Ports, input: { file: string; margin?: number | undefined }): Promise<string> {
  const circuit = await resolveCircuit(ports.root, input.file)
  const fit = fitBoardEdit(await buildOf(ports, circuit.file), input.margin)
  if ("error" in fit) throw new Error(`${fit.error}. Nothing was written.`)
  const result = await editCircuit(ports.root, circuit.file, [fit.edit], { author: "ai", summary: fit.summary })
  return `Change ${result.entry.id}: board ${mm(fit.width)} × ${mm(fit.height)} mm (margin ${input.margin ?? DEFAULT_FIT_MARGIN} mm)`
}
