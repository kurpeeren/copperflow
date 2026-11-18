// fit_board: the board's size, shape and copper layers as ONE change by the agent. With no size it fits a rectangle
// round the parts (place-tools' fitBoardTool, as Layout → Fit board does); width and height give that rectangle,
// outline gives a polygon, layers 2 or 4 the copper layers. After a resize the answer names the parts now off the
// board, as import_board does for a drawn outline.
import { z } from "zod"
import { editCircuit, resolveCircuit, type Edit } from "../core/index.js"
import type { Point } from "../core/types.js"
import type { Design } from "../engine/design.js"
import { pointInPolygon } from "../engine/checks/geometry.js"
import { buildOf, type Ports } from "./copper-tools.js"
import { fitBoardEdit } from "../studio/fit-board.js"
import { fitBoardInput, fitBoardTool } from "./place-tools.js"

const point = z.object({ x: z.number(), y: z.number() })

export const boardInput = {
  ...fitBoardInput,
  width: z.number().positive().optional().describe("mm, with height: this rectangle"),
  height: z.number().positive().optional(),
  x: z.number().optional().describe("Centre; default the board's"),
  y: z.number().optional(),
  outline: z.array(point).min(3).max(500).optional().describe("Corners in mm"),
  layers: z.union([z.literal(2), z.literal(4)]).optional(),
}

export const BOARD_DESCRIPTION =
  "Set the board as ONE change: by default a rectangle round the parts plus margin; or width and height (centred on x, y), or an outline; layers: 2 or 4 copper layers. The answer names parts left outside."

export interface BoardInput {
  file: string
  margin?: number | undefined
  width?: number | undefined
  height?: number | undefined
  x?: number | undefined
  y?: number | undefined
  outline?: Point[] | undefined
  layers?: 2 | 4 | undefined
}

/** The smallest board side fit_board writes, in mm. */
const MIN_SIZE = 1

const mm = (v: number) => String(Math.round(v * 100) / 100)
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** The parts off the rebuilt board; a build that fails is said, since the change is already written. */
async function offBoardAfter(ports: Ports, file: string): Promise<string[]> {
  try {
    return offBoardLine(partsOffBoard(await buildOf(ports, file)))
  } catch (error) {
    return [`The board was written, but it could not be rebuilt to check for parts outside it: ${(error as Error).message.split("\n")[0]}`]
  }
}

/** Why the arguments do not go together, or nothing. */
export function boardInputProblem(input: BoardInput): string | undefined {
  const sized = input.width !== undefined || input.height !== undefined
  if (sized && (input.width === undefined || input.height === undefined)) return "Give width and height together"
  if (sized && Math.min(input.width ?? 0, input.height ?? 0) < MIN_SIZE) return `width and height must each be at least ${MIN_SIZE} mm`
  if (sized && input.outline !== undefined) return "Give width and height, or outline, not both"
  if (input.margin !== undefined && (sized || input.outline !== undefined)) return "margin is for fitting round the parts; leave it out with width, height or outline"
  if ((input.x !== undefined || input.y !== undefined) && !sized) return "x and y place the centre of width × height; give those too"
  return undefined
}

/** The centre of the built board's outline, or the origin without one. */
function centreOf(design: Design): Point {
  const outline = design.pcb.board?.outline ?? []
  if (outline.length < 3) return { x: 0, y: 0 }
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
}

/** The shape edit the arguments ask for, and its words; none when only layers change. */
function shapeEdit(design: Design, input: BoardInput): { edit: Edit; words: string } | undefined {
  if (input.outline !== undefined) {
    return { edit: { kind: "setBoardShape", outline: input.outline, holes: [], keepouts: [], replace: false, keepItems: true }, words: `outline of ${input.outline.length} corners` }
  }
  if (input.width === undefined || input.height === undefined) return undefined
  const centre = centreOf(design)
  const x = input.x ?? centre.x
  const y = input.y ?? centre.y
  return { edit: { kind: "setBoard", width: input.width, height: input.height, x, y }, words: `${mm(input.width)} × ${mm(input.height)} mm at (${mm(x)}, ${mm(y)})` }
}

/** Placed parts (not those the engine put down itself) with their centre or a pad centre off the board's outline. */
export function partsOffBoard(design: Design): string[] {
  const outline = design.pcb.board?.outline ?? []
  if (outline.length < 3) return []
  return design.pcb.parts
    .filter((part) => !part.autoPlaced && [{ x: part.x, y: part.y }, ...part.pads.map((pad) => ({ x: pad.x, y: pad.y }))].some((p) => !pointInPolygon(p, outline)))
    .map((part) => part.component)
}

/** The line naming the parts now off the board, or none. */
export function offBoardLine(parts: readonly string[]): string[] {
  if (parts.length === 0) return []
  const one = parts.length === 1
  return [`${plural(parts.length, "placed part")} ${one ? "is" : "are"} now outside the board: ${parts.join(", ")}; move ${one ? "it" : "them"} inside or make the board larger`]
}

/** fit_board with its size, outline and layers. */
export async function boardTool(ports: Ports, input: BoardInput): Promise<string> {
  const problem = boardInputProblem(input)
  if (problem) throw new Error(`${problem}. Nothing was written.`)
  const plain = input.width === undefined && input.outline === undefined
  if (plain && input.layers === undefined) return fitBoardTool(ports, input)
  const circuit = await resolveCircuit(ports.root, input.file)
  const before = await buildOf(ports, circuit.file)
  const shape = shapeEdit(before, input)
  const layers = input.layers === undefined ? [] : [{ edit: { kind: "setBoardLayers", layers: input.layers } as Edit, words: `${input.layers} copper layers` }]
  const fitted = plain && input.margin !== undefined ? fitBoardEdit(before, input.margin) : undefined
  if (fitted && "error" in fitted) throw new Error(`${fitted.error}. Nothing was written.`)
  const fit = fitted ? [{ edit: fitted.edit, words: `${mm(fitted.width)} × ${mm(fitted.height)} mm round the parts` }] : []
  const edits = [...(shape ? [shape] : fit), ...layers]
  const words = edits.map((one) => one.words).join(", ")
  const result = await editCircuit(ports.root, circuit.file, edits.map((one) => one.edit), { author: "ai", summary: `board ${words}`, ...(ports.engine ? { engine: ports.engine } : {}) })
  const after = shape || fitted ? await offBoardAfter(ports, circuit.file) : []
  return [`Change ${result.entry.id}: board ${words}`, ...(result.copperNote ? [result.copperNote] : []), ...after].join("\n")
}
