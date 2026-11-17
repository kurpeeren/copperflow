// The 3D view's side panel: the readout and the list of parts. Written with createElement so the tests can draw it
// without a JSX step.
import { createElement as h } from "react"
import { FINISHES, FINISH_NAMES, MASKS, MASK_NAMES, SILKS, SILK_NAMES, type LookRequest } from "../../../src/engine/fab/picture/looks.js"
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

interface ChooserProps {
  look: LookRequest
  onLook(look: LookRequest): void
  /** False while the board's pictures are being made: the board is shown plain until then. */
  ready: boolean
}

/** The board's look by the same names as its pictures: the mask, the finish and the print. */
export function LookChooser({ look, onLook, ready }: ChooserProps) {
  const select = (label: string, value: string, names: readonly string[], word: (name: string) => string, set: (name: string) => LookRequest) =>
    h(
      "label",
      null,
      label,
      " ",
      h("select", { value, onChange: (event: { target: { value: string } }) => onLook(set(event.target.value)) }, names.map((name) => h("option", { key: name, value: name }, word(name)))),
    )
  return h(
    "div",
    { className: "look-chooser", role: "group", "aria-label": "How the board is made" },
    select("Mask", look.mask ?? "green", MASK_NAMES, (n) => MASKS[n as keyof typeof MASKS].name, (n) => ({ ...look, mask: n as LookRequest["mask"] })),
    select("Finish", look.finish ?? "enig", FINISH_NAMES, (n) => FINISHES[n as keyof typeof FINISHES].name, (n) => ({ ...look, finish: n as LookRequest["finish"] })),
    select("Print", look.silk ?? (look.mask === "white" ? "black" : "white"), SILK_NAMES, (n) => SILKS[n as keyof typeof SILKS].name, (n) => ({ ...look, silk: n as LookRequest["silk"] })),
    h("p", { className: "look-note", "aria-live": "polite" }, ready ? "The board as made, drawn from its fabrication layers." : "Drawing the board as made…"),
  )
}
