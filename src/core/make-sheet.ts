// Make a sub-sheet from a selection: the selected parts and the wires among them move to a new `<Name>.sheet.tsx`
// beside the circuit, and an instance of it takes their place, connected to the nets that crossed the selection's
// boundary. One history entry names the circuit file and carries the new sheet file as `also`, so undo removes the
// sheet file and restores the circuit together.
import { posix } from "node:path"
import { BASE_STEP, withBase } from "../engine/sheets.js"
import { applyEdits } from "./edit.js"
import { EditError } from "./edit-error.js"
import { inProjectQueue, readIfThere, writeWithHistory } from "./file-writes.js"
import type { Author, HistoryEntry } from "./history.js"
import { SHEET_TAG } from "./instance-edits.js"
import { cutRefusal, planCut, type CutPort } from "./sheet-cut.js"
import { cutOrigin, defaultInstanceName, parentEdits, sheetSource } from "./sheet-cut-text.js"
import { alsoField, planSheetWrites, sheetFilesFirst } from "./sheet-files.js"
import { checkNewInstance, nextFreeBase, placeInstances, type PlacedInstance } from "./sheet-layout.js"
import { sheetFileIn } from "./selectors.js"
import { loadCircuit, resolveInRoot, type LoadedCircuit } from "./workspace.js"

export interface MakeSheetRequest {
  /** The sheet's name, e.g. "PowerStage": the file is `PowerStage.sheet.tsx` beside the circuit. */
  name: string
  parts: string[]
  /** Give the parts local designators (R5, R7 → R1, R2); without it they keep theirs. */
  rename?: boolean
  /** The instance's name; by default the sheet name's capitals and a free number (PS1). */
  instance?: string
}

/** What the change will do, as the dialog and the tool show it. */
export interface MakeSheetPreview {
  /** The new sheet file, project-relative with `/`. */
  file: string
  sheet: string
  instance: string
  base: number
  page?: string
  ports: CutPort[]
  connections: Record<string, string>
  /** Each part's designator now, in the sheet, and in the built design (the sheet's with the base added). */
  mapping: { from: string; to: string; flat: string }[]
}

interface Prepared {
  loaded: LoadedCircuit
  preview: MakeSheetPreview
  sheetText: string
  after: string
}

const MAX_BASE_TRIES = 1000

/** The first base from the next free one up, in steps of 100, whose designators no part or instance of the circuit has. */
function freeBase(name: string, sheet: string, designators: string[], placed: readonly PlacedInstance[], parts: readonly string[]): number {
  let base = nextFreeBase(placed)
  for (let tries = 0; tries < MAX_BASE_TRIES; tries++, base += BASE_STEP) {
    try {
      checkNewInstance(name, sheet, base, { span: BASE_STEP, designators }, placed, parts)
      return base
    } catch {
      // that base makes a designator the circuit has; try the next
    }
  }
  throw new EditError("invalid", `${name}: no free base found for ${sheet}`)
}

/** Checks the request and works out both texts; writes nothing. */
async function prepare(root: string, file: string, request: MakeSheetRequest): Promise<Prepared> {
  const { name } = request
  if (!SHEET_TAG.test(name)) throw new EditError("invalid", `"${name}" is not a sheet name; a sheet name starts with a capital letter, e.g. PowerStage`)
  const loaded = await loadCircuit(root, file)
  const { model, source } = loaded
  const refusal = cutRefusal(model, request.parts)
  if (refusal) throw new EditError("invalid", refusal)
  const sheetFile = posix.join(posix.dirname(loaded.file), `${name}.sheet.tsx`)
  if ((await readIfThere(resolveInRoot(root, sheetFile))) !== undefined) throw new EditError("invalid", `${sheetFile} already exists; choose another sheet name`)
  if (model.imports.some((spec) => spec.local === name)) throw new EditError("invalid", `${loaded.file} already uses the name ${name}; choose another sheet name`)
  const instance = request.instance ?? defaultInstanceName(name, model)
  const plan = planCut(model, request.parts, request.rename === true)
  const moved = new Set(plan.parts.map((part) => part.name))
  const flatParts = model.parts.filter((part) => !moved.has(part.name) && sheetFileIn(model, part.name) === undefined).map((part) => part.name)
  const base = freeBase(instance, name, plan.mapping.map((m) => m.to), await placeInstances(root, loaded.file, model), flatParts)
  const origin = cutOrigin(plan.parts)
  const locked = new Set(loaded.annotations.locks.map((lock) => lock.part))
  const after = applyEdits(source, parentEdits(plan, { sheet: name, name: instance, base, origin }), locked)
  const preview: MakeSheetPreview = {
    file: sheetFile,
    sheet: name,
    instance,
    base,
    ...(plan.page === undefined ? {} : { page: plan.page }),
    ports: plan.ports,
    connections: plan.connections,
    mapping: plan.mapping.map((m) => ({ ...m, flat: withBase(m.to, base) })),
  }
  return { loaded, preview, sheetText: sheetSource(source, model, plan, name, origin), after }
}

/** What making the sub-sheet would do, checked as the change itself is; writes nothing. */
export async function previewSubSheet(root: string, file: string, request: MakeSheetRequest): Promise<MakeSheetPreview> {
  return (await prepare(root, file, request)).preview
}

/** Makes the sub-sheet as one history entry touching the circuit file and the new sheet file. */
export function makeSubSheet(
  root: string,
  file: string,
  request: MakeSheetRequest,
  meta: { author: Author; summary?: string },
): Promise<{ entry: HistoryEntry; preview: MakeSheetPreview }> {
  return inProjectQueue(root, async () => {
    const { loaded, preview, sheetText, after } = await prepare(root, file, request)
    const also = await planSheetWrites(root, [{ file: preview.file, text: sheetText }], false)
    const summary = meta.summary ?? `make sub-sheet ${preview.sheet} (${preview.instance}) from ${request.parts.join(", ")}`
    const entry = await sheetFilesFirst(root, also, "after", () =>
      writeWithHistory(root, loaded, after, { author: meta.author, summary, file: loaded.file, before: loaded.source, after, ...alsoField(also) }),
    )
    return { entry, preview }
  })
}
