// Make a sub-sheet from a selection: the selected parts and the wires among them move to a new `<Name>.sheet.tsx`
// beside the circuit, and an instance of it takes their place, connected to the nets that crossed the selection's
// boundary. One history entry names the circuit file and carries the new sheet file (and the layout file, when its
// copper names nets the cut renames) as `also`, so undo restores them all together. Nothing moves on the board.
import { posix } from "node:path"
import { BASE_STEP, withBase } from "../engine/sheets.js"
import type { Design } from "../engine/design.js"
import { analyzeCircuit } from "./analyze.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { applyEdits } from "./edit.js"
import { EditError } from "./edit-error.js"
import { inProjectQueue, readIfThere, writeWithHistory } from "./file-writes.js"
import type { Author, FileChange, HistoryEntry } from "./history.js"
import { layoutPathFor, readLayoutText, serializeLayout } from "./layout-file.js"
import { SHEET_TAG } from "./instance-edits.js"
import { cutRefusal, planCut, type CutPort } from "./sheet-cut.js"
import { layoutNetRenamer, renameRecordNets } from "./sheet-cut-layout.js"
import { cutOrigin, defaultInstanceName, parentEdits, sheetSource } from "./sheet-cut-text.js"
import { alsoField, planSheetWrites, sheetFilesFirst } from "./sheet-files.js"
import { checkNewInstance, nextFreeBase, placeInstances, type PlacedInstance } from "./sheet-layout.js"
import { sheetFileIn } from "./selectors.js"
import type { Edit, PropValue } from "./types.js"
import { loadCircuit, resolveCircuit, resolveInRoot, type LoadedCircuit } from "./workspace.js"

