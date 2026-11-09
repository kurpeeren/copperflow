// The Text tool's small field, open where the sheet was clicked: Enter writes the text, Esc closes it, an empty text
// writes nothing (draw-tools.ts).
import { useState } from "react"
import { CANVAS_FONT_FAMILY } from "./ctx"
import { worldToScreen, type Camera, type Size } from "./geometry"
import type { useDrawTools } from "./use-draw-tools"

type DrawTools = ReturnType<typeof useDrawTools>

/** The field's frame (padding and border) and half the input's height, so the input starts at the point, centred on it. */
const FRAME_PX = 7
const HALF_FIELD_PX = 20

export function DrawTextInput({ draw, camera, size }: { draw: DrawTools; camera: Camera | undefined; size: Size }) {
  const at = draw.state?.tool === "text" ? draw.state.points[0] : undefined
  if (!at || !camera) return null
  const screen = worldToScreen(camera, size, at)
  return <TextForm key={`${at.x}:${at.y}`} left={screen.x - FRAME_PX} top={screen.y - HALF_FIELD_PX} draw={draw} />
}

function TextForm({ left, top, draw }: { left: number; top: number; draw: DrawTools }) {
  const [text, setText] = useState("")
  return (
    <form
      className="label-name"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault()
        draw.submitText(text)
      }}
    >
      <input
        autoFocus
        aria-label="Text"
        placeholder="Text"
        value={text}
        style={{ fontFamily: CANVAS_FONT_FAMILY }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return
          e.stopPropagation()
          draw.cancelText()
        }}
      />
    </form>
  )
}
