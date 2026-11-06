import { useMemo } from "react"
import { checkGroups, checkSummary, NO_PROBLEMS, type CheckCounts, type CheckGroup, type CheckRow } from "./checks-list"
import { CloseIcon } from "./icons"
import { blurButton } from "./pcb/CanvasTools"
import "./checks-panel.css"

interface Props {
  rows: readonly CheckRow[]
  counts: CheckCounts
  /** The id of the row picked last. */
  active: string | null
  onPick(row: CheckRow): void
  onClose(): void
}

const ROW_TITLES: Record<CheckRow["view"], string> = { pcb: "Show on the PCB", schematic: "Show on the schematic", code: "From the code" }

/** The bottom panel: the last build's checks grouped by code, errors first. */
export function ChecksPanel({ rows, counts, active, onPick, onClose }: Props) {
  const groups = useMemo(() => checkGroups(rows), [rows])
  return (
    <section className="checks" aria-label="Checks" onClick={blurButton}>
      <header className="checks-head">
        <h2>Checks</h2>
        {rows.length > 0 && <span className="count">{checkSummary(counts)}</span>}
        <button className="icon" aria-label="Close checks" title="Close (\)" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="checks-body">
        {groups.length === 0 ? (
          <p className="note ok">{NO_PROBLEMS}</p>
        ) : (
          groups.map((group) => <CheckGroupList key={group.code} group={group} active={active} onPick={onPick} />)
        )}
      </div>
    </section>
  )
}

function CheckGroupList({ group, active, onPick }: { group: CheckGroup; active: string | null; onPick(row: CheckRow): void }) {
  return (
    <section className={`check-group ${group.severity}`}>
      <h3>
        <span className="dot" role="img" aria-label={group.severity === "error" ? "Error" : "Warning"} />
        <span className="code">{group.code}</span>
        <span className="count">{group.rows.length}</span>
      </h3>
      <ul>
        {group.rows.map((row) => (
          <li key={row.id}>
            <CheckRowButton row={row} active={row.id === active} onPick={onPick} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The message, then the items it names. */
function CheckRowButton({ row, active, onPick }: { row: CheckRow; active: boolean; onPick(row: CheckRow): void }) {
  return (
    <button className={`check-row ${row.severity}${active ? " active" : ""}`} aria-current={active || undefined} title={ROW_TITLES[row.view]} onClick={() => onPick(row)}>
      <span className="message">{row.message}</span>
      {row.items.length > 0 && <span className="items">{row.items.join(", ")}</span>}
    </button>
  )
}
