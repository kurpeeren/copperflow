import { useMemo } from "react"
import type { Design } from "./api"
import { NO_HIGHLIGHT, type Highlight } from "./pcb/highlight"
import { netRows } from "./net-rows"

interface Props {
  design: Design | undefined
  highlight: Highlight
  onHighlight(nets: Highlight): void
}

/** Every net of the design; a click highlights it alone in both views, a second click clears it. */
export function NetsList({ design, highlight, onHighlight }: Props) {
  const rows = useMemo(() => (design ? netRows(design) : []), [design])
  if (rows.length === 0) return <p className="note">No nets yet.</p>
  const alone = (id: string) => highlight.length === 1 && highlight[0] === id
  return (
    <ul className="nets">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            className={`row${highlight.includes(row.id) ? " selected" : ""}`}
            aria-pressed={highlight.includes(row.id)}
            onClick={() => onHighlight(alone(row.id) ? NO_HIGHLIGHT : [row.id])}
            title={alone(row.id) ? "Click to clear the highlight" : "Click to highlight this net"}
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
