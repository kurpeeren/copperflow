// Writes a perfboard's or stripboard's solder runs, links and cuts into the circuit's layout file as one history
// entry: the router's drafts get the next ids of their kinds, and records named for removal go (a locked one is
// refused). Who made a record comes from the writer, never from the draft. The copper and reference lines stay.
import { EditError } from "./edit-error.js"
import { inProjectQueue, readIfThere, writeNew, writeWithHistory } from "./file-writes.js"
import type { Author, HistoryEntry } from "./history.js"
import { EMPTY_LAYOUT, layoutPathFor, readLayoutText, serializeLayout, type LayoutMaker } from "./layout-file.js"
import { checkProto, nextProtoId, type ProtoRecord } from "./layout-proto.js"
import { resolveCircuit, resolveLayoutFile } from "./workspace.js"
import type { ProtoDraft } from "../engine/proto/route.js"

export interface ProtoWriteOptions {
  author: Author
  /** Set by the router's code path: new records are marked `router`. */
  router?: boolean
  summary: string
  /** Runs first inside the project's write queue; a throw stops the write. */
  guard?: () => Promise<void>
}

export interface ProtoWriteResult {
  entry: HistoryEntry
  /** The records added, with their ids, in draft order. */
  added: ProtoRecord[]
  removed: string[]
}

const MAKER: Record<Author, LayoutMaker> = { human: "human", ai: "agent" }

/** The records after adding the drafts and removing the ids; a locked record or an unknown id is refused. */
export function protoAfter(records: readonly ProtoRecord[], drafts: readonly ProtoDraft[], remove: readonly string[], by: LayoutMaker): { records: ProtoRecord[]; added: ProtoRecord[] } {
  const gone = new Set(remove)
  for (const id of gone) {
    const record = records.find((r) => r.id === id)
    if (!record) throw new EditError("not_found", `There is no solder run, link or cut ${id}`)
    if (record.locked) throw new EditError("locked", `${id} is locked; ask the human to unlock it`)
  }
  const kept = records.filter((r) => !gone.has(r.id))
  const added: ProtoRecord[] = []
  for (const draft of drafts) {
    const checked = checkProto({ ...draft, id: nextProtoId([...records, ...added], draft.t), locked: false, by })
    if ("problems" in checked) throw new EditError("invalid", `The new ${draft.t}: ${checked.problems.join("; ")}`)
    added.push(checked.record)
  }
  return { records: [...kept, ...added], added }
}

/** Adds the drafts and removes the named records in the circuit's layout file, as one history entry. */
export async function applyProtoEdits(root: string, file: string, drafts: readonly ProtoDraft[], remove: readonly string[], options: ProtoWriteOptions): Promise<ProtoWriteResult> {
  if (drafts.length === 0 && remove.length === 0) throw new EditError("invalid", "No solder, links or cuts were given")
  const circuit = await resolveCircuit(root, file)
  const layout = await resolveLayoutFile(root, layoutPathFor(circuit.file))
  return inProjectQueue(root, async () => {
    await options.guard?.()
    const source = await readIfThere(layout.path)
    const before = source === undefined ? EMPTY_LAYOUT : readLayoutText(source, layout.file)
    const by = options.router ? "router" : MAKER[options.author]
    const { records, added } = protoAfter(before.proto ?? [], drafts, remove, by)
    const text = serializeLayout({ ...before, ...(records.length > 0 ? { proto: records } : { proto: undefined }) })
    if (text === (source ?? "")) throw new EditError("invalid", "The change made no change")
    const data = { author: options.author, summary: options.summary }
    const entry = source === undefined ? await writeNew(root, layout.path, text, data) : await writeWithHistory(root, { ...layout, source }, text, { ...data, file: layout.file, before: source, after: text })
    return { entry, added, removed: [...remove] }
  })
}
