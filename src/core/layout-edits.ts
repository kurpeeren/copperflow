import type { PlacedFootprint } from "../engine/pcb.js"
import { padsUnder } from "../engine/copper.js"
import { EditError } from "./edit-error.js"
import { inProjectQueue, readIfThere, writeNew, writeWithHistory } from "./file-writes.js"
import type { Author, HistoryEntry } from "./history.js"
import { isLayoutFile, layoutPathFor, readLayoutText, serializeLayout, type LayoutRecord, type TrackRecord } from "./layout-file.js"
import { applyLayoutRecordEdits, type LayoutEdit } from "./layout-records.js"
import { loadCircuit, resolveLayoutFile } from "./workspace.js"

export interface LayoutEditOptions {
  author: Author
  /** The history entry's summary; by default one is made from the edits, as "Add track t0003, remove via v0001". */
  summary?: string
  /**
   * The circuit's built design (its PCB parts are enough). A track that starts on a pad of a locked part counts as
   * locked; without the design that cannot be told, so changing or removing a track is refused while parts are locked.
   */
  design?: { pcb: { parts: readonly PlacedFootprint[] } }
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

/** Who a track's first point belongs to, when that part is locked; refuses to guess without the design. */
function lockedStart(lockedParts: ReadonlySet<string>, design: LayoutEditOptions["design"]): (track: TrackRecord) => string | undefined {
  return (track) => {
    if (lockedParts.size === 0) return undefined
    if (!design) throw new EditError("invalid", `Changing ${track.id} needs the built design, because the circuit has locked parts`)
    const start = track.points[0]
    if (!start) return undefined
    return padsUnder(design.pcb.parts, start, track.layer).find((pad) => lockedParts.has(pad.component))?.component
  }
}

async function lockedPartsOf(root: string, circuit: string): Promise<Set<string>> {
  const { annotations } = await loadCircuit(root, circuit)
  return new Set(annotations.locks.filter((lock) => !lock.drawing).map((lock) => lock.part))
}

/**
 * Applies copper edits to a circuit's layout file (named by the circuit file or by the layout file itself) as one
 * history entry naming the layout file; the first edit creates the file, and undoing that removes it again. Locked
 * records, and tracks starting on a locked part's pad, are refused. Throws EditError for a refused edit.
 */
export function applyLayoutEdits(root: string, file: string, edits: readonly LayoutEdit[], options: LayoutEditOptions): Promise<LayoutEditResult> {
  return inProjectQueue(root, async () => {
    const layout = await resolveLayoutFile(root, isLayoutFile(file) ? file : layoutPathFor(file))
    const source = await readIfThere(layout.path)
    const before = source === undefined ? [] : readLayoutText(source, layout.file)
    const context = { author: options.author, lockedPartAtStart: lockedStart(await lockedPartsOf(root, layout.circuit), options.design) }
    const { records, created } = applyLayoutRecordEdits(before, edits, context)
    const text = serializeLayout(records)
    if (text === (source ?? "")) throw new EditError("invalid", "The edit made no change")
    const summary = options.summary ?? describeLayoutEdits(edits, created)
    const entry =
      source === undefined
        ? await writeNew(root, layout.path, text, { author: options.author, summary })
        : await writeWithHistory(root, { ...layout, source }, text, { author: options.author, summary, file: layout.file, before: source, after: text })
    return { entry, file: layout.file, records, created }
  })
}
