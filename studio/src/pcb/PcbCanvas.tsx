import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import type { WorldPad } from "../../../src/engine/pcb.js"
import { keepAutoPlaced } from "./auto-placed"
import { movedTo, moveBlocker, nextRotation, prepareCanvas, toLocal, useElementSize, useWheelZoom } from "./canvas-common"
import type { Layers } from "./ctx"
import { drawLockBadge, drawMark, drawOutline, drawSelectionBox } from "./overlays"
import { drawPcb, padAt, pcbBoxes } from "./pcb-draw"
import { fitCamera, hitTest, pointBounds, screenToWorld, snap, unionBoxes, type Camera, type PartBox, type Point } from "./geometry"

interface Props {
  design: Design
  /** Changes when a build finishes; a pending move is then part of the new build. */
  buildId: string | undefined
  circuit: CircuitData
  actions: Actions
  selected: string | null
  onSelect(name: string | null): void
}

type Gesture =
  | { kind: "pan"; start: Point; camera: Camera }
  | { kind: "drag"; part: PartBox; start: Point; offset: Point; moved: boolean; blocker: string | null }
  | { kind: "box"; start: Point; current: Point }

const SNAP_STEPS = [0.1, 0.5, 1]
const LAYER_BUTTONS = [
  ["topCopper", "Top"],
  ["bottomCopper", "Bottom"],
  ["silkscreen", "Silk"],
  ["courtyard", "Courtyard"],
] as const
const POSITION = ["pcbX", "pcbY"] as const
const DRAG_THRESHOLD_PX = 3
const BOX_MIN_PX = 6
const BACKGROUND = "#121417"
const round = (value: number) => Math.round(value * 1000) / 1000

/** "U1.VIN on GND" for the pad under the pointer: the pin's own name when it has one, and its named net. */
function padLabel(design: Design, pad: WorldPad): string {
  const pin = design.circuit.components.find((c) => c.id === pad.component)?.pins.find((p) => p.id === pad.pin)
  const name = pin?.names.find((n) => !/^pin\d+$/.test(n)) ?? pin?.names[0]
  const net = design.circuit.nets.find((n) => n.id === pad.net)?.names[0]
  return `${name ? `${pad.component}.${name}` : pad.id}${net ? ` on ${net}` : ""}`
}

