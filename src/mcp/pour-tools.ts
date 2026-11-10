// The agent's copper pour and hole tools: add_pour, remove_pour, add_hole and remove_hole. Each is one edit of the
// circuit file through the core (pour-edits.ts), so one history entry, and honours the locks by id.
import { z } from "zod"
import { editCircuit, type Edit } from "../core/index.js"
import { newBoardItemId } from "../core/board-items.js"
import { loadCircuit } from "../core/workspace.js"
import type { Design } from "../engine/design.js"
import { pourLine } from "./copper-summary.js"
import { findNet } from "./copper-under.js"
import { buildOf, type Ports } from "./copper-tools.js"

const file = z.string().describe("Circuit file path relative to the project root")
const point = z.object({ x: z.number(), y: z.number() })
const pourLayer = z.enum(["top", "bottom", "inner1", "inner2"])

/** A pour's optional props; the core checks each value (pour-edits.ts). */
export const pourProps = z
  .object({
    priority: z.number().int().optional().describe("Where pours overlap, the higher keeps the copper; default 0"),
    clearance: z.number().optional().describe("mm to other nets' copper; default the net class's clearance"),
    minWidth: z.number().optional().describe("mm; copper narrower than this is removed; default 0.25"),
    thermal: z.enum(["relief", "solid"]).optional().describe('"relief" (default: four spokes to each pad of the net) or "solid"'),
    thermalWidth: z.number().optional().describe("Spoke width in mm; default 0.3"),
    thermalGap: z.number().optional().describe("Gap between pad and pour in mm; default 0.25"),
  })
  .strict()

export const pourFields = {
  net: z.string().describe('Net name, e.g. "GND"'),
  layer: pourLayer.describe('"top" or "bottom"; inner1 and inner2 only on a 4-layer board'),
  outline: z.array(point).min(3).max(1000).optional().describe("Corners in mm of the area to fill; without one the pour fills the whole board"),
  props: pourProps.optional(),
}

export const holeFields = {
  x: z.number().describe("Centre in mm"),
  y: z.number().describe("Centre in mm"),
  diameter: z.number().describe("Drill diameter in mm"),
}

export const addPourInput = { file, ...pourFields }
export const removePourInput = { file, id: z.string().describe('The pour\'s id from copper_summary, e.g. "copperpour:1"') }
export const addHoleInput = { file, ...holeFields }
export const removeHoleInput = { file, id: z.string().describe('The hole\'s id from copper_summary, e.g. "hole:1"') }

export const ADD_POUR_DESCRIPTION =
  "Add a copper pour of a net on one layer as ONE change: the engine fills it on every build around the other nets' copper, with thermal relief spokes to the net's pads, and the connections the fill makes count as routed. Without an outline it fills the whole board. A two-layer board gets a GND pour on the bottom (and on top when there is room) before autoroute. The answer gives its id and its fill (area, pads it joins)."
export const REMOVE_POUR_DESCRIPTION = "Remove a copper pour by id as ONE change. A locked pour is refused, and so is removing an earlier pour that would renumber a locked one."
export const ADD_HOLE_DESCRIPTION = "Add a non-plated hole (a mounting hole) as ONE change; copper keeps the board-edge clearance from it."
export const REMOVE_HOLE_DESCRIPTION = "Remove a non-plated hole by id as ONE change. A locked hole is refused."

type PourRequest = { net: string; layer: string; outline?: { x: number; y: number }[]; props?: z.infer<typeof pourProps> }
type HoleRequest = { x: number; y: number; diameter: number }

const mmText = (n: number) => String(Math.round(n * 1e6) / 1e6)
/** "(12, 7)". */
export const pointText = (x: number, y: number) => `(${mmText(x)}, ${mmText(y)})`
const holeWords = (hole: HoleRequest) => `at ${pointText(hole.x, hole.y)}, ${mmText(hole.diameter)} mm`

/**
 * The core's addPour for a request, with the net as the design names it: refuses a net the design does not have and a
 * layer the board does not have, before anything is written.
 */
export function pourEdit(design: Design, request: PourRequest): Extract<Edit, { kind: "addPour" }> {
  const net = findNet(design.circuit.nets, request.net)
  if (!net) throw new Error(`There is no net ${request.net}; connect pins to it first`)
  const layers = design.circuit.board?.layers ?? 2
  if (layers === 2 && request.layer.startsWith("inner")) throw new Error(`The board has 2 layers (top, bottom), so there is no ${request.layer}. Nothing was written.`)
  const props = Object.fromEntries(Object.entries(request.props ?? {}).filter(([, value]) => value !== undefined)) as Record<string, string | number>
  return { kind: "addPour", net: net.names[0] ?? request.net, layer: request.layer, ...(request.outline ? { outline: request.outline } : {}), ...(Object.keys(props).length > 0 ? { props } : {}) }
}

/** Applies one edit as one history entry by the agent; the answer is its first line plus any lock violations. */
async function applyOne(ports: Ports, circuit: string, edit: Edit, summary: string): Promise<string> {
  const result = await editCircuit(ports.root, circuit, [edit], { author: "ai", summary })
  const warnings = result.violations.map((v) => `Lock violation: ${v.part} ${v.kind}: ${v.detail}`)
  return [`Change ${result.entry.id}: ${summary.replace(/^add /, "added ").replace(/^remove /, "removed ")}`, ...warnings].join("\n")
}

/** The id the next pour or hole gets in the file as it is now. */
async function nextId(ports: Ports, circuit: string, tag: "copperpour" | "hole"): Promise<string> {
  const { model } = await loadCircuit(ports.root, circuit)
  return newBoardItemId(model.boardItems ?? [], tag)
}

export async function addPour(ports: Ports, input: { file: string } & PourRequest): Promise<string> {
  const edit = pourEdit(await buildOf(ports, input.file), input)
  const id = await nextId(ports, input.file, "copperpour")
  const head = await applyOne(ports, input.file, edit, `add ${id} (${edit.net}, ${edit.layer})`)
  try {
    const after = await buildOf(ports, input.file)
    const fill = after.pcb.pours.find((one) => one.id === id)
    return fill ? `${head}\n${pourLine(after, fill)}` : head
  } catch (error) {
    return `${head}\nThe pour was written, but the board could not be rebuilt: ${(error as Error).message}`
  }
}

export function removePour(ports: Ports, input: { file: string; id: string }): Promise<string> {
  return applyOne(ports, input.file, { kind: "removePour", id: input.id }, `remove ${input.id}`)
}

export async function addHole(ports: Ports, input: { file: string } & HoleRequest): Promise<string> {
  const id = await nextId(ports, input.file, "hole")
  return applyOne(ports, input.file, { kind: "addHole", x: input.x, y: input.y, diameter: input.diameter }, `add ${id} ${holeWords(input)}`)
}

export function removeHole(ports: Ports, input: { file: string; id: string }): Promise<string> {
  return applyOne(ports, input.file, { kind: "removeHole", id: input.id }, `remove ${input.id}`)
}
