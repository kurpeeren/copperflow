import { CircuitToCanvasDrawer } from "circuit-to-canvas"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CircuitData, CircuitElement, Edit } from "../api"
import type { Actions } from "../App"
import { buildNets, padAt } from "./nets"
import { drawGrid, drawLockBadge, drawMark, drawOutline, drawSelectionBox } from "./overlays"
import { drawPcb, isSupported, type Layers } from "./render"
import {
  boardBounds,
  componentBoxes,
  fitCamera,
  hitTest,
  screenToWorld,
  snap,
  toMatrix,
  zoomAt,
  type Camera,
  type PartBox,
  type Point,
  type Size,
} from "./geometry"

interface Props {
  json: CircuitElement[]
  /** Changes when a build finishes; a pending move is then part of the new build. */
  buildId: string | undefined
  /** A build is running; the canvas shows that the drawing is about to change. */
  building: boolean
  circuit: CircuitData
  actions: Actions
  selected: string | null
  onSelect(name: string | null): void
}

type Gesture =
  | { kind: "pan"; start: Point; camera: Camera }
  | { kind: "drag"; part: PartBox; start: Point; offset: Point; moved: boolean; allowed: string | null }
  | { kind: "box"; start: Point; current: Point }

const SNAP_STEPS = [0.1, 0.5, 1]
const LAYER_BUTTONS = [
  ["topCopper", "Top"],
  ["bottomCopper", "Bottom"],
  ["silkscreen", "Silk"],
  ["courtyard", "Courtyard"],
] as const

/** "U1.VIN" for a pcb_port id. */
function pinLabel(json: CircuitElement[], pcbPortId: string): string | undefined {
  const port = json.find((e) => e.type === "pcb_port" && e.pcb_port_id === pcbPortId)
  const source = json.find((e) => e.type === "source_port" && e.source_port_id === port?.source_port_id)
  const part = json.find((e) => e.type === "source_component" && e.source_component_id === source?.source_component_id)
  return part && source ? `${String(part.name)}.${String(source.name)}` : undefined
}
const DRAG_THRESHOLD_PX = 3
const BACKGROUND = "#121417"
const round = (value: number) => Math.round(value * 1000) / 1000

/**
 * A pointer position in the canvas's own CSS pixels. Browser zoom or a scaled page can make the
 * on-screen rectangle differ from the layout size, so the offset is divided by that ratio.
 */
function toCanvasPoint(canvas: HTMLCanvasElement | null, size: Size, event: { clientX: number; clientY: number }): Point {
  const rect = canvas?.getBoundingClientRect()
  if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 }
  return {
    x: ((event.clientX - rect.left) * size.width) / rect.width,
    y: ((event.clientY - rect.top) * size.height) / rect.height,
  }
}

