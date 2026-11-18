// add_text: words in one short call. On a schematic page it is a note, the common case of edit_circuit's add_drawing
// (the Studio's Place → Text), named G<n> as the Studio does; with a layer it is text on the board's silkscreen, named by
// its id (silkscreentext:<n>). Either way set_drawing and remove_drawing reach it.
import { z } from "zod"
import { newBoardItemId } from "../core/board-items.js"
import { loadCircuit, type Edit } from "../core/index.js"
import { stepEdit } from "./batch-steps.js"

export const addTextInput = {
  file: z.string().describe("Circuit file"),
  text: z.string().min(1),
  x: z.number(),
  y: z.number(),
  page: z.string().optional(),
  fontSize: z.number().optional(),
  layer: z.enum(["top", "bottom"]).optional(),
  height: z.number().optional().describe("mm"),
  rotation: z.number().optional(),
}

export const ADD_TEXT_DESCRIPTION =
  "Write text as ONE change. Without layer: a note on a schematic page (default Main) at (x, y) sheet units. With layer: board silkscreen at (x, y) mm, height default 1.5. The answer names it (G3 or silkscreentext:1) for edit_circuit set_drawing/remove_drawing. Other shapes: add_drawing."

type TextRequest = {
  file: string
  text: string
  x: number
  y: number
  page?: string | undefined
  fontSize?: number | undefined
  layer?: "top" | "bottom" | undefined
  height?: number | undefined
  rotation?: number | undefined
}

/** The edit for the text, and the words the answer uses: a note's name, or a board text's id and side. */
export async function textEdit(root: string, input: TextRequest): Promise<{ edit: Edit; label: string }> {
  const { file, ...rest } = input
  const value = Object.fromEntries(Object.entries(rest).filter(([, one]) => one !== undefined))
  const { model } = await loadCircuit(root, file)
  if (input.layer !== undefined && (input.page !== undefined || input.fontSize !== undefined)) {
    throw new Error("page and fontSize are for a schematic note; board text takes layer, height and rotation. Nothing was written.")
  }
  if (input.layer === undefined && (input.height !== undefined || input.rotation !== undefined)) {
    throw new Error('height and rotation are for board text: give layer "top" or "bottom" too. Nothing was written.')
  }
  const { edit, label } = stepEdit("add_drawing", value, model, [])
  if (edit.kind !== "addSilkText") return { edit, label: `${label} "${input.text.slice(0, 40)}"` }
  const id = newBoardItemId(model.boardItems ?? [], "silkscreentext")
  return { edit, label: `add ${id} "${input.text.slice(0, 40)}" on the ${edit.layer} silkscreen` }
}
