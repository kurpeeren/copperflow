import { useMemo, useState, type KeyboardEvent } from "react"
import type { Footprint, Pad } from "../../../src/engine/footprints/types.js"
import { PALETTE } from "../pcb/ctx"
import { landPatternFigures, mm, padExtent } from "./verify-figures"
import { measureText, padInfo, padsInOrder } from "./verify-measure"

/** The footprint drawn in the PCB view's colours, so it looks here as it does on the board, in both themes. */
const LOOK = {
  board: PALETTE.background,
  pad: PALETTE.topCopper,
  throughPad: PALETTE.multiLayer,
  drill: PALETTE.drill,
  courtyard: PALETTE.topAssembly,
  silk: PALETTE.topSilk,
  origin: PALETTE.document,
  picked: PALETTE.highlight,
}

/** Room round the drawing, in mm. */
const MARGIN = 1

export const PAD_HINT = "Hover over or focus a pad to read it. A click, Enter or Space picks it for the measure."
export const MEASURE_HINT = "Pick two pads to measure between them."

function viewBox(footprint: Footprint): string {
  const points = [...footprint.courtyard, { x: 0, y: 0 }, ...footprint.pads.flatMap((pad) => {
    const size = padExtent(pad)
    return [
      { x: pad.x - size.width / 2, y: pad.y - size.height / 2 },
      { x: pad.x + size.width / 2, y: pad.y + size.height / 2 },
    ]
  })]
  const [minX, maxX] = [Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x))]
  const [minY, maxY] = [Math.min(...points.map((p) => -p.y)), Math.max(...points.map((p) => -p.y))]
  return `${mm(minX - MARGIN)} ${mm(minY - MARGIN)} ${mm(maxX - minX + 2 * MARGIN)} ${mm(maxY - minY + 2 * MARGIN)}`
}

interface PadProps {
  pad: Pad
  pin: string | undefined
  picked: boolean
  onShow(pad: Pad): void
  onPick(pad: Pad): void
}

function PadMark({ pad, pin, picked, onShow, onPick }: PadProps) {
  const label = padInfo(pad, pin)
  const size = Math.max(0.25, Math.min(pad.width, pad.height) * 0.5)
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    onPick(pad)
  }
  const body =
    pad.shape === "circle" || pad.shape === "oval" ? (
      <ellipse rx={pad.width / 2} ry={pad.height / 2} />
    ) : (
      <rect x={-pad.width / 2} y={-pad.height / 2} width={pad.width} height={pad.height} rx={pad.cornerRadius ?? 0} />
    )
  return (
    <g className="verify-pad" role="button" tabIndex={0} aria-label={label} aria-pressed={picked} onMouseEnter={() => onShow(pad)} onFocus={() => onShow(pad)} onClick={() => onPick(pad)} onKeyDown={onKey}>
      <title>{label}</title>
      <g transform={`translate(${pad.x} ${-pad.y}) rotate(${-pad.rotation})`} fill={pad.layers === "through" ? LOOK.throughPad : LOOK.pad} stroke={picked ? LOOK.picked : "none"} strokeWidth={0.08}>
        {body}
        {pad.drill && <ellipse rx={pad.drill.width / 2} ry={pad.drill.height / 2} fill={LOOK.drill} />}
      </g>
      <text x={pad.x} y={-pad.y + size / 3} fontSize={size} textAnchor="middle" fill={LOOK.origin}>
        {pad.number}
      </text>
    </g>
  )
}

/** Pin 1: a dot outside pad 1, on the side away from the part's centre. */
function PinOne({ pads }: { pads: readonly Pad[] }) {
  const first = pads.find((pad) => pad.number === "1")
  if (!first) return null
  const size = padExtent(first)
  const outward = Math.abs(first.x) >= Math.abs(first.y) ? { x: Math.sign(first.x) || -1, y: 0 } : { x: 0, y: Math.sign(first.y) || 1 }
  const at = { x: first.x + outward.x * (size.width / 2 + 0.4), y: first.y + outward.y * (size.height / 2 + 0.4) }
  return <circle className="verify-pin-one" cx={at.x} cy={-at.y} r={0.2} fill={LOOK.silk} aria-hidden="true" />
}

function Drawing({ footprint, pins, picked, onShow, onPick }: { footprint: Footprint; pins: Readonly<Record<string, { name: string }>>; picked: readonly Pad[]; onShow(pad: Pad): void; onPick(pad: Pad): void }) {
  const box = viewBox(footprint)
  const [x, y, width, height] = box.split(" ").map(Number) as [number, number, number, number]
  const court = footprint.courtyard.map((p) => `${p.x},${-p.y}`).join(" ")
  return (
    <svg className="verify-drawing" viewBox={box} role="group" aria-label={`Footprint ${footprint.name}, top view, pad 1 marked with a dot`}>
      <rect x={x} y={y} width={width} height={height} fill={LOOK.board} />
      {court !== "" && <polygon points={court} fill="none" stroke={LOOK.courtyard} strokeWidth={0.05} strokeDasharray="0.2 0.2" />}
      {footprint.silkscreen.map((line, index) => (
        <polyline key={index} points={line.map((p) => `${p.x},${-p.y}`).join(" ")} fill="none" stroke={LOOK.silk} strokeWidth={0.1} />
      ))}
      <path d="M -0.5 0 H 0.5 M 0 -0.5 V 0.5" stroke={LOOK.origin} strokeWidth={0.05} aria-hidden="true" />
      <PinOne pads={footprint.pads} />
      {padsInOrder(footprint.pads).map((pad, index) => (
        <PadMark key={`${pad.number}-${index}`} pad={pad} pin={pins[pad.number]?.name} picked={picked.includes(pad)} onShow={onShow} onPick={onPick} />
      ))}
    </svg>
  )
}

/** The footprint to measure: the drawing, its figures, a pad's details, the measure between two pads and Print at 1:1. */
export function VerifyFootprint({ footprint, pins, placeholder, onPrint }: { footprint: Footprint; pins: Readonly<Record<string, { name: string }>>; placeholder?: string; onPrint(): void }) {
  const [shown, setShown] = useState<Pad>()
  const [picked, setPicked] = useState<Pad[]>([])
  const figures = useMemo(() => landPatternFigures(footprint.pads), [footprint])
  const pick = (pad: Pad) => setPicked((current) => (current.includes(pad) ? current.filter((one) => one !== pad) : [...current.slice(-1), pad]))
  const [a, b] = picked
  return (
    <section className="verify-column" aria-label="Footprint">
      <h3>Footprint {footprint.name}</h3>
      {placeholder && <p className="note warn">{placeholder}</p>}
      <Drawing footprint={footprint} pins={pins} picked={picked} onShow={setShown} onPick={pick} />
      <p className="verify-readout" aria-live="polite">
        {shown ? padInfo(shown, pins[shown.number]?.name) : PAD_HINT}
      </p>
      <p className="verify-readout" aria-live="polite">
        {a && b ? measureText(a, b) : a ? `Pad ${a.number} picked; pick a second pad.` : MEASURE_HINT}
      </p>
      <div className="verify-actions">
        <button type="button" onClick={() => setPicked([])} disabled={picked.length === 0}>
          Clear the measure
        </button>
        <button type="button" onClick={onPrint}>
          Print at 1:1
        </button>
      </div>
      <table className="verify-figures" aria-label="Land pattern figures">
        <tbody>
          {figures.map((figure) => (
            <tr key={figure.label}>
              <th scope="row">{figure.label}</th>
              <td>{figure.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Courtyard dashed, origin a cross, pad 1 marked with a dot; mm, top view.</p>
    </section>
  )
}
