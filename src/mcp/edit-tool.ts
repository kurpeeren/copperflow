// edit_circuit: steps applied in order as one change. Since the tool fold it is also how an agent sets props, places
// and removes a part, removes a connection, writes text and adds or removes pours and holes, so its answer carries
// what those tools' answers did: the text's name and ink, the pours' and holes' ids, and the pads each new pour joins.
import { z } from "zod"
import { editCircuit, loadCircuit, renameDesignators, type Edit, type EditResult } from "../core/index.js"
import type { DesignSource } from "../core/design-source.js"
import { batchSummary, describeRefusal, editItem, firstRefusal, kindOf, moveNotes, toEdit, checkPours, type EditItem, type StepEdit } from "./batch.js"
import { renameMapping } from "./batch-steps.js"
import { buildOf } from "./copper-tools.js"
import { pourLine } from "./copper-summary.js"

export const editInput = { file: z.string().describe("Circuit file"), edits: z.array(editItem).min(1).max(100) }

export const EDIT_DESCRIPTION =
  'Apply edits in order as ONE change, each with exactly one key: parts, connections, instances, pages, text, pours and holes (see each key). add_drawing, set_drawing, remove_drawing, add_page, rename_page, remove_page, wire_corners, rename_parts, rename_port, sheet_size, set_pour, set_hole: guide { topic: "writing-circuits" }. One refused edit writes nothing; the answer names it. The answer names the texts, pours and holes written.'

interface EditPorts {
  root: string
  engine?: DesignSource
}

/** The change's lines: what it did, a moved instance's copper, notes, then any lock violations. */
const changeLines = (result: EditResult, note: string, after: readonly string[]) => [
  `Change ${result.entry.id} applied: ${note}`,
  ...(result.copperNote ? [result.copperNote] : []),
  ...after,
  ...result.violations.map((v) => `Lock violation: ${v.part} ${v.kind}: ${v.detail}`),
]

export async function editTool(ports: EditPorts, input: { file: string; edits: EditItem[] }): Promise<string> {
  const { file: circuit, edits } = input
  const rename = edits.findIndex((item) => item.rename_parts !== undefined)
  if (rename !== -1) return renameStep(ports, circuit, edits, rename)
  const converted: StepEdit[] = []
  for (const [index, item] of edits.entries()) {
    try {
      converted.push(await toEdit(ports.root, circuit, item, converted.map((done) => done.edit)))
    } catch (error) {
      throw new Error(describeRefusal({ index, reason: (error as Error).message }, edits.length, Object.keys(item)[0] ?? "edit"))
    }
  }
  const pours = await checkPours(ports.root, circuit, converted.map((c) => c.edit), ports.engine)
  if (pours.refusal) throw new Error(describeRefusal(pours.refusal, edits.length, "add_pour"))
  const list = pours.edits
  const summary = batchSummary(converted.map((c) => c.label))
  const notes = [...converted.flatMap((c) => (c.note ? [c.note] : [])), ...(list.some((e) => e.kind === "movePartToPage") ? await movesLeaveBehind(ports.root, circuit, list) : [])]
  let result: EditResult
  try {
    result = await editCircuit(ports.root, circuit, list, { author: "ai", summary, ...(ports.engine ? { engine: ports.engine } : {}) })
  } catch (error) {
    const refusal = await firstRefusal(ports.root, circuit, list)
    if (!refusal) throw new Error(`The batch was refused as a whole: ${(error as Error).message}
Nothing was written.`)
    throw new Error(describeRefusal(refusal, edits.length, Object.keys(edits[refusal.index] ?? {})[0] ?? "edit"))
  }
  const written = await boardItemLines(ports, circuit, list, result.boardItemsAdded)
  return changeLines(result, `${edits.length} edit${edits.length === 1 ? "" : "s"}: ${summary.slice(5)}`, [...notes, ...written]).join("\n")
}

/** The pours, holes and board texts the change wrote, and each new pour's fill with the pads it joins. */
async function boardItemLines(ports: EditPorts, circuit: string, edits: readonly Edit[], ids: readonly string[]): Promise<string[]> {
  const adds = edits.some((edit) => edit.kind === "addPour" || edit.kind === "addHole" || edit.kind === "addSilkText")
  if (!adds || ids.length === 0) return []
  const head = `Written: ${ids.join(", ")}`
  if (!edits.some((edit) => edit.kind === "addPour")) return [head]
  try {
    const after = await buildOf(ports, circuit)
    return [head, ...after.pcb.pours.filter((fill) => ids.includes(fill.id)).map((fill) => pourLine(after, fill))]
  } catch (error) {
    return [head, `The change was written, but the board could not be rebuilt: ${(error as Error).message}`]
  }
}

/** rename_parts goes alone: the designators renamed as one change, the layout file's nets with them (Design → Annotate). */
async function renameStep(ports: EditPorts, circuit: string, edits: readonly EditItem[], index: number): Promise<string> {
  if (edits.length > 1) throw new Error(describeRefusal({ index, reason: "rename_parts goes alone in its edit_circuit call; send the other edits in another" }, edits.length, "rename_parts"))
  try {
    kindOf(edits[0]!)
  } catch (error) {
    throw new Error(describeRefusal({ index: 0, reason: (error as Error).message }, 1, "rename_parts"))
  }
  const mapping = renameMapping(edits[0]?.rename_parts)
  const words = mapping.map(({ from, to }) => `${from} -> ${to}`).join(", ")
  const engine = ports.engine ? { engine: ports.engine } : {}
  const { entry } = await renameDesignators(ports.root, circuit, mapping, { author: "ai", summary: `rename ${words}`.slice(0, 200), ...engine })
  return `Change ${entry.id} applied: renamed ${words}`
}

/** What the moves to a page in a batch leave behind, read before anything is written. */
async function movesLeaveBehind(root: string, circuit: string, edits: Edit[]): Promise<string[]> {
  const loaded = await loadCircuit(root, circuit)
  return moveNotes(loaded.source, edits, new Set(loaded.annotations.locks.map((lock) => lock.part)))
}
