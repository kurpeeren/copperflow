// The drawing tools' small field. The Text tool's opens where the sheet was clicked: Enter writes the text, Esc closes
// it, an empty text writes nothing, and a second click moves the field and keeps what was typed. The Bus tool's opens
// at a finished bus's last point with the next free name (BUS1, BUS2 …) selected: Enter writes the bus, a name the
// engine would refuse is refused here with the reason, Esc drops the bus (draw-tools.ts, bus-tool.ts). The PCB's
// text tool asks for its words in the same field (InlineTextField).
import { useEffect, useRef, useState } from "react"
import { CANVAS_FONT_FAMILY } from "./ctx"
import { worldToScreen, type Camera, type Point, type Size } from "./geometry"
import type { useDrawTools } from "./use-draw-tools"

type DrawTools = ReturnType<typeof useDrawTools>

/** The field's frame (padding and border) and half the input's height, so the input starts at the point, centred on it. */
const FRAME_PX = 7
const HALF_FIELD_PX = 20

export interface Field {
  label: string
  /** What the field starts with, selected so typing replaces it; a text starts empty. */
  initial: string
  at: { x: number; y: number }
}

/** What a field does with its words: Enter submits them (a reason comes back when they are refused), Esc cancels. */
export interface FieldActions {
  submit(text: string): string | undefined
  cancel(): void
}

/** The field the armed tool asks for, if any: a text at its point, or a finished bus's name at its last point. */
function fieldOf(draw: DrawTools): Field | undefined {
  const { state } = draw
  if (state?.tool === "text" && state.points[0]) return { label: "Text", initial: "", at: state.points[0] }
  const last = state?.points.at(-1)
  if (state?.tool === "bus" && state.naming && last) return { label: "Bus name", initial: draw.busName(), at: last }
  return undefined
}

export function DrawTextInput({ draw, camera, size }: { draw: DrawTools; camera: Camera | undefined; size: Size }) {
  const field = fieldOf(draw)
  if (!field || !camera) return null
  return <InlineTextField key={field.label} field={field} camera={camera} size={size} actions={{ submit: draw.submitText, cancel: draw.cancelText }} />
}

/** The field at a point of the canvas, its input starting at the point. */
export function InlineTextField({ field, camera, size, actions }: { field: Field & { at: Point }; camera: Camera; size: Size; actions: FieldActions }) {
  const screen = worldToScreen(camera, size, field.at)
  return <TextForm left={screen.x - FRAME_PX} top={screen.y - HALF_FIELD_PX} field={field} actions={actions} />
}

function TextForm({ left, top, field, actions }: { left: number; top: number; field: Field; actions: FieldActions }) {
  const [text, setText] = useState(field.initial)
  const [problem, setProblem] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  // Focus the field when it opens or moves, after the click that did it is over, so the canvas never keeps the keys.
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [left, top])
  return (
    <form
      className="label-name"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault()
        setProblem(actions.submit(text))
      }}
    >
      <input
        ref={input}
        autoFocus
        aria-label={field.label}
        placeholder={field.label}
        value={text}
        style={{ fontFamily: CANVAS_FONT_FAMILY }}
        onFocus={(e) => field.initial !== "" && e.currentTarget.select()}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return
          e.stopPropagation()
          actions.cancel()
        }}
      />
      {problem && <span role="alert">{problem}</span>}
    </form>
  )
}