/** The PCB, drawn by copperflow's own renderer under its camera, grid and tools. */
export function PcbCanvas({ design, buildId, circuit, actions, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(wrapRef)
  const [camera, setCamera] = useState<Camera>()
  const [gesture, setGesture] = useState<Gesture>()
  const [hover, setHover] = useState<string>()
  const [cursor, setCursor] = useState<Point>()
  const [step, setStep] = useState(0.5)
  const [pending, setPending] = useState<{ name: string; offset: Point }>()
  const [layers, setLayers] = useState<Layers>({ topCopper: true, bottomCopper: true, silkscreen: true, courtyard: true, fabrication: false })
  const [hoverPad, setHoverPad] = useState<WorldPad>()

  const layout = design.pcb
  const boxes = useMemo(() => pcbBoxes(layout), [layout])
  const origins = useMemo(() => new Map(layout.parts.map((p) => [p.component, { x: p.x, y: p.y }])), [layout])
  const autoPlaced = useMemo(() => layout.parts.some((p) => p.autoPlaced), [layout])
  const locked = useMemo(() => new Set(circuit.annotations.locks.map((l) => l.part)), [circuit])
  const bounds = useMemo(() => pointBounds(layout.board?.outline ?? []) ?? unionBoxes(boxes.map((b) => b.box)), [layout, boxes])
  const blockerFor = useCallback((name: string) => moveBlocker(circuit, locked, name, POSITION), [circuit, locked])

  useEffect(() => setPending(undefined), [buildId])
  useWheelZoom(wrapRef, size, setCamera)

  const fit = useCallback(() => {
    if (bounds && size.width > 0) setCamera(fitCamera(bounds, size))
  }, [bounds, size])

  useEffect(() => {
    if (!camera) fit()
  }, [camera, fit])

  // Draw everything whenever anything visible changes.
  useEffect(() => {
    if (!camera) return
    const prepared = prepareCanvas(canvasRef.current, size, camera, BACKGROUND)
    if (!prepared) return
    const { ctx, ratio } = prepared
    const moving = gesture?.kind === "drag" && gesture.moved && !gesture.blocker ? { name: gesture.part.name, offset: gesture.offset } : pending
    drawPcb(ctx, layout, { camera, size }, {
      ratio,
      layers,
      ...(hoverPad?.net ? { highlight: { net: hoverPad.net } } : {}),
      ...(moving ? { moving: { component: moving.name, by: moving.offset } } : {}),
    })
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    for (const part of boxes) {
      const offset = moving && part.name === moving.name ? moving.offset : { x: 0, y: 0 }
      if (part.name === hover && part.name !== selected) drawOutline(ctx, camera, size, part.box, offset, "hover")
      if (part.name === selected) drawOutline(ctx, camera, size, part.box, offset, "selected")
      if (locked.has(part.name)) drawLockBadge(ctx, camera, size, part.box)
    }
    for (const mark of circuit.annotations.marks) {
      if (mark.view === "pcb" && mark.x !== undefined && mark.y !== undefined) drawMark(ctx, camera, size, { x: mark.x, y: mark.y }, mark.id, mark.text)
    }
    if (gesture?.kind === "box") drawSelectionBox(ctx, gesture.start, gesture.current)
  }, [layout, camera, size, gesture, pending, boxes, hover, selected, locked, circuit, layers, hoverPad])

  const local = useCallback((event: { clientX: number; clientY: number }): Point => toLocal(canvasRef.current, size, event), [size])

  const commitMove = (part: PartBox, offset: Point) => {
    if (offset.x === 0 && offset.y === 0) return
    const [x, y] = movedTo(circuit, part.name, POSITION, origins.get(part.name) ?? part.center, offset)
    setPending({ name: part.name, offset })
    void actions.edit([{ kind: "setProps", part: part.name, props: { pcbX: x, pcbY: y } }], `move ${part.name} to (${x}, ${y})`).then((ok) => {
      if (!ok) setPending(undefined)
    })
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!camera) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = local(event)
    if (event.button === 1 || event.button === 2) return setGesture({ kind: "pan", start: point, camera })
    if (event.shiftKey) return setGesture({ kind: "box", start: point, current: point })
    const hit = hitTest(boxes, screenToWorld(camera, size, point))
    if (!hit) return setGesture({ kind: "pan", start: point, camera })
    onSelect(hit.name)
    setGesture({ kind: "drag", part: hit, start: point, offset: { x: 0, y: 0 }, moved: false, blocker: blockerFor(hit.name) })
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!camera) return
    const point = local(event)
    const world = screenToWorld(camera, size, point)
    setCursor(world)
    if (!gesture) {
      setHover(hitTest(boxes, world)?.name)
      return setHoverPad(padAt(layout, world))
    }
    if (gesture.kind === "pan") {
      const dx = (point.x - gesture.start.x) / gesture.camera.scale
      const dy = (point.y - gesture.start.y) / gesture.camera.scale
      setCamera({ ...gesture.camera, cx: gesture.camera.cx - dx, cy: gesture.camera.cy + dy })
    } else if (gesture.kind === "drag") {
      if (!gesture.moved && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) <= DRAG_THRESHOLD_PX) return
      // Snap the part's origin, where pcbX and pcbY put it, to the grid, not the distance moved.
      const origin = origins.get(gesture.part.name) ?? gesture.part.center
      const startWorld = screenToWorld(camera, size, gesture.start)
      const raw = { x: origin.x + world.x - startWorld.x, y: origin.y + world.y - startWorld.y }
      setGesture({ ...gesture, moved: true, offset: { x: round(snap(raw.x, step) - origin.x), y: round(snap(raw.y, step) - origin.y) } })
    } else {
      setGesture({ ...gesture, current: point })
    }
  }

  const onPointerUp = () => {
    const done = gesture
    setGesture(undefined)
    if (!done || !camera) return
    if (done.kind === "drag") {
      if (!done.moved) return
      if (done.blocker) actions.notify(done.blocker)
      else commitMove(done.part, done.offset)
    } else if (done.kind === "pan") {
      if (Math.hypot(done.camera.cx - camera.cx, done.camera.cy - camera.cy) * camera.scale < DRAG_THRESHOLD_PX) onSelect(null)
    } else {
      const a = screenToWorld(camera, size, done.start)
      const b = screenToWorld(camera, size, done.current)
      if (Math.abs(a.x - b.x) * camera.scale < BOX_MIN_PX && Math.abs(a.y - b.y) * camera.scale < BOX_MIN_PX) return
      const text = window.prompt("Note for the agent, e.g. route ground here")
      if (text) void actions.mark(text, { view: "pcb", x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) })
    }
  }

  // R rotates and Delete removes the selected part; F fits the board.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === "f" || event.key === "F") return fit()
      if (!selected) return
      const blocker = blockerFor(selected)
      if (event.key === "r" || event.key === "R") {
        if (blocker) return actions.notify(blocker)
        const next = nextRotation(circuit, selected, "pcbRotation")
        if (typeof next === "string") return actions.notify(next)
        void actions.edit([{ kind: "setProps", part: selected, props: { pcbRotation: next } }], `rotate ${selected} to ${next}°`)
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (blocker) return actions.notify(blocker)
        if (window.confirm(`Remove ${selected} and its connections?`)) {
          void actions.edit([{ kind: "removePart", part: selected }], `remove ${selected}`).then((ok) => ok && onSelect(null))
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected, blockerFor, circuit, actions, onSelect, fit])

  const cursorStyle = gesture?.kind === "pan" ? "grabbing" : gesture?.kind === "drag" ? (gesture.blocker ? "not-allowed" : "move") : hover ? "pointer" : "default"

  return (
    <div className="pcb-canvas" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height: size.height, cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setHover(undefined)
          setHoverPad(undefined)
        }}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="PCB layout. Drag parts to move them, drag the background to pan, scroll to zoom."
        role="img"
      />
      <div className="canvas-tools">
        <label>
          Snap
          <select value={step} onChange={(e) => setStep(Number(e.target.value))}>
            {SNAP_STEPS.map((s) => (
              <option key={s} value={s}>
                {s} mm
              </option>
            ))}
          </select>
        </label>
        <button onClick={fit} title="Fit the board (F)">
          Fit
        </button>
        <span className="tool-divider" aria-hidden="true" />
        {LAYER_BUTTONS.map(([key, label]) => (
          <button
            key={key}
            className={layers[key] ? "active" : ""}
            aria-pressed={layers[key]}
            onClick={() => setLayers({ ...layers, [key]: !layers[key] })}
            title={`Show or hide ${label.toLowerCase()}`}
          >
            {label}
          </button>
        ))}
        {autoPlaced && (
          <>
            <span className="tool-divider" aria-hidden="true" />
            <button onClick={() => keepAutoPlaced(design, "pcb", blockerFor, actions)} title="Write the faded parts' positions into the code as pcbX and pcbY">
              Keep these positions
            </button>
          </>
        )}
      </div>
      <div className="canvas-status" aria-live="off">
        {cursor ? `${cursor.x.toFixed(2)}, ${cursor.y.toFixed(2)} mm` : ""}
        {hoverPad && `  ${padLabel(design, hoverPad)}`}
        {gesture?.kind === "drag" && gesture.moved && !gesture.blocker && `  Δ ${gesture.offset.x}, ${gesture.offset.y}`}
      </div>
    </div>
  )
}
