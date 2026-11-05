import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import { WireIcon } from "../icons"
import { keepAutoPlaced } from "./auto-placed"
import { movedTo, moveBlocker, nextRotation, prepareCanvas, toLocal, useElementSize, useWheelZoom } from "./canvas-common"
import { fitCamera, hitTest, rightAngles, screenToWorld, snap, unionBoxes, type Camera, type PartBox, type Point } from "./geometry"
import { drawLockBadge, drawMark, drawOutline, drawSelectionBox, drawWirePreview } from "./overlays"
import { drawSchematic, sheetBoxes } from "./schematic-draw"
import { endAt, freePin, namedNetsJoined, pinAt, wireEdits, type WireEnd } from "./wire-tool"

interface Props {
  design: Design
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

/** A wire being drawn: where it starts, the pin it starts on if any, and the corners clicked so far, on the grid. */
interface Drawing {
  start: WireEnd
  pin?: string
  corners: Point[]
}

/** What is under the pointer: the end a wire would use there, and the pin, if it is a pin. */
interface Under {
  end?: WireEnd
  pin?: string
}

const BACKGROUND = "#1b1e23"
const EMPTY_SHEET_CAMERA: Camera = { cx: 0, cy: 0, scale: 60 }
const SNAP_STEPS = [0.1, 0.5, 1]
const POSITION = ["schX", "schY"] as const
const DRAG_THRESHOLD_PX = 3
const BOX_MIN_PX = 6
const PORT_HIT_PX = 12
const FIT_MARGIN = 0.06
const round = (value: number) => Math.round(value * 1000) / 1000
const sameUnder = (a: Under, b: Under) =>
  a.pin === b.pin && a.end?.selector === b.end?.selector && a.end?.at.x === b.end?.at.x && a.end?.at.y === b.end?.at.y

/**
 * The schematic, drawn by copperflow's own renderer under its camera, grid and tools. Wires are
 * drawn the way KiCad users expect: click a free pin, or press W over any pin, then click a pin,
 * a net label or a wire to connect; Esc or a right click cancels.
 */
export function SchematicCanvas({ design, buildId, circuit, actions, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(wrapRef)
  const [camera, setCamera] = useState<Camera>()
  const [gesture, setGesture] = useState<Gesture>()
  const [hover, setHover] = useState<string>()
  const [under, setUnderState] = useState<Under>({})
  const [cursor, setCursor] = useState<Point>()
  const [step, setStep] = useState(0.5)
  const [wiring, setWiring] = useState(false)
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const [pendingWire, setPendingWire] = useState<Point[]>()
  const [pending, setPending] = useState<{ name: string; offset: Point }>()

  const layout = design.schematic
  const boxes = useMemo(() => sheetBoxes(layout), [layout])
  const origins = useMemo(() => new Map(layout.symbols.map((s) => [s.component, { x: s.x, y: s.y }])), [layout])
  const autoPlaced = useMemo(() => layout.symbols.some((s) => s.autoPlaced), [layout])
  const locked = useMemo(() => new Set(circuit.annotations.locks.map((l) => l.part)), [circuit])
  const bounds = useMemo(() => {
    const all = unionBoxes(boxes.map((b) => b.box))
    return all && { minX: all.minX - 1, minY: all.minY - 1, maxX: all.maxX + 1, maxY: all.maxY + 1 }
  }, [boxes])
  const blockerFor = useCallback((name: string) => moveBlocker(circuit, locked, name, POSITION), [circuit, locked])
  const onGrid = useCallback((p: Point): Point => ({ x: round(snap(p.x, step)), y: round(snap(p.y, step)) }), [step])
  // The end of the wire being drawn follows the pointer on the grid, so only then does the cursor cause redraws.
  const drawingTo = useMemo(() => (drawing ? (under.end?.at ?? (cursor && onGrid(cursor))) : undefined), [drawing, under, cursor, onGrid])
  // The key handler reads what is under the pointer without being re-attached on every move.
  const underRef = useRef<Under>({})

  // Kept as the same object while nothing under the pointer changes, so moving over empty sheet does not redraw.
  const setUnder = (next: Under) => {
    underRef.current = next
    setUnderState((current) => (sameUnder(current, next) ? current : next))
  }

  // A new build moves pins and draws the new wires, so the old pointer targets and the dashed wire go.
  useEffect(() => {
    setPending(undefined)
    setPendingWire(undefined)
    setUnder({})
  }, [buildId])
  useWheelZoom(wrapRef, size, setCamera)

  const fit = useCallback(() => {
    if (bounds && size.width > 0) setCamera(fitCamera(bounds, size, FIT_MARGIN))
  }, [bounds, size])

  useEffect(() => {
    if (!camera) fit()
  }, [camera, fit])

  // Draw everything whenever anything visible changes; a sheet without parts gets a default view.
  useEffect(() => {
    const view = camera ?? EMPTY_SHEET_CAMERA
    const prepared = prepareCanvas(canvasRef.current, size, view, BACKGROUND)
    if (!prepared) return
    const { ctx, ratio } = prepared
    const moving = gesture?.kind === "drag" && gesture.moved && !gesture.blocker ? { name: gesture.part.name, offset: gesture.offset } : pending
    const active = [drawing?.pin, under.pin].filter((id): id is string => id !== undefined)
    drawSchematic(ctx, layout, { camera: view, size }, {
      ratio,
      showPins: wiring || drawing !== null,
      activePins: active,
      ...(pendingWire ? { pending: pendingWire } : {}),
      ...(moving ? { moving: { component: moving.name, by: moving.offset } } : {}),
    })
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    if (drawing && drawingTo) drawWirePreview(ctx, view, size, rightAngles([drawing.start.at, ...drawing.corners, drawingTo]), "drawing")
    for (const part of boxes) {
      const offset = moving && part.name === moving.name ? moving.offset : { x: 0, y: 0 }
      if (part.name === hover && part.name !== selected && !drawing) drawOutline(ctx, view, size, part.box, offset, "hover")
      if (part.name === selected) drawOutline(ctx, view, size, part.box, offset, "selected")
      if (locked.has(part.name)) drawLockBadge(ctx, view, size, part.box)
    }
    for (const mark of circuit.annotations.marks) {
      if (mark.view === "schematic" && mark.x !== undefined && mark.y !== undefined) drawMark(ctx, view, size, { x: mark.x, y: mark.y }, mark.id, mark.text)
    }
    if (gesture?.kind === "box") drawSelectionBox(ctx, gesture.start, gesture.current)
  }, [layout, camera, size, gesture, pending, boxes, hover, selected, locked, circuit, wiring, drawing, drawingTo, under, pendingWire])

  const local = useCallback((event: { clientX: number; clientY: number }): Point => toLocal(wrapRef.current, size, event), [size])

  /** What is under the pointer: any pin, label or wire while wiring or drawing, else only a pin. */
  const underAt = (world: Point, scale: number): Under => {
    const reach = PORT_HIT_PX / scale
    const pin = pinAt(design, world, reach)?.pin
    if (!wiring && !drawing && !pin) return {}
    const end = endAt(design, world, reach)
    return { ...(end ? { end } : {}), ...(pin ? { pin } : {}) }
  }

  const finishWire = (target: WireEnd) => {
    if (!drawing) return
    const { start, corners } = drawing
    setDrawing(null)
    if (target.selector === start.selector) return
    const repeated = [start, target].find((end) => end.selector.split(".")[0]?.includes("~"))
    if (repeated) return actions.notify(`${repeated.label} has a repeated name and cannot be wired from the Studio`)
    const edits = wireEdits(design, start, target, corners)
    if (edits.length === 0) return actions.notify(`${start.label} and ${target.label} are already connected`)
    const nets = namedNetsJoined(design, start, target)
    if (nets && !window.confirm(`This wire joins ${nets[0]} and ${nets[1]} into one net, a short circuit if they carry different voltages. Connect them anyway?`)) return
    const wire = rightAngles([start.at, ...corners, target.at])
    setPendingWire(wire)
    void actions.edit(edits, `connect ${start.label} to ${target.label}`).then((ok) => ok || setPendingWire(undefined))
  }

  /** Where a wire would start: any pin, label or wire while wiring, else only a free pin. */
  const startAt = (world: Point, scale: number): Drawing | undefined => {
    const { end, pin } = underAt(world, scale)
    if (!end || (!wiring && !(pin && freePin(design, pin)))) return undefined
    return { start: end, ...(pin ? { pin } : {}), corners: [] }
  }

  const addCorner = (world: Point) => {
    if (!drawing) return
    const corner = onGrid(world)
    const last = drawing.corners[drawing.corners.length - 1] ?? drawing.start.at
    if (corner.x !== last.x || corner.y !== last.y) setDrawing({ ...drawing, corners: [...drawing.corners, corner] })
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!camera) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = local(event)
    const world = screenToWorld(camera, size, point)
    if (event.button === 2 && drawing) return setDrawing(null)
    if (event.button === 1 || event.button === 2) return setGesture({ kind: "pan", start: point, camera })
    if (event.shiftKey) return setGesture({ kind: "box", start: point, current: point })
    if (drawing) {
      const target = endAt(design, world, PORT_HIT_PX / camera.scale)
      // A click on empty sheet places a corner on the grid.
      return target ? finishWire(target) : addCorner(world)
    }
    const start = startAt(world, camera.scale)
    if (start) return setDrawing(start)
    const hit = hitTest(boxes, world)
    if (!hit) return setGesture({ kind: "pan", start: point, camera })
    onSelect(hit.name)
    setGesture({ kind: "drag", part: hit, start: point, offset: { x: 0, y: 0 }, moved: false, blocker: blockerFor(hit.name) })
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!camera) return
    const point = local(event)
    const world = screenToWorld(camera, size, point)
    setCursor(world)
    if (!gesture) {
      setUnder(underAt(world, camera.scale))
      return setHover(hitTest(boxes, world)?.name)
    }
    if (gesture.kind === "pan") {
      const dx = (point.x - gesture.start.x) / gesture.camera.scale
      const dy = (point.y - gesture.start.y) / gesture.camera.scale
      setCamera({ ...gesture.camera, cx: gesture.camera.cx - dx, cy: gesture.camera.cy + dy })
    } else if (gesture.kind === "drag") {
      if (!gesture.moved && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) <= DRAG_THRESHOLD_PX) return
      // Snap the symbol's origin, where schX and schY put it, to the grid.
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
    if (done.kind === "drag" && done.moved) {
      if (done.blocker) return actions.notify(done.blocker)
      commitMove(done.part, done.offset)
    } else if (done.kind === "pan") {
      if (Math.hypot(done.camera.cx - camera.cx, done.camera.cy - camera.cy) * camera.scale < DRAG_THRESHOLD_PX) onSelect(null)
    } else if (done.kind === "box") {
      const a = screenToWorld(camera, size, done.start)
      const b = screenToWorld(camera, size, done.current)
      if (Math.abs(a.x - b.x) * camera.scale < BOX_MIN_PX && Math.abs(a.y - b.y) * camera.scale < BOX_MIN_PX) return
      const text = window.prompt("Note for the agent, e.g. add a pull-up here")
      if (text) void actions.mark(text, { view: "schematic", x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) })
    }
  }

  const commitMove = (part: PartBox, offset: Point) => {
    if (offset.x === 0 && offset.y === 0) return
    const [x, y] = movedTo(circuit, part.name, POSITION, origins.get(part.name) ?? part.center, offset)
    setPending({ name: part.name, offset })
    void actions
      .edit([{ kind: "setProps", part: part.name, props: { schX: x, schY: y } }], `move ${part.name} in the schematic to (${x}, ${y})`)
      .then((ok) => ok || setPending(undefined))
  }

  // W starts a wire at the pin under the pointer, or turns wiring on and off; Esc cancels.
  // R rotates the symbol, Delete removes the part, F fits.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return
      // Ctrl+R, Ctrl+W and the like belong to the browser.
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === "Escape") return drawing ? setDrawing(null) : setWiring(false)
      if (event.key === "Backspace" && drawing) {
        event.preventDefault()
        return setDrawing({ ...drawing, corners: drawing.corners.slice(0, -1) })
      }
      if (event.key === "f" || event.key === "F") return fit()
      if (event.key === "w" || event.key === "W") {
        if (drawing) return
        const { end, pin } = underRef.current
        if (end) return setDrawing({ start: end, ...(pin ? { pin } : {}), corners: [] })
        return setWiring((on) => !on)
      }
      if (!selected || drawing) return
      const blocker = blockerFor(selected)
      if (event.key === "r" || event.key === "R") {
        if (blocker) return actions.notify(blocker)
        const next = nextRotation(circuit, selected, "schRotation")
        if (typeof next === "string") return actions.notify(next)
        void actions.edit([{ kind: "setProps", part: selected, props: { schRotation: next } }], `rotate ${selected} in the schematic to ${next}°`)
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
  }, [selected, blockerFor, circuit, actions, onSelect, fit, drawing])

  const overPin = under.end !== undefined && (wiring || drawing !== null || (under.pin !== undefined && freePin(design, under.pin)))
  const cursorStyle =
    gesture?.kind === "pan"
      ? "grabbing"
      : gesture?.kind === "drag"
        ? gesture.blocker
          ? "not-allowed"
          : "move"
        : drawing || overPin
          ? "crosshair"
          : hover
            ? "pointer"
            : "default"
  const hint = drawing
    ? `From ${drawing.start.label}: click the sheet for a corner, then a pin, a wire or a net label to finish. Backspace removes a corner, Esc cancels.`
    : wiring
      ? "Click a pin to start a wire. Esc stops wiring."
      : undefined

  return (
    <div
      className="schematic-canvas"
      ref={wrapRef}
      style={{ cursor: cursorStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        setHover(undefined)
        setUnder({})
        setCursor(undefined)
      }}
      onContextMenu={(e) => e.preventDefault()}
      role="img"
      aria-label="Schematic. Drag symbols to move them, drag the background to pan, scroll to zoom. Click a free pin or press W over a pin to draw a wire."
    >
      <canvas ref={canvasRef} style={{ width: size.width, height: size.height }} />
      <div className="canvas-tools" onPointerDown={(e) => e.stopPropagation()}>
        <button
          className={wiring ? "active" : ""}
          aria-pressed={wiring}
          onClick={() => {
            setWiring(!wiring)
            setDrawing(null)
          }}
          title="Wire pins (W)"
        >
          <WireIcon /> {wiring ? "Stop wiring" : "Wire pins"}
        </button>
        <label>
          Snap
          <select value={step} onChange={(e) => setStep(Number(e.target.value))}>
            {SNAP_STEPS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button onClick={fit} title="Fit the schematic (F)">
          Fit
        </button>
        {autoPlaced && (
          <>
            <span className="tool-divider" aria-hidden="true" />
            <button onClick={() => keepAutoPlaced(design, "schematic", blockerFor, actions)} title="Write the faded symbols' positions into the code as schX and schY">
              Keep these positions
            </button>
          </>
        )}
      </div>
      {hint && <div className="canvas-hint">{hint}</div>}
      <div className="canvas-status" aria-live="off">
        {cursor ? `${cursor.x.toFixed(2)}, ${cursor.y.toFixed(2)}` : ""}
        {under.end && `  ${under.end.label}`}
        {gesture?.kind === "drag" && gesture.moved && !gesture.blocker && `  Δ ${gesture.offset.x}, ${gesture.offset.y}`}
      </div>
      {!bounds && <p className="empty">This schematic has no parts yet.</p>}
    </div>
  )
}
