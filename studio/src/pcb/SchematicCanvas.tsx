import { symbols } from "schematic-symbols"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CircuitData, CircuitElement } from "../api"
import type { Actions } from "../App"
import { WireIcon } from "../icons"
import { fitCamera, hitTest, schematicBoxes, screenToWorld, snap, zoomAt, type Camera, type PartBox, type Point, type Size } from "./geometry"
import { drawGrid, drawLockBadge, drawMark, drawOutline, drawSelectionBox, drawWirePreview } from "./overlays"
import { drawSchematic, portAt, type SymbolLibrary } from "./schematic-render"
import { alreadyConnected, drawnWireAt, drawnWires, joinsNets, portEnd, route, wireEndAt, wireHints, type WireEnd } from "./wiring"

interface Props {
  json: CircuitElement[]
  buildId: string | undefined
  building: boolean
  circuit: CircuitData
  actions: Actions
  selected: string | null
  onSelect(name: string | null): void
}

type Gesture =
  | { kind: "pan"; start: Point; camera: Camera }
  | { kind: "drag"; part: PartBox; start: Point; offset: Point; moved: boolean; blocker: string | null }
  | { kind: "box"; start: Point; current: Point }

/** A wire being drawn: where it starts and the corners clicked so far, on the grid. */
interface Drawing {
  start: WireEnd
  corners: Point[]
}

const BACKGROUND = "#1b1e23"
const SYMBOLS = symbols as unknown as SymbolLibrary
const EMPTY_SHEET_CAMERA: Camera = { cx: 0, cy: 0, scale: 60 }
const SNAP_STEPS = [0.1, 0.5, 1]
const DRAG_THRESHOLD_PX = 3
const PORT_HIT_PX = 12
const round = (value: number) => Math.round(value * 1000) / 1000

/**
 * The schematic, drawn by copperflow's own renderer under its camera, grid and tools. Wires are
 * drawn the way KiCad users expect: click a free pin, or press W over any pin, then click a pin,
 * a net label or a wire to connect; Esc or a right click cancels.
 */
