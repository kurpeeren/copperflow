// The 3D view's side panel: the readout and the list of parts. Written with createElement so the tests can draw it
// without a JSX step.
import { createElement as h } from "react"
import type { SolidModel } from "../../../src/engine/solid/model.js"
import { hoverText, lookReadout } from "./readout.js"

/** The readout: the board's size, the tallest part on each side, the total height, and what the model is not. */
export function LookReadout({ model }: { model: SolidModel }) {
  const readout = lookReadout(model)
  return h(
    "ul",
    { className: "look-readout", "aria-label": "Sizes" },
    h("li", null, readout.board),
    h("li", null, readout.top),
    h("li", null, readout.bottom),
    h("li", null, readout.total),
    h("li", { className: "look-limits" }, readout.limits),
  )
}

interface PartsProps {
  model: SolidModel
  /** The part named now, by its index; it is drawn lighter. */
  active: number | undefined
  onActive(index: number | undefined): void
}

/** Every part as a button that names it and its height when hovered or focused; nothing is changed by pressing it. */
export function LookParts({ model, active, onActive }: PartsProps) {
  return h(
    "ul",
    { className: "look-parts", "aria-label": "Parts" },
    model.parts.map((part, index) =>
      h(
        "li",
        { key: part.name },
        h(
          "button",
          {
            type: "button",
            "aria-pressed": active === index,
            onFocus: () => onActive(index),
            onBlur: () => onActive(undefined),
            onMouseEnter: () => onActive(index),
            onMouseLeave: () => onActive(undefined),
          },
          hoverText(part),
        ),
      ),
    ),
  )
}