/** The PCB, drawn by copperflow's own renderer under its camera, grid and tools. */
export function PcbCanvas({ json, buildId, building, circuit, actions, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawerRef = useRef<CircuitToCanvasDrawer | null>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [camera, setCamera] = useState<Camera>()
  const [gesture, setGesture] = useState<Gesture>()
  const [hover, setHover] = useState<string>()
  const [cursor, setCursor] = useState<Point>()
  const [step, setStep] = useState(0.5)
  const [pending, setPending] = useState<{ name: string; offset: Point }>()
  const [layers, setLayers] = useState<Layers>({ topCopper: true, bottomCopper: true, silkscreen: true, courtyard: true, fabrication: false })
  const [hoverNet, setHoverNet] = useState<string>()
  const [hoverPin, setHoverPin] = useState<string>()
  const [unsupported, setUnsupported] = useState<string[]>([])

  const boxes = useMemo(() => componentBoxes(json), [json])
  const nets = useMemo(() => buildNets(json), [json])
  const locked = useMemo(() => new Set(circuit.annotations.locks.map((l) => l.part)), [circuit])
  const bounds = useMemo(() => boardBounds(json), [json])

  useEffect(() => setPending(undefined), [buildId])

  // Follow the element's size; the canvas is drawn at device resolution.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  const fit = useCallback(() => {
    if (bounds && size.width > 0) setCamera(fitCamera(bounds, size))
  }, [bounds, size])

  useEffect(() => {
    if (!camera) fit()
  }, [camera, fit])

  /** Why a part cannot be dragged, or null when it can. */
  const dragBlocker = useCallback(
    (name: string): string | null => {
      const part = circuit.model.parts.find((p) => p.name === name)
      if (!part) return "This part has no editable source element"
      if (locked.has(name)) return `${name} is locked`
      if (!part.editable) return `${name} is read-only (${part.readonlyReason})`
      const expression = (["pcbX", "pcbY"] as const).find((key) => part.props[key] && !part.props[key]?.editable)
      return expression ? `${name}.${expression} is an expression; change it in the code` : null
    },
    [circuit, locked],
  )

  // Draw everything whenever anything visible changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !camera || size.width === 0) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = size.width * ratio
    canvas.height = size.height * ratio
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    drawerRef.current ??= new CircuitToCanvasDrawer(canvas)
    const drawer = drawerRef.current

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = BACKGROUND
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawGrid(ctx, camera, size)

    const moving = gesture?.kind === "drag" && gesture.moved && !gesture.allowed ? { name: gesture.part.name, offset: gesture.offset } : pending
    const movingId = moving ? boxes.find((b) => b.name === moving.name)?.pcbComponentId : undefined
    const isMoving = (e: CircuitElement) => movingId !== undefined && e.pcb_component_id === movingId
    const highlight = hoverNet ? { net: hoverNet, nets } : undefined
    // Element types our renderer does not draw yet go to tscircuit's drawer, under the copper.
    const fallback = json.filter((e) => !isSupported(e) && !isMoving(e))
    const result = drawPcb(ctx, json.filter((e) => !isMoving(e)), { camera, size }, {
      ratio,
      layers,
      ...(highlight ? { highlight } : {}),
      underCopper: () => {
        if (fallback.length === 0) return
        drawer.realToCanvasMat = toMatrix(camera, size, ratio)
        drawer.drawElements(fallback as Parameters<CircuitToCanvasDrawer["drawElements"]>[0], {
          clipContextElements: json as Parameters<CircuitToCanvasDrawer["drawElements"]>[0],
        })
      },
    })
    if (moving && movingId) {
      drawPcb(ctx, json.filter(isMoving), { camera, size }, { ratio, layers, offset: moving.offset })
    }
    setUnsupported((current) => (current.join() === result.unsupported.join() ? current : result.unsupported))

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
  }, [json, camera, size, gesture, pending, boxes, hover, selected, locked, circuit, layers, hoverNet, nets])

  const local = useCallback(
    (event: { clientX: number; clientY: number }): Point => toCanvasPoint(canvasRef.current, size, event),
    [size],
  )

  const commitMove = (part: PartBox, offset: Point) => {
    const info = circuit.model.parts.find((p) => p.name === part.name)
    if (!info || (offset.x === 0 && offset.y === 0)) return
    const target = (key: "pcbX" | "pcbY", delta: number, absolute: number) => {
      const current = info.props[key]?.literal
      return round(typeof current === "number" ? current + delta : absolute)
    }
    const x = target("pcbX", offset.x, part.center.x + offset.x)
    const y = target("pcbY", offset.y, part.center.y + offset.y)
    setPending({ name: part.name, offset })
    const edit: Edit = { kind: "setProps", part: part.name, props: { pcbX: x, pcbY: y } }
    void actions.edit([edit], `move ${part.name} to (${x}, ${y})`).then((ok) => {
      if (!ok) setPending(undefined)
    })
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!camera) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = local(event)
    if (event.button === 1 || event.button === 2) {
      setGesture({ kind: "pan", start: point, camera })
      return
    }
    if (event.shiftKey) {
      setGesture({ kind: "box", start: point, current: point })
      return
    }
    const hit = hitTest(boxes, screenToWorld(camera, size, point))
    if (hit) {
      onSelect(hit.name)
      setGesture({ kind: "drag", part: hit, start: point, offset: { x: 0, y: 0 }, moved: false, allowed: dragBlocker(hit.name) })
    } else {
      setGesture({ kind: "pan", start: point, camera })
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!camera) return
    const point = local(event)
    const world = screenToWorld(camera, size, point)
    setCursor(world)
    if (!gesture) {
      setHover(hitTest(boxes, world)?.name)
      const pad = padAt(json, world)
      setHoverNet(pad ? nets.ofPort(pad) : undefined)
      setHoverPin(pad ? pinLabel(json, pad) : undefined)
      return
    }
    if (gesture.kind === "pan") {
      const dx = (point.x - gesture.start.x) / gesture.camera.scale
      const dy = (point.y - gesture.start.y) / gesture.camera.scale
      setCamera({ ...gesture.camera, cx: gesture.camera.cx - dx, cy: gesture.camera.cy + dy })
    } else if (gesture.kind === "drag") {
      const far = Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > DRAG_THRESHOLD_PX
      if (!far && !gesture.moved) return
      // Snap the part's centre to the grid, not the distance moved.
      const startWorld = screenToWorld(camera, size, gesture.start)
      const raw = { x: gesture.part.center.x + world.x - startWorld.x, y: gesture.part.center.y + world.y - startWorld.y }
      const offset = { x: round(snap(raw.x, step) - gesture.part.center.x), y: round(snap(raw.y, step) - gesture.part.center.y) }
      setGesture({ ...gesture, offset, moved: true })
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
      if (done.allowed) actions.notify(done.allowed)
      else commitMove(done.part, done.offset)
    } else if (done.kind === "pan") {
      const still = Math.hypot(done.camera.cx - camera.cx, done.camera.cy - camera.cy) * camera.scale < DRAG_THRESHOLD_PX
      if (still) onSelect(null)
    } else if (done.kind === "box") {
      const a = screenToWorld(camera, size, done.start)
      const b = screenToWorld(camera, size, done.current)
      if (Math.abs(a.x - b.x) * camera.scale < 6 && Math.abs(a.y - b.y) * camera.scale < 6) return
      const text = window.prompt("Note for the agent, e.g. route ground here")
      if (text) void actions.mark(text, { view: "pcb", x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) })
    }
  }

  const onWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault()
      const point = local(event)
      setCamera((current) => (current ? zoomAt(current, size, point, Math.exp(-event.deltaY * 0.0015)) : current))
    },
    [size, local],
  )

  // React's onWheel is passive, so preventDefault needs a native listener.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener("wheel", onWheel, { passive: false })
    return () => canvas.removeEventListener("wheel", onWheel)
  }, [onWheel])

  // R rotates and Delete removes the selected part; F fits the board.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return
      if (event.key === "f" || event.key === "F") return fit()
      if (!selected) return
      const blocker = dragBlocker(selected)
      if (event.key === "r" || event.key === "R") {
        if (blocker) return actions.notify(blocker)
        const rotation = circuit.model.parts.find((p) => p.name === selected)?.props.pcbRotation?.literal
        if (rotation !== undefined && typeof rotation !== "number") return actions.notify(`${selected}.pcbRotation is not a number`)
        const next = ((((rotation ?? 0) as number) + 90) % 360 + 360) % 360
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
  }, [selected, dragBlocker, circuit, actions, onSelect, fit])

  const cursorStyle = gesture?.kind === "pan" ? "grabbing" : gesture?.kind === "drag" ? (gesture.allowed ? "not-allowed" : "move") : hover ? "pointer" : "default"

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
          setHoverNet(undefined)
          setHoverPin(undefined)
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
      </div>
      {building && (
        <div className="canvas-busy" role="status">
          Updating…
        </div>
      )}
      <div className="canvas-status" aria-live="off">
        {cursor ? `${cursor.x.toFixed(2)}, ${cursor.y.toFixed(2)} mm` : ""}
        {hoverPin && `  ${hoverPin}`}
        {gesture?.kind === "drag" && gesture.moved && !gesture.allowed && `  Δ ${gesture.offset.x}, ${gesture.offset.y}`}
        {unsupported.length > 0 && `\nDrawn by the fallback renderer: ${unsupported.join(", ")}`}
      </div>
    </div>
  )
}
