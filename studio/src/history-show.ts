// The Log's ways into the change view: Show on each row, and "Since my last change" above the list. Written without JSX
// so the tests render them as they render the other plain modules.
import { createElement as h, type ReactElement } from "react"
import type { HistoryListing } from "../../src/core/history.js"
import { sinceMyLast, type ChangeRequest } from "./change-view.js"

type Show = (request: ChangeRequest) => void

export function ShowButton({ entry, onShow }: { entry: Pick<HistoryListing, "id" | "summary">; onShow: Show }): ReactElement {
  return h("button", { type: "button", "aria-label": `Show change ${entry.id}: ${entry.summary}`, onClick: () => onShow({ id: entry.id }) }, "Show")
}

/** Everything the agent did after the person's newest change; nothing when the newest change is the person's own. */
export function SinceMine({ history, onShow }: { history: readonly Pick<HistoryListing, "id" | "author">[]; onShow: Show }): ReactElement | null {
  const since = sinceMyLast(history)
  if (since === undefined) return null
  return h("p", { className: "history-since" }, h("button", { type: "button", onClick: () => onShow({ since }) }, "Since my last change"))
}
