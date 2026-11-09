import type { Actions } from "../App"
import type { HistoryListing, PartsData } from "../api"
import { ChecksPanel } from "../ChecksPanel"
import { FindResults } from "../FindResults"
import type { FindResultsProps } from "../use-find"
import type { CheckCounts, CheckRow } from "../checks-list"
import { HistoryList } from "../HistoryList"
import { LibraryTable } from "../LibraryTable"
import { BOTTOM_PANEL_ID, bottomTabId, type BottomTab } from "./bottom-state"
import { blurAfterPointerClick } from "./focus"
import "./bottom.css"

interface Props {
  tab: BottomTab
  parts: PartsData
  onPlace(part: string): void
  history: HistoryListing[]
  actions: Actions
  built: boolean
  /** Why the build failed, when it did and no design exists yet. */
  buildError?: string
  rows: readonly CheckRow[]
  counts: CheckCounts
  active: string | null
  onPick(row: CheckRow): void
  find: FindResultsProps
}

/** The open bottom panel: the content of the chosen tab, above the strip. */
export function BottomPanel(props: Props) {
  return (
    <div className="bottom-panel" id={BOTTOM_PANEL_ID} role="tabpanel" aria-labelledby={bottomTabId(props.tab)} onClick={blurAfterPointerClick}>
      <Content {...props} />
    </div>
  )
}

function Content(props: Props) {
  switch (props.tab) {
    case "library":
      return (
        <LibraryTable parts={props.parts} onPlace={props.onPlace} />
      )
    case "log":
      return (
        <div className="bottom-scroll">
          <HistoryList history={props.history} actions={props.actions} />
        </div>
      )
    case "drc":
      if (!props.built) return <p className="note bottom-note">{props.buildError ?? "Building the circuit…"}</p>
      return <ChecksPanel rows={props.rows} counts={props.counts} active={props.active} onPick={props.onPick} />
    case "find":
      return <FindResults {...props.find} />
  }
}
