import { EditError } from "./edit-error.js"
import type { Author } from "./history.js"
import {
  checkRecord,
  nextLayoutId,
  parseLayout,
  serializeRecords,
  type CopperLayer,
  type LayoutDoc,
  type LayoutMaker,
  type LayoutPoint,
  type LayoutRecord,
  type TrackRecord,
  type ViaRecord,
} from "./layout-file.js"

/**
 * What the core can do to the layout file. Adds take the next free id; who made a record (`by`) comes from the
 * applier, never from the edit. Only the fields listed here are taken from an edit; anything else is refused.
 */
export type LayoutEdit =
  | { kind: "addTrack"; net?: string; layer: CopperLayer; width: number; points: LayoutPoint[]; locked?: boolean }
  | { kind: "setTrack"; id: string; layer?: CopperLayer; width?: number; points?: LayoutPoint[]; locked?: boolean }
  | { kind: "removeTrack"; id: string }
  | { kind: "addVia"; net?: string; at: LayoutPoint; drill: number; diameter: number; layers?: CopperLayer[]; locked?: boolean }
  | { kind: "setVia"; id: string; at?: LayoutPoint; drill?: number; diameter?: number; layers?: CopperLayer[]; locked?: boolean }
  | { kind: "removeVia"; id: string }

export interface LayoutEditContext {
  author: Author
  /** Set by the router's own code path: its records are marked `router` instead of the author's mark. */
  router?: boolean
  /** The locked part whose pad the track's first point lies on, if any; such a track counts as locked. */
  lockedPartAtStart?: (track: TrackRecord) => string | undefined
}

/** The fields each edit kind may carry, besides `kind`. */
const EDIT_FIELDS: Record<LayoutEdit["kind"], readonly string[]> = {
  addTrack: ["net", "layer", "width", "points", "locked"],
  setTrack: ["id", "layer", "width", "points", "locked"],
  removeTrack: ["id"],
  addVia: ["net", "at", "drill", "diameter", "layers", "locked"],
  setVia: ["id", "at", "drill", "diameter", "layers", "locked"],
  removeVia: ["id"],
}

const MAKER: Record<Author, LayoutMaker> = { human: "human", ai: "agent" }

/** Checks the record an edit produced, as the file would be read. */
function checked(record: Record<string, unknown>): LayoutRecord {
  const result = checkRecord(record)
  if ("record" in result) return result.record
  throw new EditError("invalid", `${result.id ?? "The new record"}: ${result.problems.join("; ")}`)
}

/** Refuses an unknown edit kind and any field the kind may not set (`by` among them). */
function refuseUnknownFields(edit: LayoutEdit): void {
  const allowed = EDIT_FIELDS[edit.kind] as readonly string[] | undefined
  if (allowed === undefined) throw new EditError("invalid", `Unknown layout edit ${String(edit.kind)}`)
  const extra = Object.keys(edit).find((key) => key !== "kind" && !allowed.includes(key))
  if (extra !== undefined) throw new EditError("invalid", `${edit.kind} cannot set ${extra}; it takes ${allowed.join(", ")}`)
}

function refuseLocking(edit: LayoutEdit, context: LayoutEditContext): void {
  if (context.author === "ai" && "locked" in edit && edit.locked !== undefined) {
    throw new EditError("locked", "Only a person locks or unlocks copper; ask the human to do it")
  }
}

function refuseLockedPart(record: LayoutRecord, context: LayoutEditContext): void {
  const part = record.t === "track" ? context.lockedPartAtStart?.(record) : undefined
  if (part !== undefined) throw new EditError("locked", `${record.id} starts on the locked part ${part}; ask the human to unlock it`)
}

const onlyLock = (edit: LayoutEdit) => edit.kind.startsWith("set") && Object.keys(edit).every((key) => key === "kind" || key === "id" || key === "locked")

/** Refuses changing or removing a locked record or a track on a locked part; a person may still change only its lock. */
function refuseLocked(record: LayoutRecord, edit: LayoutEdit, context: LayoutEditContext): void {
  if (onlyLock(edit)) return
  if (record.locked) throw new EditError("locked", `${record.id} is locked; ask the human to unlock it`)
  refuseLockedPart(record, context)
}

