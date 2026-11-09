// The hint while a Place tool is armed and the small name input that opens at a pin.
import { useState } from "react"
import { worldToScreen, type Camera, type Size } from "./geometry"
import type { useLabelPalette } from "./use-label-palette"

type Palette = ReturnType<typeof useLabelPalette>

/** The hint under the toolbar while a tool is armed. */
export function paletteHint(palette: Palette): string | undefined {
  if (!palette.tool) return undefined
  const what = palette.tool === "gnd" ? "GND" : palette.tool === "vcc" ? (palette.typed || "VCC") : palette.typed || "a net label"
  const naming = palette.tool === "gnd" ? "" : " Tab changes the name."
  return `Click a pin to place ${what}.${naming} Esc or a right click stops.`
}

/** Opens at a pin (or the pointer, or a label to rename its net) and asks for a net name; Enter places or renames, Esc closes. */
export function NameInput({ palette, camera, size }: { palette: Palette; camera: Camera | undefined; size: Size }) {
  const { editing } = palette
  if (!editing || !camera) return null
  const at = worldToScreen(camera, size, editing.at)
  return <NameForm key={`${editing.pin ?? editing.rename?.id ?? "tab"}:${editing.at.x}:${editing.at.y}`} at={at} initial={editing.initial} palette={palette} />
}

function NameForm({ at, initial, palette }: { at: { x: number; y: number }; initial: string; palette: Palette }) {
  const [text, setText] = useState(initial)
  const [problem, setProblem] = useState<string>()
  return (
    <form
      className="label-name"
      style={{ left: at.x + 12, top: at.y + 12 }}
      onPointerDown={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault()
        setProblem(palette.submitName(text))
      }}
    >
      <input
        autoFocus
        aria-label="Net name"
        placeholder="Net name"
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Tab") e.preventDefault()
          if (e.key === "Escape") {
            e.stopPropagation()
            palette.cancelName()
          }
        }}
      />
      {problem && <span role="alert">{problem}</span>}
    </form>
  )
}
