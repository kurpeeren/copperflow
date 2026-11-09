// How the Log (HistoryList.tsx) shows one change. Plain TypeScript with .js imports, so the tests can run it.
import type { HistoryListing } from "../../src/core/history.js"

export interface HistoryRow {
  /** "undone" strikes the summary through; "redone" mutes an undo that a redo took back. */
  className: "" | "undone" | "redone"
  /** A word shown after the summary. */
  note?: "redone"
  /** The row has an Undo button: a change that is not undone and is not itself an undo (a redo is an ordinary change). */
  undoable: boolean
}

export function historyRow(entry: Pick<HistoryListing, "undone" | "redone" | "undoOf" | "redoOf">): HistoryRow {
  if (entry.undone) return { className: "undone", undoable: false }
  if (entry.redone) return { className: "redone", note: "redone", undoable: false }
  return { className: "", undoable: entry.undoOf === undefined }
}
