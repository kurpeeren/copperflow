// How the Log (HistoryList.tsx) shows one change. Plain TypeScript with .js imports, so the tests can run it.
import type { HistoryListing } from "../../src/core/history.js"

export interface HistoryRow {
  /** "undone" strikes the summary through; "redone" mutes an undo that a redo took back. */
  className: "" | "undone" | "redone"
  /** Shown after the summary: which redo took the undo back, or brought the change back. */
  note?: string
  /** The row has an Undo button: a change in effect that is not itself an undo (a redo is an ordinary change). */
  undoable: boolean
}

export function historyRow(entry: Pick<HistoryListing, "undone" | "redoneAs" | "undoOf" | "redoOf">): HistoryRow {
  if (entry.undone) return { className: "undone", undoable: false }
  // A change a redo brought back lives on as that redo, whose row has the Undo button.
  if (entry.redoneAs) return { className: entry.undoOf ? "redone" : "", note: `redone as ${entry.redoneAs}`, undoable: false }
  return { className: "", undoable: entry.undoOf === undefined }
}
