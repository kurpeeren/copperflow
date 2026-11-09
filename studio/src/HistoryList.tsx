import type { Actions } from "./App"
import type { HistoryListing } from "./api"
import { historyRow } from "./history-rows"
import { UndoIcon } from "./icons"
import "./history-list.css"

/** The changes from you and the agent, newest first, each with an undo; undone and redone ones are marked. */
export function HistoryList({ history, actions }: { history: HistoryListing[]; actions: Actions }) {
  if (history.length === 0) return <p className="note">Changes from you and the agent appear here.</p>
  return (
    <ul className="history">
      {history.map((entry) => {
        const row = historyRow(entry)
        return (
          <li key={entry.id} className={row.className}>
            <span className={`who ${entry.author}`}>{entry.author === "ai" ? "Agent" : "You"}</span>
            <span className="what">{entry.summary}</span>
            {row.note && <span className="history-note">{row.note}</span>}
            {row.undoable && (
              <button className="icon" aria-label={`Undo ${entry.summary}`} onClick={() => void actions.undo(entry.id)}>
                <UndoIcon />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