function find(records: readonly LayoutRecord[], kind: LayoutRecord["t"], id: string): number {
  const index = records.findIndex((r) => r.t === kind && r.id === id)
  if (index < 0) throw new EditError("not_found", `No ${kind} ${id} in the layout file`)
  return index
}

function addOne(doc: LayoutDoc, edit: Extract<LayoutEdit, { kind: "addTrack" | "addVia" }>, context: LayoutEditContext): LayoutDoc {
  const { kind, ...fields } = edit
  const t = kind === "addTrack" ? "track" : "via"
  const by = context.router ? "router" : MAKER[context.author]
  const record = checked({ t, id: nextLayoutId(doc, t), ...fields, locked: edit.locked ?? false, by })
  refuseLockedPart(record, context)
  return { next: { ...doc.next, [t]: doc.next[t] + 1 }, records: [...doc.records, record] }
}

function setOne(doc: LayoutDoc, index: number, edit: Extract<LayoutEdit, { kind: "setTrack" | "setVia" }>, context: LayoutEditContext): LayoutDoc {
  const { kind: _kind, id: _id, ...fields } = edit
  const defined = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
  const record = checked({ ...doc.records[index], ...defined })
  if (!onlyLock(edit)) refuseLockedPart(record, context)
  return { ...doc, records: doc.records.map((r, i) => (i === index ? record : r)) }
}

function applyOne(doc: LayoutDoc, edit: LayoutEdit, context: LayoutEditContext): LayoutDoc {
  refuseUnknownFields(edit)
  refuseLocking(edit, context)
  if (edit.kind === "addTrack" || edit.kind === "addVia") return addOne(doc, edit, context)
  const index = find(doc.records, edit.kind.endsWith("Track") ? "track" : "via", edit.id)
  refuseLocked(doc.records[index] as LayoutRecord, edit, context)
  if (edit.kind === "removeTrack" || edit.kind === "removeVia") return { ...doc, records: doc.records.filter((_, i) => i !== index) }
  return setOne(doc, index, edit, context)
}

/** Applies the edits in order to a new layout; the old one stays as it was. Throws EditError. */
export function applyLayoutRecordEdits(
  doc: LayoutDoc,
  edits: readonly LayoutEdit[],
  context: LayoutEditContext,
): { doc: LayoutDoc; created: string[] } {
  if (edits.length === 0) throw new EditError("invalid", "No layout edits were given")
  let current = doc
  const created: string[] = []
  for (const edit of edits) {
    const count = current.records.length
    current = applyOne(current, edit, context)
    if (edit.kind === "addTrack" || edit.kind === "addVia") created.push((current.records[count] as LayoutRecord).id)
  }
  return { doc: current, created }
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
      return r.locked && (later === undefined || (later.locked && serializeRecords([later]) !== serializeRecords([r])))
    })
    .map((r) => `${r.t} ${r.id}`)
  return changedIds.length === 0 ? undefined : changedIds.join(", ")
}

/**
 * The tracks on a locked part that `after` would change, add or remove compared with `before`, as
 * "track t0001 (on the locked part R1)"; undefined when none. Both versions of a changed track are judged.
 */
export function lockedPartChanges(
  before: string,
  after: string,
  lockedPartAtStart: (track: TrackRecord) => string | undefined,
): string | undefined {
  const [old, fresh] = [parseLayout(before).records, parseLayout(after).records]
  const textOf = (records: readonly LayoutRecord[]) => new Map(records.map((r) => [r.id, serializeRecords([r])]))
  const [oldText, freshText] = [textOf(old), textOf(fresh)]
  const found: string[] = []
  const seen = new Set<string>()
  for (const track of [...old, ...fresh]) {
    if (track.t !== "track" || seen.has(track.id) || oldText.get(track.id) === freshText.get(track.id)) continue
    const part = lockedPartAtStart(track)
    if (part === undefined) continue
    seen.add(track.id)
    found.push(`track ${track.id} (on the locked part ${part})`)
  }
  return found.length === 0 ? undefined : found.join(", ")
}

export type { TrackRecord, ViaRecord }
