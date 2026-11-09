import { EditError } from "./edit-error.js"
import type { Author } from "./history.js"
import {
  checkRecord,
  nextLayoutId,
  parseLayout,
  serializeLayout,
  type CopperLayer,
  type LayoutMaker,
  type LayoutPoint,
  type LayoutRecord,
  type TrackRecord,
  type ViaRecord,
} from "./layout-file.js"

/** What the core can do to the layout file. Adds take the next free id; `by` defaults to who makes the edit. */
export type LayoutEdit =
  | { kind: "addTrack"; net?: string; layer: CopperLayer; width: number; points: LayoutPoint[]; locked?: boolean; by?: LayoutMaker }
  | { kind: "setTrack"; id: string; net?: string; layer?: CopperLayer; width?: number; points?: LayoutPoint[]; locked?: boolean }
  | { kind: "removeTrack"; id: string }
  | { kind: "addVia"; net?: string; at: LayoutPoint; drill: number; diameter: number; layers?: CopperLayer[]; locked?: boolean; by?: LayoutMaker }
  | { kind: "setVia"; id: string; net?: string; at?: LayoutPoint; drill?: number; diameter?: number; layers?: CopperLayer[]; locked?: boolean }
  | { kind: "removeVia"; id: string }

export interface LayoutEditContext {
  author: Author
  /** The locked part whose pad the track's first point lies on, if any; such a track counts as locked. */
  lockedPartAtStart?: (track: TrackRecord) => string | undefined
}

const MAKER: Record<Author, LayoutMaker> = { human: "human", ai: "agent" }

/** Checks the record an edit produced, as the file would be read. */
function checked(record: Record<string, unknown>): LayoutRecord {
  const result = checkRecord(record)
  if ("record" in result) return result.record
  throw new EditError("invalid", `${result.id ?? "The new record"}: ${result.problems.join("; ")}`)
}

function refuseLocking(edit: LayoutEdit, context: LayoutEditContext): void {
  if (context.author === "ai" && "locked" in edit && edit.locked !== undefined) {
    throw new EditError("locked", "Only a person locks or unlocks copper; ask the human to do it")
  }
}

/** Refuses changing or removing a locked record; a person may still change only its lock. */
function refuseLocked(record: LayoutRecord, edit: LayoutEdit, context: LayoutEditContext): void {
  const onlyLock = edit.kind.startsWith("set") && Object.keys(edit).every((key) => key === "kind" || key === "id" || key === "locked")
  if (record.locked && !onlyLock) throw new EditError("locked", `${record.id} is locked; ask the human to unlock it`)
  const part = record.t === "track" ? context.lockedPartAtStart?.(record) : undefined
  if (part !== undefined) throw new EditError("locked", `${record.id} starts on the locked part ${part}; ask the human to unlock it`)
}

function find(records: readonly LayoutRecord[], kind: LayoutRecord["t"], id: string): number {
  const index = records.findIndex((r) => r.t === kind && r.id === id)
  if (index < 0) throw new EditError("not_found", `No ${kind} ${id} in the layout file`)
  return index
}

function added(records: readonly LayoutRecord[], edit: Extract<LayoutEdit, { kind: "addTrack" | "addVia" }>, author: Author): LayoutRecord {
  const { kind, ...fields } = edit
  const t = kind === "addTrack" ? "track" : "via"
  return checked({ t, id: nextLayoutId(records, t), ...fields, locked: edit.locked ?? false, by: edit.by ?? MAKER[author] })
}

function changed(record: LayoutRecord, edit: Extract<LayoutEdit, { kind: "setTrack" | "setVia" }>): LayoutRecord {
  const { kind: _kind, id: _id, ...fields } = edit
  const defined = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
  return checked({ ...record, ...defined })
}

function applyOne(records: readonly LayoutRecord[], edit: LayoutEdit, context: LayoutEditContext): { records: LayoutRecord[]; created?: string } {
  refuseLocking(edit, context)
  if (edit.kind === "addTrack" || edit.kind === "addVia") {
    const record = added(records, edit, context.author)
    return { records: [...records, record], created: record.id }
  }
  const index = find(records, edit.kind.endsWith("Track") ? "track" : "via", edit.id)
  const record = records[index] as LayoutRecord
  refuseLocked(record, edit, context)
  if (edit.kind === "removeTrack" || edit.kind === "removeVia") return { records: records.filter((_, i) => i !== index) }
  return { records: records.map((r, i) => (i === index ? changed(record, edit) : r)) }
}

/** Applies the edits in order to new records; the old ones stay as they were. Throws EditError. */
export function applyLayoutRecordEdits(
  records: readonly LayoutRecord[],
  edits: readonly LayoutEdit[],
  context: LayoutEditContext,
): { records: LayoutRecord[]; created: string[] } {
  if (edits.length === 0) throw new EditError("invalid", "No layout edits were given")
  let current = [...records]
  const created: string[] = []
  for (const edit of edits) {
    const result = applyOne(current, edit, context)
    current = result.records
    if (result.created) created.push(result.created)
  }
  return { records: current, created }
}

/**
 * The locked records of `before` that `after` would change, as "track t0001, via v0002"; undefined when none. A
 * record still locked in `after` must be the same there, and a locked record may not go away; a record that is
 * unlocked in `after` is the change that put its lock on being taken back, which only a person can have made.
 */
export function lockedRecordChanges(before: string, after: string): string | undefined {
  const next = new Map(parseLayout(after).records.map((r) => [r.id, r]))
  const changedIds = parseLayout(before)
    .records.filter((r) => {
      const later = next.get(r.id)
      return r.locked && (later === undefined || (later.locked && serializeLayout([later]) !== serializeLayout([r])))
    })
    .map((r) => `${r.t} ${r.id}`)
  return changedIds.length === 0 ? undefined : changedIds.join(", ")
}

export type { TrackRecord, ViaRecord }
