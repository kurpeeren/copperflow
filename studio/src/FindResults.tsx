import { blurAfterPointerClick } from "./shell/focus"
import { FIND_IDLE, findNothing, matchSummary, type FindRow } from "./find"
import type { FindResultsProps } from "./use-find"
import "./find.css"

const ROW_TITLES: Record<FindRow["kind"], string> = { part: "Select the part", net: "Highlight the net" }

/** The Find Results tab of the bottom panel: one row per hit, parts first, then nets. */
export function FindResults({ query, rows, active, pick }: FindResultsProps) {
  if (query === null) return <p className="note bottom-note">{FIND_IDLE}</p>
  if (rows.length === 0) return <p className="note bottom-note">{findNothing(query)}</p>
  return (
    <section className="find-results" aria-label="Find results" onClick={blurAfterPointerClick}>
      <header className="find-head">
        <h2>Find results</h2>
        <span className="count">{`${rows.length} found for "${query}"`}</span>
      </header>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <button className={`find-row${row.id === active ? " active" : ""}`} aria-current={row.id === active || undefined} title={ROW_TITLES[row.kind]} onClick={() => pick(row)}>
              <span className={`kind ${row.kind}`}>{row.kind === "part" ? "Part" : "Net"}</span>
              <span className="name">{row.name}</span>
              <span className="matched">{matchSummary(row)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
