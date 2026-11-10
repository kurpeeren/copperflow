import { EditError } from "./edit-error.js"
import { inProjectQueue, readIfThere, writeNew, writeWithHistory } from "./file-writes.js"
import type { Author, HistoryEntry } from "./history.js"
import { EMPTY_LAYOUT, isLayoutFile, layoutPathFor, readLayoutText, serializeLayout, type LayoutRecord } from "./layout-file.js"
import { boardLayersOf, designFor, lockedPartsAt, lockedStart, type DesignSource } from "./layout-locks.js"
import { applyLayoutRecordEdits, setsLayer, type LayoutEdit } from "./layout-records.js"
import { resolveCircuit, resolveLayoutFile } from "./workspace.js"
import { applyEdits } from "./edit.js"
import { readFile } from "node:fs/promises"
import type { FileChange } from "./history.js"
import { alsoField, sheetFilesFirst } from "./sheet-files.js"
import type { Edit } from "./types.js"

export interface LayoutEditOptions {
  author: Author
  /** The history entry's summary; by default one is made from the edits, as "Add track t0003, remove via v0001". */
  summary?: string
  /**
   * The circuit's built design (its PCB parts are enough). A track that starts on a pad of a locked part counts as
   * locked; without the design that cannot be told, so changing or removing a track is refused while parts are locked.
   * A function is called with the circuit file only when the circuit has locked parts or an edit puts copper on a
   * layer. With the design, copper on a layer the board lacks (inner1 on a 2-layer board) is refused. A design built
   * before a part moved judges a track start against the old pad positions; callers pass the newest build they have.
   */
  design?: DesignSource
  /** Set only by the router's code path: new records are marked `router`. */
  router?: boolean
  /**
   * A sub-sheet file edited in the same change, as Replicate layout writes a block's placement into its sheet and its
   * copper into the layout file: one history entry naming the layout file, with the sheet file as its `also`.
   */
  sheet?: { file: string; edits: Edit[] }
}

export interface LayoutEditResult {
  entry: HistoryEntry
  /** The layout file, project-relative. */
  file: string
  /** The records after the edit, in file order. */
  records: LayoutRecord[]
  /** The ids the adds were given, in edit order. */
  created: string[]
}

const VERB: Record<LayoutEdit["kind"], string> = {
  addTrack: "add track",
  setTrack: "change track",
  removeTrack: "remove track",
  addVia: "add via",
  setVia: "change via",
  removeVia: "remove via",
}

/** "Add track t0003, remove via v0001": each edit with the id it named or was given. */
export function describeLayoutEdits(edits: readonly LayoutEdit[], created: readonly string[]): string {
  let next = 0
  const words = edits.map((edit) => `${VERB[edit.kind]} ${"id" in edit ? edit.id : created[next++]}`)
  const text = words.join(", ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The layout file a name means: the layout file itself, or the one beside a circuit file. */
function layoutNameFor(file: string): string {
  if (isLayoutFile(file)) return file
  try {
    return layoutPathFor(file)
  } catch (error) {
    throw new EditError("invalid", (error as Error).message)
  }
}

/** The change edits make to a sub-sheet file, for a layout change's `also`; none when they change nothing. Sheet files hold no locks. */
async function sheetChange(root: string, sheet: { file: string; edits: Edit[] }): Promise<FileChange[]> {
  const resolved = await resolveCircuit(root, sheet.file)
  if (!resolved.file.endsWith(".sheet.tsx")) throw new EditError("invalid", `${sheet.file} is not a .sheet.tsx file`)
  const before = await readFile(resolved.path, "utf8")
  const after = applyEdits(before, sheet.edits, new Set())
  return after === before ? [] : [{ file: resolved.file, before, after }]
}

/**
 * Applies copper edits to a circuit's layout file (named by the circuit file or by the layout file itself) as one
 * history entry naming the layout file; the first edit creates the file, and undoing that removes it again. Locked
 * records, and tracks starting on a locked part's pad, are refused. Throws EditError for a refused edit.
 */
export function applyLayoutEdits(root: string, file: string, edits: readonly LayoutEdit[], options: LayoutEditOptions): Promise<LayoutEditResult> {
  return inProjectQueue(root, async () => {
    const layout = await resolveLayoutFile(root, layoutNameFor(file))
    const source = await readIfThere(layout.path)
    const before = source === undefined ? EMPTY_LAYOUT : readLayoutText(source, layout.file)
    const lockedParts = await lockedPartsAt(layout.circuitPath)
    const design = await designFor(options.design, layout.circuit, lockedParts.size > 0 || edits.some(setsLayer))
    const boardLayers = boardLayersOf(design)
    const context = {
      author: options.author,
      ...(options.router ? { router: true } : {}),
      ...(boardLayers === undefined ? {} : { boardLayers }),
      lockedPartAtStart: lockedStart(lockedParts, design),
    }
    const { doc, created } = applyLayoutRecordEdits(before, edits, context)
    const records = doc.records
    const text = serializeLayout(doc)
    if (text === (source ?? "")) throw new EditError("invalid", "The edit made no change")
    const summary = options.summary ?? describeLayoutEdits(edits, created)
    const also = options.sheet ? await sheetChange(root, options.sheet) : []
    const meta = { author: options.author, summary, ...alsoField(also) }
    const entry = await sheetFilesFirst(root, also, "after", () =>
      source === undefined ? writeNew(root, layout.path, text, meta) : writeWithHistory(root, { ...layout, source }, text, { ...meta, file: layout.file, before: source, after: text }),
    )
    return { entry, file: layout.file, records, created }
  })
}
