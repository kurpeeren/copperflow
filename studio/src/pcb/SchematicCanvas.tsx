import { convertCircuitJsonToSchematicSvg } from "circuit-to-svg"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CircuitData, CircuitElement } from "../api"
import type { Actions } from "../App"
import { selectorOfSchematicPort } from "../circuit-json"
import { WireIcon } from "../icons"
import {
  fitCamera,
  hitTest,
  parseMatrix,
  schematicBoxes,
  screenToWorld,
  snap,
  svgTransform,
  zoomAt,
  type Camera,
  type PartBox,
  type Point,
  type Size,
} from "./geometry"
import { drawGrid, drawLockBadge, drawMark, drawOutline, drawSelectionBox } from "./overlays"
import { sanitizeSvg } from "./sanitize-svg"

interface Props {
  json: CircuitElement[]
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

/** Schematic colours matching the workspace: transparent sheet over our grid, copper wires. */
const COLORS = {
  schematic: {
    background: "transparent",
    component_body: "#22262c",
    component_outline: "#d9d4c7",
    pin: "#d9d4c7",
    pin_name: "#e9e6df",
    pin_number: "#959ca6",
    reference: "#e0a46a",
    value: "#959ca6",
    fields: "#959ca6",
    wire: "#c98a4b",
    junction: "#e0a46a",
    no_connect: "#e5675e",
    net_name: "#e9e6df",
    label_global: "#6ea8d6",
    label_local: "#6ea8d6",
    label_background: "#22262c",
    note: "#959ca6",
  },
}
const SVG_SIZE = { width: 1200, height: 800 }
const SNAP_STEPS = [0.1, 0.5, 1]
const DRAG_THRESHOLD_PX = 3
const PORT_HIT_PX = 12
const round = (value: number) => Math.round(value * 1000) / 1000

/** The schematic, drawn by tscircuit's SVG renderer under copperflow's own camera, grid and tools. */
export function SchematicCanvas({ json, buildId, circuit, actions, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [camera, setCamera] = useState<Camera>()
  const [gesture, setGesture] = useState<Gesture>()
  const [hover, setHover] = useState<string>()
  const [step, setStep] = useState(0.5)
  const [wiring, setWiring] = useState(false)
  const [first, setFirst] = useState<string | null>(null)
  const [pending, setPending] = useState<{ name: string; offset: Point }>()

  const svg = useMemo(
    () =>
      convertCircuitJsonToSchematicSvg(json as Parameters<typeof convertCircuitJsonToSchematicSvg>[0], {
        ...SVG_SIZE,
        grid: false,
        includeVersion: false,
        drawPorts: wiring,
        colorOverrides: COLORS,
      }),
    [json, wiring],
  )
  const real = useMemo(() => parseMatrix(/data-real-to-screen-transform="([^"]+)"/.exec(svg)?.[1] ?? ""), [svg])
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

  // Insert the sanitised sheet; declared before the effect that positions it.
  useEffect(() => {
    const node = sanitizeSvg(svg)
    sheetRef.current?.replaceChildren(...(node ? [node] : []))
  }, [svg])

  useEffect(() => setPending(undefined), [buildId])

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

  // Place the SVG under the camera, and shift the symbol being moved.
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet || !camera || !real) return
    const t = svgTransform(camera, size, real)
    sheet.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.zoom})`
    const moving = gesture?.kind === "drag" && gesture.moved && !gesture.blocker ? { name: gesture.part.name, offset: gesture.offset } : pending
    for (const group of sheet.querySelectorAll<SVGGElement>("[data-schematic-component-id]")) {
      const part = boxes.find((b) => b.pcbComponentId === group.dataset.schematicComponentId)
      const offset = moving && part?.name === moving.name ? moving.offset : undefined
      group.setAttribute("transform", offset ? `translate(${offset.x * real.a}, ${offset.y * real.d})` : "")
    }
  }, [camera, size, real, svg, gesture, pending, boxes])

  // Grid below the sheet; selection, locks and notes above it.
  useEffect(() => {
    const grid = gridRef.current
    const overlay = overlayRef.current
    if (!grid || !overlay || !camera || size.width === 0) return
    const ratio = window.devicePixelRatio || 1
    for (const canvas of [grid, overlay]) {
      canvas.width = size.width * ratio
      canvas.height = size.height * ratio
    }
    const g = grid.getContext("2d")
    const o = overlay.getContext("2d")
    if (!g || !o) return
    g.setTransform(ratio, 0, 0, ratio, 0, 0)
    g.fillStyle = "#1b1e23"
    g.fillRect(0, 0, size.width, size.height)
    drawGrid(g, camera, size)

    o.setTransform(ratio, 0, 0, ratio, 0, 0)
    o.clearRect(0, 0, size.width, size.height)
    const moving = gesture?.kind === "drag" && gesture.moved && !gesture.blocker ? { name: gesture.part.name, offset: gesture.offset } : pending
    for (const part of boxes) {
      const offset = moving && part.name === moving.name ? moving.offset : { x: 0, y: 0 }
      if (part.name === hover && part.name !== selected) drawOutline(o, camera, size, part.box, offset, "hover")
      if (part.name === selected) drawOutline(o, camera, size, part.box, offset, "selected")
      if (locked.has(part.name)) drawLockBadge(o, camera, size, part.box)
    }
    for (const mark of circuit.annotations.marks) {
      if (mark.view === "schematic" && mark.x !== undefined && mark.y !== undefined) drawMark(o, camera, size, { x: mark.x, y: mark.y }, mark.id, mark.text)
    }
    if (gesture?.kind === "box") drawSelectionBox(o, gesture.start, gesture.current)
  }, [camera, size, gesture, pending, boxes, hover, selected, locked, circuit])

  const local = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return { x: 0, y: 0 }
      return { x: ((event.clientX - rect.left) * size.width) / rect.width, y: ((event.clientY - rect.top) * size.height) / rect.height }
    },
    [size],
  )

  /** The part under the pointer: the SVG element hit first, then the symbol boxes. */
  const partAt = (target: EventTarget | null, world: Point): PartBox | undefined => {
    const id = target instanceof Element ? target.closest<SVGElement>("[data-schematic-component-id]")?.dataset.schematicComponentId : undefined
    return (id ? boxes.find((b) => b.pcbComponentId === id) : undefined) ?? hitTest(boxes, world)
  }

  /** The pin closest to the pointer within a few pixels; pins are too small to hit exactly. */
  const nearestPort = (clientX: number, clientY: number): string | undefined => {
    let best: { id: string; distance: number } | undefined
    for (const element of sheetRef.current?.querySelectorAll<SVGElement>("[data-schematic-port-id]") ?? []) {
      const rect = element.getBoundingClientRect()
      const distance = Math.hypot(rect.x + rect.width / 2 - clientX, rect.y + rect.height / 2 - clientY)
      const id = element.dataset.schematicPortId
      if (id && distance <= PORT_HIT_PX && (!best || distance < best.distance)) best = { id, distance }
    }
    return best?.id
  }

  const onPortClick = (portId: string) => {
    const selector = selectorOfSchematicPort(json, portId)
    if (!selector) return actions.notify("This pin cannot be connected from the editor")
    if (!first) return setFirst(selector)
    if (first === selector) return setFirst(null)
    setFirst(null)
    void actions.edit([{ kind: "addTrace", from: first, to: selector }], `connect ${first} to ${selector}`)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!camera) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = local(event)
    if (event.button === 1 || event.button === 2) return setGesture({ kind: "pan", start: point, camera })
    if (event.shiftKey) return setGesture({ kind: "box", start: point, current: point })
    if (wiring) {
      const port = nearestPort(event.clientX, event.clientY)
      if (port) return onPortClick(port)
    }
    const hit = partAt(event.target, screenToWorld(camera, size, point))
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
    if (!gesture) return setHover(partAt(event.target, world)?.name)
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

  // R rotates the symbol, Delete removes the part, F fits, W toggles wiring.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return
      if (event.key === "f" || event.key === "F") return fit()
      if (event.key === "w" || event.key === "W") {
        setWiring((on) => !on)
        return setFirst(null)
      }
      if (!selected) return
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
  }, [selected, blockerFor, circuit, actions, onSelect, fit])

  const cursorStyle = gesture?.kind === "pan" ? "grabbing" : gesture?.kind === "drag" ? (gesture.blocker ? "not-allowed" : "move") : hover ? "pointer" : "default"

  return (
    <div
      className={`schematic-canvas${wiring ? " wiring" : ""}`}
      ref={wrapRef}
      style={{ cursor: cursorStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(undefined)}
      onContextMenu={(e) => e.preventDefault()}
      role="img"
      aria-label="Schematic. Drag symbols to move them, drag the background to pan, scroll to zoom."
    >
      <canvas ref={gridRef} className="layer" style={{ width: size.width, height: size.height }} />
      <div ref={sheetRef} className="sheet" />
      <canvas ref={overlayRef} className="layer overlay" style={{ width: size.width, height: size.height }} />
      <div className="canvas-tools" onPointerDown={(e) => e.stopPropagation()}>
        <button
          className={wiring ? "active" : ""}
          onClick={() => {
            setWiring(!wiring)
            setFirst(null)
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
      {wiring && <div className="canvas-hint">{first ? `From ${first}: click the second pin` : "Click the first pin"}</div>}
      {!real && <p className="empty">This schematic could not be drawn.</p>}
    </div>
  )
}

