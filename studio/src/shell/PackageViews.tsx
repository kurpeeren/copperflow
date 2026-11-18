// The Packages dialog's two pictures of one footprint string: its pads (numbered), courtyard, silkscreen and body in
// the PCB view's colours, and its simple 3D shape on a patch of board, turned by dragging or by the arrows.
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import { PALETTE } from "../pcb/ctx"
import { lonePart, loneScene } from "../look/parts/single"
import { dragged, START, type Orbit } from "../look/orbit"
import { renderScene, renderSmooth } from "../look/raster"
import { rgb } from "../look/scene"
import { footprintPreview, type FootprintPreview, type PreviewPad } from "./footprint-preview"

export const VIEW_SIZE = { width: 260, height: 190 }
/** Pads smaller than this on screen, in pixels, carry no number: it would not fit. */
const NUMBER_ROOM = 9
/** After the 3D view has been still this long it is drawn again finer. */
const REST_MS = 160

const LOOK = {
  board: PALETTE.background,
  pad: PALETTE.topCopper,
  throughPad: PALETTE.multiLayer,
  drill: PALETTE.drill,
  outline: PALETTE.topAssembly,
  silk: PALETTE.topSilk,
  number: PALETTE.background,
}

/** A canvas sized for the screen's pixels, its context drawing in CSS pixels. */
function sized(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1
  canvas.width = VIEW_SIZE.width * ratio
  canvas.height = VIEW_SIZE.height * ratio
  const context = canvas.getContext("2d")
  context?.setTransform(ratio, 0, 0, ratio, 0, 0)
  return context
}

function strokeLines(context: CanvasRenderingContext2D, lines: readonly (readonly { x: number; y: number }[])[], colour: string, closed: boolean, dash: number[] = []): void {
  context.strokeStyle = colour
  context.lineWidth = 1
  context.setLineDash(dash)
  for (const line of lines) {
    context.beginPath()
    line.forEach((p, i) => (i === 0 ? context.moveTo(p.x, p.y) : context.lineTo(p.x, p.y)))
    if (closed) context.closePath()
    context.stroke()
  }
  context.setLineDash([])
}

function drawPad(context: CanvasRenderingContext2D, pad: PreviewPad): void {
  context.save()
  context.translate(pad.x, pad.y)
  context.rotate((pad.rotation * Math.PI) / 180)
  context.fillStyle = pad.through ? LOOK.throughPad : LOOK.pad
  context.beginPath()
  if (pad.shape === "circle" || pad.shape === "oval") context.ellipse(0, 0, pad.width / 2, pad.height / 2, 0, 0, 2 * Math.PI)
  else context.rect(-pad.width / 2, -pad.height / 2, pad.width, pad.height)
  context.fill()
  if (pad.drill) {
    context.fillStyle = LOOK.drill
    context.beginPath()
    context.arc(0, 0, pad.drill / 2, 0, 2 * Math.PI)
    context.fill()
  }
  context.restore()
  if (Math.min(pad.width, pad.height) < NUMBER_ROOM) return
  context.fillStyle = LOOK.number
  context.font = `${Math.min(11, Math.floor(Math.min(pad.width, pad.height) * 0.7))}px sans-serif`
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(pad.number, pad.x, pad.y)
}

function drawFootprint(canvas: HTMLCanvasElement, preview: FootprintPreview): void {
  const context = sized(canvas)
  if (!context) return
  context.fillStyle = LOOK.board
  context.fillRect(0, 0, VIEW_SIZE.width, VIEW_SIZE.height)
  strokeLines(context, [preview.courtyard], LOOK.outline, true, [3, 3])
  strokeLines(context, preview.body, LOOK.outline, false)
  strokeLines(context, preview.silkscreen, LOOK.silk, false)
  for (const pad of preview.pads) drawPad(context, pad)
}

/** The footprint as the PCB view draws it, pad numbers on the pads that have room for them. */
export function FootprintView({ text }: { text: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const preview = useMemo(() => footprintPreview(text, VIEW_SIZE), [text])
  useEffect(() => {
    if (canvas.current && !("error" in preview)) drawFootprint(canvas.current, preview)
  }, [preview])
  if ("error" in preview) return null
  return <canvas ref={canvas} className="packages-canvas" style={VIEW_SIZE} role="img" aria-label={`Pads of ${text.trim()}: ${preview.summary}`} />
}

/** Pointer moves come faster than frames: the last one in each animation frame turns the view, once. */
function useFrameCoalesced(apply: (orbit: Orbit) => void) {
  const pending = useRef<Orbit | undefined>(undefined)
  const frame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  return (orbit: Orbit) => {
    pending.current = orbit
    if (frame.current !== 0) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      if (pending.current) apply(pending.current)
    })
  }
}

interface ShapeProps {
  text: string
  kind?: string
  orbit: Orbit
  onOrbit(orbit: Orbit): void
  focusRef: React.RefObject<HTMLCanvasElement | null>
  /** The facts list, read as the picture's description. */
  describedBy: string
}

/**
 * The 3D shape: a fixed three-quarter view at first; dragging or the arrows turn it. While it moves it is drawn
 * coarsely; once the view has been still a moment, finely. A turn that has not settled is never drawn finely first.
 */
export function ShapeView({ text, kind, orbit, onOrbit, focusRef, describedBy }: ShapeProps) {
  const scene = useMemo(() => {
    const part = lonePart(text, kind)
    return "error" in part ? undefined : loneScene(part)
  }, [text, kind])
  const drag = useRef<{ x: number; y: number; orbit: Orbit } | undefined>(undefined)
  const [settled, setSettled] = useState(orbit)
  const turn = useFrameCoalesced(onOrbit)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(orbit), REST_MS)
    return () => clearTimeout(timer)
  }, [orbit])
  const fine = settled === orbit
  useEffect(() => {
    const canvas = focusRef.current
    if (!canvas || !scene) return
    const ratio = window.devicePixelRatio || 1
    const [width, height] = [Math.round(VIEW_SIZE.width * ratio), Math.round(VIEW_SIZE.height * ratio)]
    const options = { background: rgb(PALETTE.background), lit: true }
    const frame = fine ? renderSmooth(scene, orbit, width, height, options) : renderScene(scene, orbit, width, height, options)
    canvas.width = width
    canvas.height = height
    canvas.getContext("2d")?.putImageData(new ImageData(frame.color as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0)
  }, [scene, orbit, fine, focusRef])
  if (!scene) return null
  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, orbit }
  }
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (drag.current) turn(dragged(drag.current.orbit, event.clientX - drag.current.x, event.clientY - drag.current.y))
  }
  const stop = () => (drag.current = undefined)
  return (
    <canvas
      ref={focusRef}
      className="packages-canvas packages-shape"
      style={VIEW_SIZE}
      tabIndex={0}
      role="img"
      aria-label={`3D shape of ${text.trim()}; drag or use the arrow keys to turn it, Home to go back`}
      aria-describedby={describedBy}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={() => onOrbit(START)}
    />
  )
}
