import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { CircuitData, Design } from "../api"
import { WireIcon } from "../icons"
import { keepAutoPlaced } from "./auto-placed"
import { drawEditorLayer, prepareCanvas, useCamera, useElementSize, usePlacedParts, type CanvasProps, type Moving } from "./canvas-common"
import { CanvasStatus, KeepButton, SnapSelect } from "./CanvasTools"
import { hitTest, unionBoxes, type Box, type Camera, type PartBox, type Point, type Size } from "./geometry"
import { drawWirePreview } from "./overlays"
import { drawSchematic } from "./schematic-draw"
import { cursorFor, pointerHandlers, useCanvasGestures, type Gesture } from "./use-canvas-gestures"
import { usePartKeys } from "./use-part-keys"
import { useWireTool } from "./use-wire-tool"

const BACKGROUND = "#1b1e23"
const EMPTY_SHEET_CAMERA: Camera = { cx: 0, cy: 0, scale: 60 }
const FIT_MARGIN = 0.06
const SHEET_MARGIN = 1

type WireTool = ReturnType<typeof useWireTool>

interface SheetScene {
  design: Design
  camera: Camera | undefined
  size: Size
  wire: WireTool
  moving: Moving | undefined
  boxes: PartBox[]
  hover: string | undefined
  selected: string | null
  locked: ReadonlySet<string>
  circuit: CircuitData
  gesture: Gesture | undefined
}

/** Draws the sheet, the wire being drawn and the editor layer; a sheet without parts gets a default view. */
function useSheetPaint(canvasRef: RefObject<HTMLCanvasElement | null>, scene: SheetScene): void {
  const { design, camera, size, moving, boxes, hover, selected, locked, circuit, gesture } = scene
  const { wiring, drawing, activePins, pendingWires, preview } = scene.wire
  useEffect(() => {
    const view = camera ?? EMPTY_SHEET_CAMERA
    const prepared = prepareCanvas(canvasRef.current, size, view, BACKGROUND)
    if (!prepared) return
    const { ctx, ratio } = prepared
    drawSchematic(ctx, design.schematic, { camera: view, size }, {
      ratio,
      showPins: wiring || drawing !== null,
      activePins,
      pending: pendingWires,
      ...(moving ? { moving: { component: moving.name, by: moving.offset } } : {}),
    })
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    if (preview) drawWirePreview(ctx, view, size, preview, "drawing")
    const noteBox = gesture?.kind === "box" ? gesture : undefined
    const shownHover = drawing ? undefined : hover
    drawEditorLayer(ctx, view, size, { view: "schematic", boxes, moving, hover: shownHover, selected, locked, marks: circuit.annotations.marks, noteBox })
  }, [canvasRef, design, camera, size, wiring, drawing, activePins, pendingWires, preview, moving, boxes, hover, selected, locked, circuit, gesture])
}

/** The wire tool's switch, snap, fit and "Keep these positions". */
function SheetTools({ wire, step, setStep, fit, keep }: { wire: WireTool; step: number; setStep(step: number): void; fit(): void; keep: { show: boolean; onKeep(): void } }) {
  return (
    <div className="canvas-tools" onPointerDown={(e) => e.stopPropagation()}>
      <button className={wire.wiring ? "active" : ""} aria-pressed={wire.wiring} onClick={wire.toggleWiring} title="Wire pins (W)">
        <WireIcon /> {wire.wiring ? "Stop wiring" : "Wire pins"}
      </button>
      <SnapSelect step={step} onChange={setStep} unit="" />
      <button onClick={fit} title="Fit the schematic (F)">
        Fit
      </button>
      <KeepButton {...keep} title="Write the faded symbols' positions into the code as schX and schY" />
    </div>
  )
}

/** Every symbol with a margin around them, or undefined for an empty sheet. */
function sheetBounds(boxes: PartBox[]): Box | undefined {
  const all = unionBoxes(boxes.map((b) => b.box))
  return all && { minX: all.minX - SHEET_MARGIN, minY: all.minY - SHEET_MARGIN, maxX: all.maxX + SHEET_MARGIN, maxY: all.maxY + SHEET_MARGIN }
}

function wireHint(wire: WireTool): string | undefined {
  if (wire.drawing) {
    return `From ${wire.drawing.start.label}: click the sheet for a corner, then a pin, a wire or a net label to finish. Backspace removes a corner, Esc cancels.`
  }
  return wire.wiring ? "Click a pin to start a wire. Esc stops wiring." : undefined
}

/**
 * The schematic, drawn by copperflow's own renderer under its camera, grid and tools, with the
 * wire tool (see useWireTool).
 */
export function SchematicCanvas({ design, buildId, builtFrom, circuit, actions, selected, onSelect }: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(wrapRef)
  const [hover, setHover] = useState<string>()
  const [cursor, setCursor] = useState<Point>()
  const [step, setStep] = useState(0.5)
  const parts = usePlacedParts(design, "schematic", circuit)
  const bounds = useMemo(() => sheetBounds(parts.boxes), [parts.boxes])
  const { camera, setCamera, fit } = useCamera(wrapRef, size, bounds, FIT_MARGIN)
  const wire = useWireTool({ design, actions, camera, cursor, step, buildId, builtFrom })
  const common = { view: "schematic", circuit, actions, onSelect, blockerFor: parts.blockerFor } as const
  const gestures = useCanvasGestures({ ...common, camera, setCamera, size, boxes: parts.boxes, anchors: parts.anchors, step, builtFrom })
  usePartKeys({ ...common, selected, paused: wire.drawing !== null, fit })
  const { moving, gesture } = gestures
  useSheetPaint(canvasRef, { design, camera, size, wire, moving, boxes: parts.boxes, hover, selected, locked: parts.locked, circuit, gesture })
  const hoverAt = (world: Point) => {
    wire.hover(world)
    setHover(hitTest(parts.boxes, world)?.name)
  }
  const pointer = pointerHandlers({ camera, size, element: wrapRef, gestures, setCursor, tool: wire.press, hover: hoverAt })
  const hint = wireHint(wire)

  return (
    <div
      className="schematic-canvas"
      ref={wrapRef}
      style={{ cursor: cursorFor(gesture, wire.drawing !== null || wire.overPin, hover !== undefined) }}
      {...pointer}
      onPointerLeave={() => {
        setHover(undefined)
        wire.leave()
        setCursor(undefined)
      }}
      onContextMenu={(e) => e.preventDefault()}
      role="img"
      aria-label="Schematic. Drag symbols to move them, drag the background to pan, scroll to zoom. Click a free pin or press W over a pin to draw a wire."
    >
      <canvas ref={canvasRef} style={{ width: size.width, height: size.height }} />
      <SheetTools wire={wire} step={step} setStep={setStep} fit={fit} keep={{ show: parts.autoPlaced, onKeep: () => keepAutoPlaced(design, "schematic", parts.blockerFor, actions) }} />
      {hint && <div className="canvas-hint">{hint}</div>}
      <CanvasStatus cursor={cursor} unit="" detail={wire.under.end?.label} gesture={gesture} />
      {!bounds && <p className="empty">This schematic has no parts yet.</p>}
    </div>
  )
}
