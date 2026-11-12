// The agent's copper pour and hole tools: add_pour, remove_pour, add_hole and remove_hole. Each is one edit of the
// circuit file through the core (pour-edits.ts), so one history entry, and honours the locks by id.
import { z } from "zod"
import { editCircuit, type Edit } from "../core/index.js"
import type { Design } from "../engine/design.js"
import { pourLine } from "./copper-summary.js"
import { findNet } from "./copper-under.js"
import { buildOf, type Ports } from "./copper-tools.js"

const file = z.string().describe("Circuit file, e.g. index.circuit.tsx")
const point = z.object({ x: z.number(), y: z.number() })
const pourLayer = z.enum(["top", "bottom", "inner1", "inner2"])

/** A pour's optional props; the core checks each value (pour-edits.ts). */
export const pourProps = z
  .object({
    priority: z.number().int().optional().describe("Higher wins where pours overlap; default 0"),
    clearance: z.number().optional().describe("mm to other nets; default the net class's"),
    minWidth: z.number().optional().describe("Narrowest copper kept, mm; default 0.25"),
    thermal: z.enum(["relief", "solid"]).optional().describe('"relief" (default, four spokes per pad) or "solid"'),
    thermalWidth: z.number().optional().describe("Spoke width, mm; default 0.3"),
    thermalGap: z.number().optional().describe("Pad-to-pour gap, mm; default 0.25"),
  })
  .strict()

export const pourFields = {
  net: z.string().describe('Net name, e.g. "GND"'),
  layer: pourLayer.describe('"top" or "bottom"; inner1 and inner2 only on a 4-layer board'),
  outline: z.array(point).min(3).max(1000).optional().describe("Corners in mm; default the whole board"),
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
  "Add a copper pour of a net on one layer as ONE change: the engine fills it on every build around the other nets' copper, and the connections the fill makes count as routed. The answer gives its id and its fill (area, pads it joins); check the pads it joins."
export const REMOVE_POUR_DESCRIPTION =
  "Remove a copper pour by id as ONE change. A locked pour is refused, and so is removing an earlier pour that would renumber a locked one. A pour inside a sub-sheet instance (\"PS1/copperpour:1\") is written in its sheet file: edit that file instead."
export const ADD_HOLE_DESCRIPTION = "Add a non-plated hole (a mounting hole) as ONE change; copper keeps the board-edge clearance from it."
export const REMOVE_HOLE_DESCRIPTION =
  "Remove a non-plated hole by id as ONE change. A locked hole is refused. A hole inside a sub-sheet instance (\"PS1/hole:1\") is written in its sheet file: edit that file instead."

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

/**
 * Runs one tool's work; a refusal names the tool's item and ends with "Nothing was written.", as every refusal comes
 * before the one write.
 */
async function asItem(label: string, task: () => Promise<string>): Promise<string> {
  try {
    return await task()
  } catch (error) {
    const reason = (error as Error).message.replace(/\s*Nothing was written\.?$/, "").replace(/\.$/, "")
    throw new Error(`${label} was refused: ${reason}. Nothing was written.`)
  }
}

/** Applies one edit as one history entry by the agent; the answer's head names what it did, then any lock violations. */
async function applyOne(ports: Ports, circuit: string, edit: Edit, summary: string, head: (added: string | undefined) => string) {
  const result = await editCircuit(ports.root, circuit, [edit], { author: "ai", summary })
  const warnings = result.violations.map((v) => `Lock violation: ${v.part} ${v.kind}: ${v.detail}`)
  const added = result.boardItemsAdded[0]
  return { added, text: [`Change ${result.entry.id}: ${head(added)}`, ...warnings].join("\n") }
}

export function addPour(ports: Ports, input: { file: string } & PourRequest): Promise<string> {
  return asItem(`add_pour ${input.net} ${input.layer}`, async () => {
    const edit = pourEdit(await buildOf(ports, input.file), input)
    const { added, text } = await applyOne(ports, input.file, edit, `add copper pour ${edit.net} ${edit.layer}`, (id) => `added ${id ?? "a copper pour"} (${edit.net}, ${edit.layer})`)
    try {
      const after = await buildOf(ports, input.file)
      const fill = after.pcb.pours.find((one) => one.id === added)
      return fill ? `${text}\n${pourLine(after, fill)}` : text
    } catch (error) {
      return `${text}\nThe pour was written, but the board could not be rebuilt: ${(error as Error).message}`
    }
  })
}

export function removePour(ports: Ports, input: { file: string; id: string }): Promise<string> {
  return asItem(`remove_pour ${input.id}`, async () => (await applyOne(ports, input.file, { kind: "removePour", id: input.id }, `remove ${input.id}`, () => `removed ${input.id}`)).text)
}

export function addHole(ports: Ports, input: { file: string } & HoleRequest): Promise<string> {
  return asItem(`add_hole at ${pointText(input.x, input.y)}`, async () => {
    const edit: Edit = { kind: "addHole", x: input.x, y: input.y, diameter: input.diameter }
    return (await applyOne(ports, input.file, edit, `add hole ${holeWords(input)}`, (id) => `added ${id ?? "a hole"} ${holeWords(input)}`)).text
  })
}

export function removeHole(ports: Ports, input: { file: string; id: string }): Promise<string> {
  return asItem(`remove_hole ${input.id}`, async () => (await applyOne(ports, input.file, { kind: "removeHole", id: input.id }, `remove ${input.id}`, () => `removed ${input.id}`)).text)
}
