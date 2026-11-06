import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { NetLabel } from "../../../src/engine/schematic.js"
import type { CircuitData, Design } from "../api"
import { WireIcon } from "../icons"
import { keepAutoPlaced } from "./auto-placed"
import { drawEditorLayer, prepareCanvas, useCamera, useCameraFocus, useElementSize, usePlacedParts, type CanvasProps, type Moving } from "./canvas-common"
import { blurButton, CanvasStatus, KeepButton, SnapSelect } from "./CanvasTools"
import { hitTest, unionBoxes, type Box, type Camera, type PartBox, type Point, type Size } from "./geometry"
import { highlightOf, schematicNetAt } from "./highlight"
import { labelHitBox } from "./label-drag"
import { NameInput, PaletteButtons, paletteHint } from "./LabelPalette"
import type { ViolationMarker } from "./markers"
import { drawOutline, drawWirePreview } from "./overlays"
import { drawSchematic } from "./schematic-draw"
import { cursorFor, pointerHandlers, useCanvasGestures, type Gesture } from "./use-canvas-gestures"
import { useDraggedLabel, useLabelDrag, type MovingLabel } from "./use-label-drag"
import { useLabelPalette } from "./use-label-palette"
import { usePartKeys } from "./use-part-keys"
import { useWireTool } from "./use-wire-tool"

const BACKGROUND = "#1b1e23"
const EMPTY_SHEET_CAMERA: Camera = { cx: 0, cy: 0, scale: 60 }
const FIT_MARGIN = 0.06
const SHEET_MARGIN = 1
/** How close to a pin end, wire or label the pointer must be for the H key, in CSS pixels. */
const HIGHLIGHT_REACH_PX = 12

type WireTool = ReturnType<typeof useWireTool>
type Palette = ReturnType<typeof useLabelPalette>

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
  /** The net label or power symbol shown away from where the design has it. */
  movingLabels: MovingLabel[]
  /** The label under the pointer. */
  hoverLabel: NetLabel | undefined
  palette: Palette
  /** The highlighted net and the pins on it. */
  highlight: ReturnType<typeof highlightOf>
  markers: readonly ViolationMarker[]
  activeViolation: string | null
}

/** Draws the sheet and its violation rings, the wire being drawn and the editor layer; a sheet without parts gets a default view. */
function useSheetPaint(canvasRef: RefObject<HTMLCanvasElement | null>, scene: SheetScene): void {
  const { design, camera, size, moving, boxes, hover, selected, locked, circuit, gesture, movingLabels, hoverLabel, palette, highlight, markers, activeViolation } = scene
  const { wiring, drawing, activePins, pendingWires, preview } = scene.wire
  const { ghosts, ghostWires, armed } = palette
  useEffect(() => {
    const view = camera ?? EMPTY_SHEET_CAMERA
    const prepared = prepareCanvas(canvasRef.current, size, view, BACKGROUND)
    if (!prepared) return
    const { ctx, ratio } = prepared
    drawSchematic(ctx, design.schematic, { camera: view, size }, {
      ratio,
      showPins: wiring || drawing !== null || armed,
      activePins,
      pending: [...pendingWires, ...ghostWires, ...movingLabels.map((m) => m.wire)],
      movingLabels,
      ghostLabels: ghosts,
      ...(highlight ? { highlight } : {}),
      ...(moving ? { moving: { component: moving.name, by: moving.offset } } : {}),
      violations: markers,
      ...(activeViolation ? { activeViolation } : {}),
    })
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    if (preview) drawWirePreview(ctx, view, size, preview, "drawing")
    const noteBox = gesture?.kind === "box" ? gesture : undefined
    const shownHover = drawing ? undefined : hover
    drawEditorLayer(ctx, view, size, { view: "schematic", boxes, moving, hover: shownHover, selected, locked, marks: circuit.annotations.marks, noteBox })
    if (hoverLabel && !drawing && !gesture) drawOutline(ctx, view, size, labelHitBox(hoverLabel), { x: 0, y: 0 }, "hover")
  }, [canvasRef, design, camera, size, wiring, drawing, activePins, pendingWires, preview, moving, movingLabels, hoverLabel, boxes, hover, selected, locked, circuit, gesture, ghosts, ghostWires, armed, highlight, markers, activeViolation])
}

interface SheetToolsProps {
  wire: WireTool
  palette: Palette
  step: number
  setStep(step: number): void
  fit(): void
  keep: { show: boolean; onKeep(): void }
}