export function SchematicCanvas({ json, buildId, building, circuit, actions, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [camera, setCamera] = useState<Camera>()
  const [gesture, setGesture] = useState<Gesture>()
  const [hover, setHover] = useState<string>()
  const [hoverPort, setHoverPort] = useState<string>()
  const [hoverEnd, setHoverEnd] = useState<WireEnd>()
  const [cursor, setCursor] = useState<Point>()
  const [step, setStep] = useState(0.5)
  const [wiring, setWiring] = useState(false)
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const [pendingWires, setPendingWires] = useState<Point[][]>([])
  const [pending, setPending] = useState<{ name: string; offset: Point }>()
  const [unsupported, setUnsupported] = useState<string[]>([])

  const boxes = useMemo(() => schematicBoxes(json), [json])
  const locked = useMemo(() => new Set(circuit.annotations.locks.map((l) => l.part)), [circuit])
  const bounds = useMemo(() => {
    if (boxes.length === 0) return undefined
    return {
      minX: Math.min(...boxes.map((b) => b.box.minX)) - 1,
      minY: Math.min(...boxes.map((b) => b.box.minY)) - 1,
      maxX: Math.max(...boxes.map((b) => b.box.maxX)) + 1,
      maxY: Math.max(...boxes.map((b) => b.box.maxY)) + 1,
    }
  }, [boxes])
  // Pointer lookups only need the schematic, not the much larger PCB part of the circuit JSON.
  const schematic = useMemo(() => json.filter((e) => e.type.startsWith("schematic_") || e.type.startsWith("source_")), [json])
  // Wires drawn by hand: tscircuit ignores their corners, so copperflow draws them.
  const drawn = useMemo(() => drawnWires(schematic, circuit.model.traces), [schematic, circuit])
  const onGrid = useCallback((p: Point): Point => ({ x: round(snap(p.x, step)), y: round(snap(p.y, step)) }), [step])
  // The end of the wire being drawn follows the pointer on the grid, so only then does the cursor cause redraws.
  const drawingTo = useMemo(() => (drawing ? (hoverEnd?.at ?? (cursor && onGrid(cursor))) : undefined), [drawing, hoverEnd, cursor, onGrid])
  // The key handler reads what is under the pointer without being re-attached on every move.
  const under = useRef<WireEnd | undefined>(undefined)

  const setUnder = (end: WireEnd | undefined, port: string | undefined) => {
    under.current = end
    setHoverEnd(end)
    setHoverPort(port)
  }

  // A new build moves pins and draws the new wires, so the old pointer targets and dashed wires go.
  useEffect(() => {
    setPending(undefined)
    setPendingWires([])
    setUnder(undefined, undefined)
  }, [buildId])

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
    if (bounds && size.width > 0) setCamera(fitCamera(bounds, size, 0.06))
  }, [bounds, size])

  useEffect(() => {
    if (!camera) fit()
  }, [camera, fit])

  const blockerFor = useCallback(
    (name: string): string | null => {
      const part = circuit.model.parts.find((p) => p.name === name)
      if (!part) return "This part has no editable source element"
      if (locked.has(name)) return `${name} is locked`
      if (!part.editable) return `${name} is read-only (${part.readonlyReason})`
      const expression = (["schX", "schY"] as const).find((key) => part.props[key] && !part.props[key]?.editable)
      return expression ? `${name}.${expression} is an expression; change it in the code` : null
    },
    [circuit, locked],
  )

  // Draw everything whenever anything visible changes; a sheet without parts gets a default view.
  useEffect(() => {
    const canvas = canvasRef.current
    const view = camera ?? EMPTY_SHEET_CAMERA
    if (!canvas || size.width === 0) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = size.width * ratio
    canvas.height = size.height * ratio
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = BACKGROUND
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawGrid(ctx, view, size)

    const moving = gesture?.kind === "drag" && gesture.moved && !gesture.blocker ? { name: gesture.part.name, offset: gesture.offset } : pending
    const movingId = moving ? boxes.find((b) => b.name === moving.name)?.pcbComponentId : undefined
    const active = [drawing?.start.pinId, hoverPort].filter((id): id is string => id !== undefined)
    const result = drawSchematic(ctx, json, { camera: view, size }, {
      ratio,
      symbols: SYMBOLS,
      showPorts: wiring || drawing !== null,
      activePorts: active,
      wires: drawn.wires,
      junctions: drawn.junctions,
      hidden: drawn.hidden,
      ...(moving && movingId ? { moving: { componentId: movingId, by: moving.offset } } : {}),
    })
    setUnsupported((current) => (current.join() === result.unsupported.join() ? current : result.unsupported))

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    for (const wire of pendingWires) drawWirePreview(ctx, view, size, wire, "pending")
    if (drawing && drawingTo) drawWirePreview(ctx, view, size, route([drawing.start.at, ...drawing.corners, drawingTo]), "drawing")
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
  }, [json, camera, size, gesture, pending, boxes, hover, selected, locked, circuit, wiring, drawing, drawingTo, hoverPort, pendingWires, drawn])

  const local = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return { x: 0, y: 0 }
      return { x: ((event.clientX - rect.left) * size.width) / rect.width, y: ((event.clientY - rect.top) * size.height) / rect.height }
    },
    [size],
  )

  /** A pin, a net label, a tscircuit wire or a hand-drawn wire under the pointer, nearest first. */
  const targetAt = (world: Point, reach: number): WireEnd | undefined => {
    const found = wireEndAt(schematic, world, reach, drawn.hidden)
    const onDrawn = drawnWireAt(drawn, world, reach)
    if (!found || !onDrawn) return found ?? onDrawn
    const away = (end: WireEnd) => Math.hypot(end.at.x - world.x, end.at.y - world.y)
    return found.pinId || away(found) <= away(onDrawn) ? found : onDrawn
  }

  const finishWire = (target: WireEnd) => {
    if (!drawing) return
    const { start: from, corners } = drawing
    setDrawing(null)
    if (target.selector === from.selector) return
    if (alreadyConnected(from, target)) return actions.notify(`${from.label} and ${target.label} are already connected`)
    const nets = joinsNets(from, target)
    if (nets && !window.confirm(`This wire joins ${nets[0]} and ${nets[1]} into one net, a short circuit if they carry different voltages. Connect them anyway?`)) return
    const hints = wireHints(from, corners, target)
    const wire = route([from.at, ...corners, target.at])
    setPendingWires((wires) => [...wires, wire])
    void actions
      .edit(
        [{ kind: "addTrace", from: from.selector, to: target.selector, ...(hints.length > 0 ? { schematicRouteHints: hints } : {}) }],
        `connect ${from.label} to ${target.label}`,
      )
      .then((ok) => ok || setPendingWires((wires) => wires.filter((w) => w !== wire)))
  }

  /** Where a wire would start under the pointer: any pin, label or wire while wiring, else only a free pin. */
  const startAt = (world: Point, scale: number): Drawing | undefined => {
    const reach = PORT_HIT_PX / scale
    const portId = portAt(schematic, world, reach)
    const pin = portId ? portEnd(schematic, portId) : undefined
    if (pin && (wiring || pin.key === undefined)) return { start: pin, corners: [] }
    const end = wiring ? targetAt(world, reach) : undefined
    return end ? { start: end, corners: [] } : undefined
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
      const target = targetAt(world, PORT_HIT_PX / camera.scale)
      if (target) return finishWire(target)
      // A click on empty sheet places a corner on the grid.
      const corner = onGrid(world)
      const last = drawing.corners[drawing.corners.length - 1] ?? drawing.start.at
      if (corner.x !== last.x || corner.y !== last.y) setDrawing({ ...drawing, corners: [...drawing.corners, corner] })
      return
    }
    const start = startAt(world, camera.scale)
    if (start) return setDrawing(start)
    const hit = hitTest(boxes, world)
    if (hit) {
      onSelect(hit.name)
      setGesture({ kind: "drag", part: hit, start: point, offset: { x: 0, y: 0 }, moved: false, blocker: blockerFor(hit.name) })
    } else {
      setGesture({ kind: "pan", start: point, camera })
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!camera) return
    const point = local(event)
    const world = screenToWorld(camera, size, point)
    setCursor(world)
    if (!gesture) {
      const reach = PORT_HIT_PX / camera.scale
      const portId = portAt(schematic, world, reach)
      setUnder(wiring || drawing ? targetAt(world, reach) : portId ? portEnd(schematic, portId) : undefined, portId)
      return setHover(hitTest(boxes, world)?.name)
    }
    if (gesture.kind === "pan") {
      const dx = (point.x - gesture.start.x) / gesture.camera.scale
      const dy = (point.y - gesture.start.y) / gesture.camera.scale
      setCamera({ ...gesture.camera, cx: gesture.camera.cx - dx, cy: gesture.camera.cy + dy })
    } else if (gesture.kind === "drag") {
      if (!gesture.moved && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) <= DRAG_THRESHOLD_PX) return
      const startWorld = screenToWorld(camera, size, gesture.start)
      const raw = { x: gesture.part.center.x + world.x - startWorld.x, y: gesture.part.center.y + world.y - startWorld.y }
      setGesture({ ...gesture, moved: true, offset: { x: round(snap(raw.x, step) - gesture.part.center.x), y: round(snap(raw.y, step) - gesture.part.center.y) } })
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
      if (Math.abs(a.x - b.x) * camera.scale < 6 && Math.abs(a.y - b.y) * camera.scale < 6) return
      const text = window.prompt("Note for the agent, e.g. add a pull-up here")
      if (text) void actions.mark(text, { view: "schematic", x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) })
    }
  }

  const commitMove = (part: PartBox, offset: Point) => {
    const info = circuit.model.parts.find((p) => p.name === part.name)
    if (!info || (offset.x === 0 && offset.y === 0)) return
    const target = (key: "schX" | "schY", delta: number, absolute: number) => {
      const current = info.props[key]?.literal
      return round(typeof current === "number" ? current + delta : absolute)
    }
    const x = target("schX", offset.x, part.center.x + offset.x)
    const y = target("schY", offset.y, part.center.y + offset.y)
    setPending({ name: part.name, offset })
    void actions
      .edit([{ kind: "setProps", part: part.name, props: { schX: x, schY: y } }], `move ${part.name} in the schematic to (${x}, ${y})`)
      .then((ok) => ok || setPending(undefined))
  }

  const onWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault()
      const point = local(event)
      setCamera((current) => (current ? zoomAt(current, size, point, Math.exp(-event.deltaY * 0.0015)) : current))
    },
    [size, local],
  )

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    wrap.addEventListener("wheel", onWheel, { passive: false })
    return () => wrap.removeEventListener("wheel", onWheel)
  }, [onWheel])

  // W starts a wire at the pin under the pointer, or turns wiring on and off; Esc cancels.
  // R rotates the symbol, Delete removes the part, F fits.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return
      // Ctrl+R, Ctrl+W and the like belong to the browser.
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === "Escape") {
        if (drawing) return setDrawing(null)
        return setWiring(false)
      }
      if (event.key === "Backspace" && drawing) {
        event.preventDefault()
        return setDrawing({ ...drawing, corners: drawing.corners.slice(0, -1) })
      }
      if (event.key === "f" || event.key === "F") return fit()
      if (event.key === "w" || event.key === "W") {
        if (drawing) return
        const end = under.current
        if (end) return setDrawing({ start: end, corners: [] })
        return setWiring((on) => !on)
      }
      if (!selected || drawing) return
      const blocker = blockerFor(selected)
      if (event.key === "r" || event.key === "R") {
        if (blocker) return actions.notify(blocker)
        const rotation = circuit.model.parts.find((p) => p.name === selected)?.props.schRotation?.literal
        if (rotation !== undefined && typeof rotation !== "number") return actions.notify(`${selected}.schRotation is not a number`)
        const next = ((((rotation ?? 0) as number) + 90) % 360 + 360) % 360
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

  const overPin = hoverEnd !== undefined && (wiring || drawing !== null || hoverEnd.key === undefined)
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
        setUnder(undefined, undefined)
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
      </div>
      {hint && <div className="canvas-hint">{hint}</div>}
      {building && (
        <div className="canvas-busy" role="status">
          Updating…
        </div>
      )}
      <div className="canvas-status" aria-live="off">
        {cursor ? `${cursor.x.toFixed(2)}, ${cursor.y.toFixed(2)}` : ""}
        {hoverEnd && `  ${hoverEnd.label}`}
        {gesture?.kind === "drag" && gesture.moved && !gesture.blocker && `  Δ ${gesture.offset.x}, ${gesture.offset.y}`}
        {unsupported.length > 0 && `\nNot drawn yet: ${unsupported.join(", ")}`}
      </div>
      {!bounds && <p className="empty">This schematic has no parts yet.</p>}
    </div>
  )
}
