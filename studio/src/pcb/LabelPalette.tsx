// The schematic toolbar's Place group (Net label, GND, VCC) and the small name input that opens at a pin.
import { useState } from "react"
import { worldToScreen, type Camera, type Size } from "./geometry"
import type { LabelTool } from "./label-palette"
import type { useLabelPalette } from "./use-label-palette"

type Palette = ReturnType<typeof useLabelPalette>

const TOOLS: { tool: LabelTool; label: string; title: string }[] = [
  { tool: "label", label: "Net label", title: "Place a net label on a pin (Alt+N). Tab names it before you click." },
  { tool: "gnd", label: "GND", title: "Place a ground symbol on a pin" },
  { tool: "vcc", label: "VCC", title: "Place a power symbol on a pin. Tab to give it another name, such as V3_3." },
]

/** Choosing a tool arms it; choosing the armed tool again puts it away. */
export function PaletteButtons({ palette }: { palette: Palette }) {
  return (
    <>
      <span className="tool-divider" aria-hidden="true" />
      {TOOLS.map(({ tool, label, title }) => (
        <button
          key={tool}
          className={palette.tool === tool ? "active" : ""}
          aria-pressed={palette.tool === tool}
          title={title}
          onClick={() => {
            if (palette.tool === tool) palette.disarm()
            else palette.arm(tool)
          }}
        >
          {label}
        </button>
      ))}
    </>
  )
}

/** The hint under the toolbar while a tool is armed. */
export function paletteHint(palette: Palette): string | undefined {
  if (!palette.tool) return undefined
  const what = palette.tool === "gnd" ? "GND" : palette.tool === "vcc" ? (palette.typed || "VCC") : palette.typed || "a net label"
  const naming = palette.tool === "gnd" ? "" : " Tab changes the name."
  return `Click a pin to place ${what}.${naming} Esc or a right click stops.`
}

/** Opens at a pin (or the pointer) and asks for a net name; Enter places, Esc closes. */
export function NameInput({ palette, camera, size }: { palette: Palette; camera: Camera | undefined; size: Size }) {
  const { editing } = palette
  if (!editing || !camera) return null
  const at = worldToScreen(camera, size, editing.at)
  return <NameForm key={`${editing.pin ?? "tab"}:${editing.at.x}:${editing.at.y}`} at={at} initial={editing.initial} palette={palette} />
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