/** The wire tool's switch, the Place tools, snap, fit and "Keep these positions". */
function SheetTools({ wire, palette, step, setStep, fit, keep }: SheetToolsProps) {
  return (
    <div className="canvas-tools" onPointerDown={(e) => e.stopPropagation()} onClick={blurButton}>
      <button
        className={wire.wiring ? "active" : ""}
        aria-pressed={wire.wiring}
        onClick={() => {
          palette.disarm()
          wire.toggleWiring()
        }}
        title="Wire pins (W or Alt+W)"
      >
        <WireIcon /> {wire.wiring ? "Stop wiring" : "Wire pins"}
      </button>
      <PaletteButtons palette={palette} />
      <span className="tool-divider" aria-hidden="true" />
      <SnapSelect step={step} onChange={setStep} unit={undefined} />
      <button onClick={fit} title="Fit the schematic (F or K)">
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

/** The highlighted net with its pins and the names its wires and labels may carry, so they can be drawn lit. */
function useHighlight(design: Design, net: string | null): SheetScene["highlight"] {
  return useMemo(() => highlightOf(design, net), [design, net])
}

/** The label being dragged, then those moved and waiting for their build. */
function useMovingLabels(design: Design, gesture: Gesture | undefined, pending: MovingLabel[]): MovingLabel[] {
  const dragged = useMemo(() => (gesture?.kind === "label" && gesture.moved && !gesture.blocker ? { id: gesture.label.id, at: gesture.at } : undefined), [gesture])
  const draggedLabel = useDraggedLabel(design, dragged)
  return useMemo(() => (draggedLabel ? [draggedLabel, ...pending.filter((m) => m.id !== draggedLabel.id)] : pending), [draggedLabel, pending])
}

interface SheetKeysInput {
  design: Design
  camera: Camera | undefined
  cursor: Point | undefined
  fit(): void
  wire: WireTool
  palette: Palette
  highlightNet: string | null
  onHighlight(net: string | null): void
  keys: Omit<Parameters<typeof usePartKeys>[0], "paused" | "fit" | "netUnderPointer" | "onHighlight">
}

/** The part keys with H over the sheet, and the hand-over between wiring and the Place tools; returns what to draw lit. */
function useSheetKeys({ design, camera, cursor, fit, wire, palette, highlightNet, onHighlight, keys }: SheetKeysInput): SheetScene["highlight"] {
  const cursorRef = useRef<Point | undefined>(undefined)
  cursorRef.current = cursor
  const netUnderPointer = useCallback(
    () => (camera && cursorRef.current ? schematicNetAt(design, cursorRef.current, HIGHLIGHT_REACH_PX / camera.scale) : undefined),
    [design, camera],
  )
  usePartKeys({ ...keys, paused: wire.drawing !== null, fit, netUnderPointer, onHighlight })
  const { wiring, drawing } = wire
  const { disarm } = palette
  // Wiring takes over from a Place tool, as arming a Place tool stops wiring.
  useEffect(() => {
    if (wiring || drawing) disarm()
  }, [wiring, drawing, disarm])
  return useHighlight(design, highlightNet)
}

/**
 * The schematic, drawn by copperflow's own renderer under its camera, grid and tools, with the
 * wire tool (see useWireTool) and the Place tools (see useLabelPalette).
 */
export function SchematicCanvas({ design, buildId, builtFrom, circuit, actions, selected, onSelect, highlight: highlightNet, onHighlight, markers, activeViolation, focus, onFocused }: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(wrapRef)
  const [hover, setHover] = useState<string>()
  const [hoverLabel, setHoverLabel] = useState<NetLabel>()
  const [cursor, setCursor] = useState<Point>()
  const [step, setStep] = useState(0.5)
  const parts = usePlacedParts(design, "schematic", circuit)
  const bounds = useMemo(() => sheetBounds(parts.boxes), [parts.boxes])
  const { camera, setCamera, fit } = useCamera(wrapRef, size, bounds, FIT_MARGIN)
  useCameraFocus("schematic", focus, camera, setCamera, onFocused)
  const wire = useWireTool({ design, actions, camera, cursor, step, buildId, builtFrom })
  const palette = useLabelPalette({ design, circuit, actions, camera, cursor, builtFrom, onArm: wire.cancel })
  const common = { view: "schematic", circuit, actions, onSelect, blockerFor: parts.blockerFor } as const
  const labels = useLabelDrag({ design, circuit, actions, builtFrom })
  const gestures = useCanvasGestures({ ...common, camera, setCamera, size, boxes: parts.boxes, anchors: parts.anchors, step, builtFrom, labels: labels.tools })
  const highlight = useSheetKeys({ design, camera, cursor, fit, wire, palette, highlightNet, onHighlight, keys: { ...common, selected } })
  const { moving, gesture } = gestures
  const movingLabels = useMovingLabels(design, gesture, labels.pending)
  useSheetPaint(canvasRef, { design, camera, size, wire, moving, boxes: parts.boxes, hover, selected, locked: parts.locked, circuit, gesture, movingLabels, hoverLabel, palette, highlight, markers, activeViolation })
  const hoverAt = (world: Point) => {
    wire.hover(world)
    const part = hitTest(parts.boxes, world)?.name
    setHover(part)
    setHoverLabel(part === undefined ? labels.tools.at(world) : undefined)
  }
  const press = (event: { button: number; shiftKey: boolean }, world: Point) => palette.press(event, world) || wire.press(event, world)
  const pointer = pointerHandlers({ camera, size, element: wrapRef, gestures, setCursor, tool: press, hover: hoverAt })
  const hint = wireHint(wire) ?? paletteHint(palette)

  return (
    <div
      className="schematic-canvas"
      ref={wrapRef}
      style={{ cursor: cursorFor(gesture, wire.drawing !== null || wire.overPin || palette.armed, hover !== undefined || hoverLabel !== undefined) }}
      {...pointer}
      onPointerLeave={() => {
        setHover(undefined)
        setHoverLabel(undefined)
        wire.leave()
        setCursor(undefined)
      }}
      onContextMenu={(e) => e.preventDefault()}
      role="img"
      aria-label="Schematic. Drag symbols and net labels to move them, drag the background to pan, scroll to zoom. Click a free pin or press W over a pin to draw a wire."
    >
      <canvas ref={canvasRef} style={{ width: size.width, height: size.height }} />
      <div className="canvas-top">
        <SheetTools wire={wire} palette={palette} step={step} setStep={setStep} fit={fit} keep={{ show: parts.autoPlaced, onKeep: () => keepAutoPlaced(design, "schematic", parts.blockerFor, actions) }} />
        {hint && <div className="canvas-hint">{hint}</div>}
      </div>
      <NameInput palette={palette} camera={camera} size={size} />
      <CanvasStatus cursor={cursor} zoom={(camera ?? EMPTY_SHEET_CAMERA).scale} detail={wire.under.end?.label} gesture={gesture} />
      {!bounds && <p className="empty">This schematic has no parts yet.</p>}
    </div>
  )
}
