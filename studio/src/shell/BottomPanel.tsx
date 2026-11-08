import type { Actions } from "../App"
import type { HistoryListing, PartsData } from "../api"
import { ChecksPanel } from "../ChecksPanel"
import type { CheckCounts, CheckRow } from "../checks-list"
import { HistoryList } from "../HistoryList"
import { Library } from "../Library"
import { blurButton } from "../pcb/CanvasTools"
import type { BottomTab } from "./bottom-state"
import "./bottom.css"

interface Props {
  tab: BottomTab
  parts: PartsData
  onPlace(part: string): void
  history: HistoryListing[]
  actions: Actions
  built: boolean
  rows: readonly CheckRow[]
  counts: CheckCounts
  active: string | null
  onPick(row: CheckRow): void
}

/** The open bottom panel: the content of the chosen tab, above the strip. */
export function BottomPanel(props: Props) {
  return (
    <div className="bottom-panel" onClick={blurButton}>
      <Content {...props} />
    </div>
  )
}

function noop(): void {}

function Content(props: Props) {
  switch (props.tab) {
    case "library":
      return (
        <div className="bottom-scroll">
          <Library parts={props.parts} onPlace={props.onPlace} focus={false} onFocused={noop} />
        </div>
      )
    case "log":
      return (
        <div className="bottom-scroll">
          <HistoryList history={props.history} actions={props.actions} />
        </div>
      )
    case "drc":
      if (!props.built) return <p className="note bottom-note">Building the circuit…</p>
      return <ChecksPanel rows={props.rows} counts={props.counts} active={props.active} onPick={props.onPick} />
    case "find":
      return <p className="note bottom-note">Press Ctrl+F to find a part or a net.</p>
  }
}