export interface MakeSheetRequest {
  /** The sheet's name, e.g. "PowerStage": the file is `PowerStage.sheet.tsx` beside the circuit. */
  name: string
  parts: string[]
  /** Give the parts local designators (R5, R7 → R1, R2); without it they keep theirs. */
  rename?: boolean
  /** The instance's name; by default the sheet's name and a free number (PowerStage1). */
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
  /** The layout file's change, when the cut renames nets its copper names. */
  layout: FileChange[]
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

/** What a full change needs beyond the preview: the circuit's design as built now (positions and nets of the copper). */
interface Built {
  design(): Promise<Design>
}

const round2 = (value: number): number => Math.round(value * 100) / 100 + 0

/**
 * The positions the engine chose for the selected parts that have none written on the board, as setProps edits, so
 * the cut moves nothing there (as "Keep these positions" writes them): the instance's frame is made from them.
 */
function keepBoardPlaces(model: LoadedCircuit["model"], names: readonly string[], design: Design): Edit[] {
  return names.flatMap((name) => {
    const part = model.parts.find((p) => p.name === name)
    const placed = design.pcb.parts.find((p) => p.component === name)
    if (!part || !placed || (part.props["pcbX"] && part.props["pcbY"])) return []
    const turn: Record<string, PropValue> = placed.rotation !== 0 && part.props["pcbRotation"] === undefined ? { pcbRotation: placed.rotation } : {}
    return [{ kind: "setProps", part: name, props: { pcbX: round2(placed.x), pcbY: round2(placed.y), ...turn } } satisfies Edit]
  })
}

/** The layout file's change: each record's net renamed as the cut renames it; none when no record changes. */
async function layoutChange(root: string, circuitFile: string, rename: () => Promise<(net: string) => string>): Promise<FileChange[]> {
  if (!circuitFile.endsWith(".circuit.tsx")) return []
  const file = layoutPathFor(circuitFile)
  const before = await readIfThere(resolveInRoot(root, file))
  if (before === undefined) return []
  const doc = readLayoutText(before, file)
  const { records, changed } = renameRecordNets(doc.records, await rename())
  return changed ? [{ file, before, after: serializeLayout({ ...doc, records }) }] : []
}

/** Whether a selected part has no board position written, so the engine places it. */
const unplaced = (model: LoadedCircuit["model"], names: readonly string[]): boolean =>
  names.some((name) => {
    const props = model.parts.find((p) => p.name === name)?.props
    return !props?.["pcbX"] || !props["pcbY"]
  })

/** Checks the request and works out the texts; `built` (a full change) also keeps the board placement and the copper's nets. Writes nothing. */
async function prepare(root: string, file: string, request: MakeSheetRequest, built?: Built): Promise<Prepared> {
  const { name } = request
  if (!SHEET_TAG.test(name)) throw new EditError("invalid", `"${name}" is not a sheet name; a sheet name starts with a capital letter, e.g. PowerStage`)
  const loaded = await loadCircuit(root, file)
  const refusal = cutRefusal(loaded.model, request.parts)
  if (refusal) throw new EditError("invalid", refusal)
  const sheetFile = posix.join(posix.dirname(loaded.file), `${name}.sheet.tsx`)
  if ((await readIfThere(resolveInRoot(root, sheetFile))) !== undefined) throw new EditError("invalid", `${sheetFile} already exists; choose another sheet name`)
  if (loaded.model.imports.some((spec) => spec.local === name)) throw new EditError("invalid", `${loaded.file} already uses the name ${name}; choose another sheet name`)
  const locked = new Set(loaded.annotations.locks.map((lock) => lock.part))
  // Placed first in the text the cut reads; the entry's "before" stays the file as it was.
  const keep = built && unplaced(loaded.model, request.parts) ? keepBoardPlaces(loaded.model, request.parts, await built.design()) : []
  const source = keep.length === 0 ? loaded.source : applyEdits(loaded.source, keep, locked)
  const model = keep.length === 0 ? loaded.model : analyzeCircuit(source)
  const instance = request.instance ?? defaultInstanceName(name, model)
  const plan = planCut(model, request.parts, request.rename === true)
  const moved = new Set(plan.parts.map((part) => part.name))
  const flatParts = model.parts.filter((part) => !moved.has(part.name) && sheetFileIn(model, part.name) === undefined).map((part) => part.name)
  const base = freeBase(instance, name, plan.mapping.map((m) => m.to), await placeInstances(root, loaded.file, model), flatParts)
  const origin = cutOrigin(plan.parts)
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
  const layout = built ? await layoutChange(root, loaded.file, async () => layoutNetRenamer((await built.design()).circuit.nets, plan, instance, base)) : []
  return { loaded, preview, sheetText: sheetSource(source, model, plan, name, origin), after, layout }
}

/** What making the sub-sheet would do, checked as the change itself is; writes nothing. */
export async function previewSubSheet(root: string, file: string, request: MakeSheetRequest): Promise<MakeSheetPreview> {
  return (await prepare(root, file, request)).preview
}

/**
 * Makes the sub-sheet as one history entry touching the circuit file, the new sheet file and, when its copper names
 * nets the cut renames, the layout file. The circuit is built once (with `meta.engine`, else a new engine) when a
 * selected part has no board position written or the circuit has a layout file.
 */
export function makeSubSheet(
  root: string,
  file: string,
  request: MakeSheetRequest,
  meta: { author: Author; summary?: string; engine?: DesignSource },
): Promise<{ entry: HistoryEntry; preview: MakeSheetPreview }> {
  return inProjectQueue(root, async () => {
    let design: Promise<Design> | undefined
    const built: Built = { design: () => (design ??= resolveCircuit(root, file).then((circuit) => buildWith(root, circuit.file, meta.engine))) }
    const { loaded, preview, sheetText, after, layout } = await prepare(root, file, request, built)
    const also = [...(await planSheetWrites(root, [{ file: preview.file, text: sheetText }], false)), ...layout]
    const summary = meta.summary ?? `make sub-sheet ${preview.sheet} (${preview.instance}) from ${request.parts.join(", ")}`
    const entry = await sheetFilesFirst(root, also, "after", () =>
      writeWithHistory(root, loaded, after, { author: meta.author, summary, file: loaded.file, before: loaded.source, after, ...alsoField(also) }),
    )
    return { entry, preview }
  })
}
