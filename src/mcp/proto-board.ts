// fit_board { kind }: the board made a perfboard, a stripboard or a made PCB again. To a hole grid, the board keeps its
// size and centre in whole holes, then the placed parts drop into free holes (turned across the strips on stripboard)
// and the board is fitted round them in whole holes: two changes, the kind and then the parts. Locked parts stay.
import { editCircuit, resolveCircuit } from "../core/index.js"
import { placementWrites, writePlacement } from "../core/placement-write.js"
import type { Design } from "../engine/design.js"
import { holesFor } from "../engine/proto/grid.js"
import { snapPositions } from "../engine/proto/snap.js"
import { buildOf, type Ports } from "./copper-tools.js"

export const BOARD_KINDS = ["pcb", "perfboard", "stripboard"] as const
export type BoardKind = (typeof BOARD_KINDS)[number]

const kindOf = (design: Design): BoardKind => design.pcb.board?.proto?.kind ?? "pcb"
const round = (v: number) => Math.round(v * 100) / 100

/** The board's size in mm, from its outline. */
function sizeOf(design: Design): { width: number; height: number } {
  const outline = design.pcb.board?.outline ?? []
  if (outline.length < 3) throw new Error("The circuit has no board to change; give it one with fit_board first. Nothing was written.")
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

/** The placed parts' positions as they are, for the snap to move. */
function positionsOf(design: Design): Map<string, { x: number; y: number; rotation: number }> {
  return new Map(design.pcb.parts.filter((part) => !part.autoPlaced && Number.isFinite(part.x)).map((part) => [part.component, { x: part.x, y: part.y, rotation: part.rotation }]))
}

/** Changes the board's kind; on a hole grid the parts then go onto holes and the board is fitted round them. */
export async function boardKindTool(ports: Ports, input: { file: string; kind: BoardKind }): Promise<string> {
  const circuit = await resolveCircuit(ports.root, input.file)
  const before = await buildOf(ports, circuit.file)
  if (kindOf(before) === input.kind) return `The board is already ${input.kind === "pcb" ? "a made PCB" : `a ${input.kind}`}. Nothing was written.`
  const size = sizeOf(before)
  const [columns, rows] = [holesFor(size.width), holesFor(size.height)]
  const edit = { kind: "setBoardKind" as const, board: input.kind, width: round(size.width), height: round(size.height), columns, rows }
  const words = input.kind === "pcb" ? `a made PCB of ${round(size.width)} × ${round(size.height)} mm` : `a ${input.kind} of ${columns} × ${rows} holes`
  const first = await editCircuit(ports.root, circuit.file, [edit], { author: "ai", summary: `board ${words}`, ...(ports.engine ? { engine: ports.engine } : {}) })
  const head = `Change ${first.entry.id}: the board is now ${words}`
  if (input.kind === "pcb") return head
  const grid = await buildOf(ports, circuit.file)
  const snapped = snapPositions(grid.pcb, positionsOf(grid), { unbounded: true })
  const writes = placementWrites(grid, snapped.positions)
  const placed = await writePlacement(ports.root, circuit.file, writes, { author: "ai", summary: "Put the parts on the holes and fit the board round them", fit: { margin: 0 } })
  const fitted = placed.board && !("error" in placed.board) && placed.board.holes ? `, the board fitted to ${placed.board.holes.columns} × ${placed.board.holes.rows} holes` : ""
  const second = placed.entry ? [`Change ${placed.entry.id}: ${placed.written.length} parts put on the holes${fitted}`] : []
  const notes = [...snapped.notes, ...placed.skipped.map((one) => `${one}; it was not moved`)]
  return [head, ...second, ...(notes.length > 0 ? [`Notes: ${notes.join("; ")}`] : []), `Then: autoroute, and render { view: "board" } for each side.`].join("\n")
}

