// The bar over a shown change: its name, Before / After / Both, what changed (each placed line centres the view on it),
// that the board cannot be edited, and Close. Written without JSX so the tests render it as they render the other plain
// modules; its styles are in change-bar.css.
import { createElement as h, type ReactElement } from "react"
import type { Point } from "../../../src/engine/model.js"
import { CHANGE_VIEW_MESSAGE, type ChangeMode, type ChangeViewState } from "../change-view.js"

const MODES: ReadonlyArray<{ mode: ChangeMode; label: string }> = [
  { mode: "before", label: "Before" },
  { mode: "after", label: "After" },
  { mode: "both", label: "Both" },
]

export interface ChangeBarProps {
  state: ChangeViewState
  onMode(mode: ChangeMode): void
  /** A line with a place was picked: centre the view on it. */
  onLine(at: Point): void
  onClose(): void
}

type Line = { text: string; at?: Point; items?: Line[] }

function lineItem(line: Line, index: number, onLine: (at: Point) => void): ReactElement {
  const { at, items } = line
  // A group of findings opens to list each one.
  if (items) return h("li", { key: index }, h("details", null, h("summary", null, line.text), h("ul", null, items.map((item, i) => lineItem(item, i, onLine)))))
  if (!at) return h("li", { key: index }, line.text)
  return h("li", { key: index }, h("button", { type: "button", className: "change-line", title: "Centre the view on it", onClick: () => onLine(at) }, line.text))
}

export function ChangeBar({ state, onMode, onLine, onClose }: ChangeBarProps): ReactElement {
  const data = state.status === "ready" ? state.data : undefined
  const fallback = "id" in state.request ? `Change ${state.request.id}` : state.request.since === "c0000" ? "Everything the agent did" : `Since ${state.request.since}`
  const modes = data?.onBoard
    ? h(
        "span",
        { className: "change-modes", role: "group", "aria-label": "Show" },
        MODES.map(({ mode, label }) => h("button", { key: mode, type: "button", "aria-pressed": state.mode === mode, onClick: () => onMode(mode) }, label)),
      )
    : null
  return h(
    "div",
    { className: "change-bar", role: "region", "aria-label": "Change view" },
    h(
      "div",
      { className: "change-head" },
      h("strong", { className: "change-title" }, data?.title ?? fallback),
      modes,
      h("button", { type: "button", className: "change-close", "aria-label": "Close the change view", onClick: onClose }, "Close"),
    ),
    h("p", { className: "change-note" }, CHANGE_VIEW_MESSAGE),
    state.status === "loading" ? h("p", { className: "change-note" }, "Building the change…") : null,
    state.status === "failed" ? h("p", { className: "change-error", role: "alert" }, state.error) : null,
    data ? h("ul", { className: "change-lines" }, data.lines.map((line, index) => lineItem(line, index, onLine))) : null,
  )
}
