import { useMemo, useRef, useState, type KeyboardEvent } from "react"
import type { PartsData } from "./api"
import { allowPlace, clampActive, clickPlaces, filterRows, libraryRows, rowKey } from "./library-table.js"
import "./library-table.css"

interface Props {
  parts: PartsData
  onPlace(part: string): void
}

/** The Library tab of the bottom panel: every part as a table row, with one search over all columns. */
export function LibraryTable({ parts, onPlace }: Props) {
  const [query, setQuery] = useState("")
  const body = useRef<HTMLTableSectionElement>(null)
  const [active, setActive] = useState(0)
  const lastPlace = useRef<number | null>(null)
  const rows = useMemo(() => filterRows(libraryRows(parts), query), [parts, query])
  const stop = clampActive(active, rows.length)

  const place = (part: string) => {
    const now = Date.now()
    if (!allowPlace(lastPlace.current, now)) return
    lastPlace.current = now
    onPlace(part)
  }

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
      <input
        className="lib-table-search"
        type="search"
        placeholder="Search parts"
        aria-label="Search parts"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="lib-table-scroll">
        <table>
          <thead>
            <tr>
              <th className="wide">Name</th>
              <th>Value</th>
              <th>Footprint</th>
              <th className="wide">Description</th>
              <th>Verified</th>
              <th className="action" aria-label="Place" />
            </tr>
          </thead>
          <tbody ref={body}>
            {rows.map((row, index) => (
              <tr
                key={row.part}
                tabIndex={index === stop ? 0 : -1}
                title={row.tooltip}
                onFocus={() => setActive(index)}
                onDoubleClick={() => place(row.part)}
                onKeyDown={(e) => onKey(e, index, row.part)}>
                <td className="wide">{row.name}</td>
                <td>{row.value}</td>
                <td>{row.footprint}</td>
                <td className="wide">{row.description}</td>
                <td>{row.verified && <span className={`badge ${row.verified === "Verified" ? "verified" : "unverified"}`} title={row.verifiedTip}>{row.verified}</span>}</td>
                <td className="action">
                  <button
                    className="lib-place"
                    tabIndex={-1}
                    onClick={(e) => clickPlaces(e.detail) && place(row.part)}
                    onDoubleClick={(e) => e.stopPropagation()}
                    aria-label={`Place ${row.name}`}>
                    Place
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="note lib-table-empty">No parts match.</p>}
      </div>
    </div>
  )
}
