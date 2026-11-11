import { isPlacing, placeProgressText, type PlaceEvent } from "../../../src/studio/place-events.js"
import { blurAfterPointerClick } from "./focus"
import "./route-status.css"

/** While Place → Autoplace runs: how far it is, in the status bar, and Cancel. Its end is told in a note. */
export function PlaceStatus({ place, onCancel }: { place: PlaceEvent | undefined; onCancel(): void }) {
  if (!place || !isPlacing(place)) return null
  return (
    <div className="canvas-status route-status" role="status">
      <span>{placeProgressText(place)}</span>
      <button
        className="unit-toggle"
        onClick={(event) => {
          blurAfterPointerClick(event)
          onCancel()
        }}
        onPointerDown={(event) => event.stopPropagation()}
        title="Stop placing; nothing is written"
      >
        Cancel
      </button>
    </div>
  )
}
