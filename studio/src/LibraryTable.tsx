import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import type { PartsData } from "./api"
import { allowPlace, clampActive, clickPlaces, filterRows, libraryRows, rowKey, type LibraryRow } from "./library-table.js"
import "./library-table.css"

interface Props {
  parts: PartsData
  onPlace(part: string): void
  /** Opens the Verify screen of a library part (read-only for a verified one). */
  onVerify(part: string, title: string): void
}

/** Places a part once per intent: a double click or a held key asks again within PLACE_GAP_MS. */
function usePlaceOnce(onPlace: (part: string) => void): (part: string) => void {
  const lastPlace = useRef<number | null>(null)
  return (part: string) => {
    const now = Date.now()
    if (!allowPlace(lastPlace.current, now)) return
    lastPlace.current = now
    onPlace(part)
  }
}

function LibraryHead() {
  return (
    <thead>
      <tr>
        <th className="wide">Name</th>
        <th>Value</th>
        <th>Footprint</th>
        <th className="wide">Description</th>
        <th>Verified</th>
        <th className="action" aria-label="Verify" />
        <th className="action" aria-label="Place" />
      </tr>
    </thead>
  )
}

interface RowProps {
  row: LibraryRow
  /** The row holds the table's one tab stop. */
  tabStop: boolean
  onFocus(): void
  onPlace(): void
  onVerify(): void
  onKey(event: KeyboardEvent<HTMLTableRowElement>): void
}

/** One part: a double click or Enter on the row places it, and so does its Place button. */
function PartRow({ row, tabStop, onFocus, onPlace, onVerify, onKey }: RowProps) {
  return (
    <tr tabIndex={tabStop ? 0 : -1} title={row.tooltip} onFocus={onFocus} onDoubleClick={onPlace} onKeyDown={onKey}>
      <td className="wide">{row.name}</td>
      <td>{row.value}</td>
      <td>{row.footprint}</td>
      <td className="wide">{row.description}</td>
      <td>{row.verified && <span className={`badge ${row.verified === "Verified" ? "verified" : "unverified"}`} title={row.verifiedTip}>{row.verified}</span>}</td>
      {/* The focused row's Verify button is the next Tab stop, so the keyboard reaches it too. */}
      <td className="action">
        {row.verified && (
          <button className="lib-place" tabIndex={tabStop ? 0 : -1} onClick={onVerify} onDoubleClick={(e) => e.stopPropagation()} aria-label={row.verified === "Verified" ? `Look again at ${row.description}` : `Verify ${row.description}`}>
            {row.verified === "Verified" ? "Look again" : "Verify…"}
          </button>
        )}
      </td>
      <td className="action">
        <button className="lib-place" tabIndex={-1} onClick={(e) => clickPlaces(e.detail) && onPlace()} onDoubleClick={(e) => e.stopPropagation()} aria-label={`Place ${row.name}`}>
          Place
        </button>
      </td>
    </tr>
  )
}

/** The Library tab of the bottom panel: every part as a table row, with one search over all columns. */
export function LibraryTable({ parts, onPlace, onVerify }: Props) {
  const [query, setQuery] = useState("")
  const body = useRef<HTMLTableSectionElement>(null)
  const [active, setActive] = useState(0)
  const hint = useId()
  const place = usePlaceOnce(onPlace)
  const rows = useMemo(() => filterRows(libraryRows(parts), query), [parts, query])
  const stop = clampActive(active, rows.length)

  const onKey = (event: KeyboardEvent<HTMLTableRowElement>, index: number, part: string) => {
    if (event.target !== event.currentTarget) return
    const result = rowKey(event.key, index, rows.length, event.repeat)
    if (!result) return
    event.preventDefault()
    if ("place" in result) place(part)
    else (body.current?.rows[result.move] as HTMLElement | undefined)?.focus()
  }

  return (
    <div className="lib-table">
      <input className="lib-table-search" type="search" placeholder="Search parts" aria-label="Search parts" value={query} onChange={(e) => setQuery(e.target.value)} />
      <p id={hint} className="lib-table-hint">
        Enter places the focused part; so does a double click on a row.
      </p>
      <div className="lib-table-scroll hairline-t">
        <table aria-label="Library parts" aria-describedby={hint}>
          <LibraryHead />
          <tbody ref={body}>
            {rows.map((row, index) => (
              <PartRow key={row.part} row={row} tabStop={index === stop} onFocus={() => setActive(index)} onPlace={() => place(row.part)} onVerify={() => onVerify(row.part, row.description)} onKey={(e) => onKey(e, index, row.part)} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="note lib-table-empty">No parts match.</p>}
      </div>
    </div>
  )
}
