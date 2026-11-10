import type { Actions } from "./App"
import type { HistoryListing, HistoryProblem } from "./api"
import { historyRow } from "./history-rows"
import { UndoIcon } from "./icons"
import "./history-list.css"

/** The changes from you and the agent, newest first, each with an undo; undone and redone ones are marked. */
export function HistoryList({ history, problems, actions }: { history: HistoryListing[]; problems: HistoryProblem[]; actions: Actions }) {
  const skipped = problems.map((problem) => (
    <p key={problem.file} className="note" role="alert">
      Skipped {problem.file}: {problem.reason}
    </p>
  ))
  if (history.length === 0) return <>{problems.length === 0 && <p className="note">Changes from you and the agent appear here.</p>}{skipped}</>
  return (
    <>
    <ul className="history">
      {history.map((entry) => {
        const row = historyRow(entry)
        return (
          <li key={entry.id} className={row.className}>
            <span className={`who ${entry.author}`}>{entry.author === "ai" ? "Agent" : "You"}</span>
            <span className="what" title={entry.file}>
              {entry.summary}
            </span>
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
    {skipped}
    </>
  )
}
