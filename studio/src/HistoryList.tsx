import type { Actions } from "./App"
import type { HistoryListing, HistoryProblem } from "./api"
import type { ChangeRequest } from "./change-view"
import { ShowButton, SinceMine } from "./history-show"
import { historyRow } from "./history-rows"
import { UndoIcon } from "./icons"
import "./history-list.css"

interface Props {
  history: HistoryListing[]
  problems: HistoryProblem[]
  actions: Actions
  /** Shows a change, or everything after one, over the board. */
  onShow?(request: ChangeRequest): void
}

/** The changes from you and the agent, newest first, each with Show and an undo; undone and redone ones are marked. */
export function HistoryList({ history, problems, actions, onShow = () => undefined }: Props) {
  const skipped = problems.map((problem) => (
    <p key={problem.file} className="note" role="alert">
      Skipped {problem.file}: {problem.reason}
    </p>
  ))
  if (history.length === 0) return <>{problems.length === 0 && <p className="note">Changes from you and the agent appear here.</p>}{skipped}</>
  return (
    <>
    <SinceMine history={history} onShow={onShow} />
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
            <ShowButton entry={entry} onShow={onShow} />
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
