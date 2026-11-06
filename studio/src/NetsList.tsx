import { useMemo } from "react"
import type { Design } from "./api"
import { netRows } from "./net-rows"

interface Props {
  design: Design | undefined
  highlight: string | null
  onHighlight(net: string | null): void
}

/** Every net of the design; a click highlights it in both views, a second click clears it. */
export function NetsList({ design, highlight, onHighlight }: Props) {
  const rows = useMemo(() => (design ? netRows(design) : []), [design])
  if (rows.length === 0) return <p className="note">No nets yet.</p>
  return (
    <ul className="nets">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            className={`row${highlight === row.id ? " selected" : ""}`}
            aria-pressed={highlight === row.id}
            onClick={() => onHighlight(highlight === row.id ? null : row.id)}
            title={highlight === row.id ? "Click to clear the highlight" : "Click to highlight this net"}
          >
            <span className="name">{row.label}</span>
            {row.badge && <span className={`badge ${row.badge}`}>{row.badge}</span>}
            <span className="value">{row.pins === 1 ? "1 pin" : `${row.pins} pins`}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
