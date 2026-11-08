import type { Actions } from "./App"
import type { HistoryListing } from "./api"
import { UndoIcon } from "./icons"

/** The changes from you and the agent, newest first, each with an undo. */
export function HistoryList({ history, actions }: { history: HistoryListing[]; actions: Actions }) {
  if (history.length === 0) return <p className="note">Changes from you and the agent appear here.</p>
  return (
    <ul className="history">
      {history.map((entry) => (
        <li key={entry.id} className={entry.undone ? "undone" : ""}>
          <span className={`who ${entry.author}`}>{entry.author === "ai" ? "Agent" : "You"}</span>
          <span className="what">{entry.summary}</span>
          {!entry.undone && !entry.undoOf && (
            <button className="icon" aria-label={`Undo ${entry.summary}`} onClick={() => void actions.undo(entry.id)}>
              <UndoIcon />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
