import type { KeyboardEvent, MouseEvent } from "react"
import { DEFAULT_PANEL_SIZES, keySize, type PanelEdge } from "./panel-sizes"
import type { PanelSplitter } from "./use-panel-sizes"
import { useSplitterDrag } from "./use-splitter-drag"
import "./splitter.css"

const LABELS: Record<PanelEdge, string> = { left: "Left panel width", right: "Right panel width", bottom: "Bottom panel height" }

interface Props extends PanelSplitter {
  edge: PanelEdge
  /** The id of the panel it sizes. */
  controls: string
}

/** A pointer press keeps the focus where it was (the arrow keys go on nudging parts) and starts no text selection. */
const keepFocus = (event: MouseEvent) => event.preventDefault()

/**
 * The splitter at a panel's inner edge: drag it to size the panel, double-click it for the default size, or focus it
 * and use the arrow keys, Home, End and Enter. `data-keys="own"` keeps those keys from the canvases while it has focus.
 */
export function Splitter(props: Props) {
  const { edge, size, limits, onCommit } = props
  const drag = useSplitterDrag(props)
  const onKeyDown = (event: KeyboardEvent) => {
    const next = keySize(edge, event, size, limits)
    if (next === null) return
    event.preventDefault()
    onCommit(next)
  }
  return (
    <div
      className={`splitter ${edge}${drag.dragging ? " dragging" : ""}`}
      role="separator"
      tabIndex={0}
      data-keys="own"
      aria-orientation={edge === "bottom" ? "horizontal" : "vertical"}
      aria-valuenow={drag.value}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-controls={props.controls}
      aria-label={LABELS[edge]}
      onKeyDown={onKeyDown}
      onMouseDown={keepFocus}
      onDoubleClick={() => onCommit(DEFAULT_PANEL_SIZES[edge])}
      {...drag.handlers}
    />
  )
}
