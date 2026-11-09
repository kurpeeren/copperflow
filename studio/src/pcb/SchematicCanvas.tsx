import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { NetLabel } from "../../../src/engine/schematic.js"
import type { CircuitData, Design } from "../api"
import type { SheetCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import { armedCommand } from "../shell/toolbar"
import { clearToolState, setToolState } from "../shell/tool-state"
import { ViewTools } from "../shell/ViewTools"
import { keepAutoPlaced } from "./auto-placed"
import { drawEditorLayer, prepareCanvas, useCamera, useCameraFocus, useElementSize, usePlacedParts, type CanvasProps, type Moving } from "./canvas-common"
import { CanvasStatus, GridSelect, KeepButton } from "./CanvasTools"
import { gridStepOptions, type GridLook } from "./grid"
import { hitTest, unionBoxes, type Camera, type PartBox, type Point, type Size } from "./geometry"
import { highlightOf, partNets, schematicNetAt, type Highlight } from "./highlight"
import { labelHitBox } from "./label-drag"
import { NameInput, paletteHint } from "./LabelPalette"
import type { ViolationMarker } from "./markers"
import { drawOutline, drawWirePreview, SHEET_LOOK } from "./overlays"
import { drawSchematicGrid } from "./schematic-grid"
import { schematicTheme } from "./schematic-theme"
import { drawSchematic } from "./schematic-draw"
import { drawingExtents } from "./drawing-extents"
import { drawSheetBorder } from "./sheet-draw"
import { firstDrawing, keepSheet, sheetArt, sheetDate, type Sheet, type SheetArt } from "./sheet"
import { cursorFor, pointerHandlers, useCanvasGestures, type Gesture } from "./use-canvas-gestures"
import { useDraggedLabel, useLabelDrag, type LabelTools, type MovingLabel } from "./use-label-drag"
import { useLabelPalette } from "./use-label-palette"
import { usePartKeys } from "./use-part-keys"
import { useWireTool } from "./use-wire-tool"

const EMPTY_SHEET_CAMERA: Camera = { cx: 0, cy: 0, scale: 60 }
const FIT_MARGIN = 0.06
/** How close to a pin end, wire or label the pointer must be for the H key, in CSS pixels. */
const HIGHLIGHT_REACH_PX = 12

type WireTool = ReturnType<typeof useWireTool>
type Palette = ReturnType<typeof useLabelPalette>

interface SheetScene {
  design: Design
  /** The drawing border and its title block. */
  border: SheetArt
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
  /** The highlighted nets and the pins on them. */
  highlight: ReturnType<typeof highlightOf>
  markers: readonly ViolationMarker[]
  activeViolation: string | null
  /** The grid's step and style. */
  grid: GridLook
}

/** Draws the sheet and its violation rings, the wire being drawn and the editor layer; a sheet without parts gets a default view. */
function useSheetPaint(canvasRef: RefObject<HTMLCanvasElement | null>, scene: SheetScene): void {
  const { design, border, camera, size, moving, boxes, hover, selected, locked, circuit, gesture, movingLabels, hoverLabel, palette, highlight, markers, activeViolation, grid } = scene
  const { wiring, drawing, activePins, pendingWires, preview } = scene.wire
  const { ghosts, ghostWires, armed } = palette
  useEffect(() => {
    const view = camera ?? EMPTY_SHEET_CAMERA
    const prepared = prepareCanvas(canvasRef.current, size, view, schematicTheme.background, (c, cam, s) => drawSchematicGrid(c, cam, s, grid))
    if (!prepared) return
    const { ctx, ratio } = prepared
    drawSheetBorder(ctx, view, size, border)
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
    if (preview) drawWirePreview(ctx, view, size, preview, "drawing", schematicTheme.wire)
    const noteBox = gesture?.kind === "box" ? gesture : undefined
    const shownHover = drawing ? undefined : hover
    drawEditorLayer(ctx, view, size, { view: "schematic", boxes, moving, hover: shownHover, selected, locked, marks: circuit.annotations.marks, noteBox, look: SHEET_LOOK })
    if (hoverLabel && !drawing && !gesture) drawOutline(ctx, view, size, labelHitBox(hoverLabel), { x: 0, y: 0 }, "hover", SHEET_LOOK)
  }, [canvasRef, design, border, camera, size, wiring, drawing, activePins, pendingWires, preview, moving, movingLabels, hoverLabel, boxes, hover, selected, locked, circuit, gesture, ghosts, ghostWires, armed, highlight, markers, activeViolation, grid])
}

interface SheetToolsProps {
  step: number
  setStep(step: number): void
  keep: { show: boolean; onKeep(): void }
}

/** Grid and "Keep these positions", in the toolbar's right side; rendered beside the sheet, not inside its pointer handlers. */
function SheetTools({ step, setStep, keep }: SheetToolsProps) {
  return (
    <ViewTools>
      <GridSelect step={step} options={gridStepOptions("schematic")} onChange={setStep} />
      <KeepButton {...keep} title="Write the faded symbols' positions into the code as schX and schY" />
    </ViewTools>
  )
}

/** The part or the net label under the pointer, and the wire tool's view of it. */
function useSheetHover(boxes: PartBox[], wire: WireTool, labels: LabelTools) {
  const [part, setPart] = useState<string>()
  const [label, setLabel] = useState<NetLabel>()
  const at = (world: Point) => {
    wire.hover(world)
    const hit = hitTest(boxes, world)?.name
    setPart(hit)
    setLabel(hit === undefined ? labels.at(world) : undefined)
  }
  const leave = () => {
    setPart(undefined)
    setLabel(undefined)
    wire.leave()
  }
  return { part, label, at, leave }
}

interface SheetViewProps {
  wrapRef: RefObject<HTMLDivElement | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
  size: Size
  camera: Camera | undefined
  cursor: Point | undefined
  pointer: ReturnType<typeof pointerHandlers>
  /** The pointer left the sheet. */
  onLeave(): void
  cursorStyle: string
  wire: WireTool
  palette: Palette
  gesture: Gesture | undefined
  empty: boolean
}

/** The sheet's element: the canvas under the hint, the label name field and the status line. */
function SheetView({ wrapRef, canvasRef, size, camera, cursor, pointer, onLeave, cursorStyle, wire, palette, gesture, empty }: SheetViewProps) {
  const hint = wireHint(wire) ?? paletteHint(palette)
  return (
    <div
      className="schematic-canvas"
      ref={wrapRef}
      style={{ cursor: cursorStyle }}
      {...pointer}
      onPointerLeave={onLeave}
      onContextMenu={(e) => e.preventDefault()}
      role="img"
      aria-label="Schematic. Drag symbols and net labels to move them, drag the background to pan, scroll to zoom. Click a free pin or press W over a pin to draw a wire."
    >
      <canvas ref={canvasRef} style={{ width: size.width, height: size.height }} />
      {hint && (
        <div className="canvas-top">
          <div className="canvas-hint">{hint}</div>
        </div>
      )}
      <NameInput palette={palette} camera={camera} size={size} />
      <CanvasStatus cursor={cursor} zoom={(camera ?? EMPTY_SHEET_CAMERA).scale} detail={wire.under.end?.label} gesture={gesture} />
      {empty && <p className="empty">This schematic has no parts yet.</p>}
    </div>
  )
}

/** The sheet, kept as it is while the drawing still fits it (so it does not move under the parts). */
function useHeldSheet(design: Design): Sheet {
  const held = useRef<Sheet>(undefined)
  const extents = useMemo(() => drawingExtents(design.schematic), [design.schematic])
  return useMemo(() => {
    const next = keepSheet(held.current, extents)
    held.current = next
    return next
  }, [extents])
}

/** Refits the camera when the first parts arrive on a sheet that had none, and not on later changes. */
function useRefitOnFirstDrawing(sheet: Sheet, fit: () => void): void {
  const before = useRef<Sheet>(undefined)
  useEffect(() => {
    if (firstDrawing(before.current, sheet)) fit()
    before.current = sheet
  }, [sheet, fit])
}

function wireHint(wire: WireTool): string | undefined {
  if (wire.drawing) {
    return `From ${wire.drawing.start.label}: click the sheet for a corner, then a pin, a wire or a net label to finish. Backspace removes a corner, Esc cancels.`
  }
  return wire.wiring ? "Click a pin to start a wire. Esc stops wiring." : undefined
}

/** The highlighted nets with their pins and the names their wires and labels may carry, so they can be drawn lit. */
function useHighlight(design: Design, nets: Highlight): SheetScene["highlight"] {
  return useMemo(() => highlightOf(design, nets), [design, nets])
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
  highlightNets: Highlight
  onHighlight(nets: Highlight): void
  keys: Omit<Parameters<typeof usePartKeys>[0], "paused" | "fit" | "netUnderPointer" | "netsOf" | "onHighlight">
}

/** The part keys with H over the sheet, and the hand-over between wiring and the Place tools; returns what to draw lit. */
function useSheetKeys({ design, camera, cursor, fit, wire, palette, highlightNets, onHighlight, keys }: SheetKeysInput): SheetScene["highlight"] {
  const cursorRef = useRef<Point | undefined>(undefined)
  cursorRef.current = cursor
  const netUnderPointer = useCallback(
    () => (camera && cursorRef.current ? schematicNetAt(design, cursorRef.current, HIGHLIGHT_REACH_PX / camera.scale) : undefined),
    [design, camera],
  )
  const netsOf = useCallback((part: string) => partNets(design, part), [design])
  usePartKeys({ ...keys, paused: wire.drawing !== null, fit, netUnderPointer, netsOf, onHighlight })
  const { wiring, drawing } = wire
  const { disarm } = palette
  // Wiring takes over from a Place tool, as arming a Place tool stops wiring.
  useEffect(() => {
    if (wiring || drawing) disarm()
  }, [wiring, drawing, disarm])
  useArmedTool(wire, palette)
  const tools: Record<SheetCommand, () => void> = {
    wire: () => {
      disarm()
      if (!wiring) wire.toggleWiring()
    },
    netLabel: () => palette.arm("label"),
    groundFlag: () => palette.arm("gnd"),
    powerFlag: () => palette.arm("vcc"),
  }
  useCommands(tools)
  return useHighlight(design, highlightNets)
}

/** Tells the toolbar which tool is armed, and how to put it away. */
function useArmedTool(wire: WireTool, palette: Palette): void {
  const { wiring, cancel } = wire
  const { tool, disarm } = palette
  const active = armedCommand(wiring, tool)
  useEffect(() => {
    setToolState({
      active,
      stop: () => {
        disarm()
        cancel()
      },
    })
  }, [active, disarm, cancel])
  useEffect(() => clearToolState, [])
}

/**
 * The schematic, drawn by copperflow's own renderer under its camera, grid and tools, with the
 * wire tool (see useWireTool) and the Place tools (see useLabelPalette).
 */
export function SchematicCanvas({ design, buildId, project, builtFrom, circuit, actions, selected, onSelect, highlight: highlightNets, onHighlight, gridStyle, gridStep: step, onGridStep: setStep, markers, activeViolation, focus, onFocused }: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(wrapRef)
  const [cursor, setCursor] = useState<Point>()
  const grid = useMemo<GridLook>(() => ({ step, style: gridStyle }), [step, gridStyle])
  const parts = usePlacedParts(design, "schematic", circuit)
  const sheet = useHeldSheet(design)
  const { camera, setCamera, fit } = useCamera(wrapRef, size, sheet.outer, FIT_MARGIN)
  useRefitOnFirstDrawing(sheet, fit)
  const border = useMemo(() => sheetArt(sheet, { project: project ?? "", page: "Schematic", file: circuit.file, date: sheetDate(buildId), rev: "" }), [sheet, project, circuit.file, buildId])
  useCameraFocus("schematic", focus, camera, setCamera, onFocused)
  const wire = useWireTool({ design, actions, camera, cursor, step, buildId, builtFrom })
  const palette = useLabelPalette({ design, circuit, actions, camera, cursor, builtFrom, onArm: wire.cancel })
  const common = { view: "schematic", circuit, actions, onSelect, blockerFor: parts.blockerFor } as const
  const labels = useLabelDrag({ design, circuit, actions, builtFrom })
  const gestures = useCanvasGestures({ ...common, camera, setCamera, size, boxes: parts.boxes, anchors: parts.anchors, step, builtFrom, labels: labels.tools })
  const highlight = useSheetKeys({ design, camera, cursor, fit, wire, palette, highlightNets, onHighlight, keys: { ...common, selected } })
  const hover = useSheetHover(parts.boxes, wire, labels.tools)
  const { moving, gesture } = gestures
  const movingLabels = useMovingLabels(design, gesture, labels.pending)
  useSheetPaint(canvasRef, { design, border, camera, size, wire, moving, boxes: parts.boxes, hover: hover.part, selected, locked: parts.locked, circuit, gesture, movingLabels, hoverLabel: hover.label, palette, highlight, markers, activeViolation, grid })
  const press = (event: { button: number; shiftKey: boolean }, world: Point) => palette.press(event, world) || wire.press(event, world)
  const pointer = pointerHandlers({ camera, size, element: wrapRef, gestures, setCursor, tool: press, hover: hover.at })
  const cursorStyle = cursorFor(gesture, wire.drawing !== null || wire.overPin || palette.armed, hover.part !== undefined || hover.label !== undefined)
  const onLeave = () => {
    hover.leave()
    setCursor(undefined)
  }
  // The toolbar's controls sit beside the sheet: inside it, their portal's events would reach the sheet's handlers.
  return (
    <>
      <SheetTools step={step} setStep={setStep} keep={{ show: parts.autoPlaced, onKeep: () => keepAutoPlaced(design, "schematic", parts.blockerFor, actions) }} />
      <SheetView {...{ wrapRef, canvasRef, size, camera, cursor, pointer, onLeave, cursorStyle, wire, palette, gesture }} empty={parts.boxes.length === 0} />
    </>
  )
}
