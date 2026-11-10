import { isRouting, routeProgressText, type RouteEvent } from "../../../src/studio/route-events.js"
import { blurAfterPointerClick } from "./focus"
import "./route-status.css"

/** While Route → Autoroute runs: how far it is, in the status bar, and Cancel. Its end is told in a note. */
export function RouteStatus({ route, onCancel }: { route: RouteEvent | undefined; onCancel(): void }) {
  if (!route || !isRouting(route)) return null
  return (
    <div className="canvas-status route-status" role="status">
      <span>{routeProgressText(route)}</span>
      <button
        className="unit-toggle"
        onClick={(event) => {
          blurAfterPointerClick(event)
          onCancel()
        }}
        onPointerDown={(event) => event.stopPropagation()}
        title="Stop routing; nothing is written"
      >
        Cancel
      </button>
    </div>
  )
}
