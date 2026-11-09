import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { Actions } from "../App"
import type { NetLabel } from "../../../src/engine/schematic.js"
import type { CircuitData, Design } from "../api"
import { Selection } from "../selection"
import type { SheetCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import { armedCommand } from "../shell/toolbar"
import { clearToolState, setToolState } from "../shell/tool-state"
import { ViewTools } from "../shell/ViewTools"
import { keepAutoPlaced } from "./auto-placed"
import { drawEditorLayer, prepareCanvas, useCamera, useCameraFocus, useElementSize, useKeyMenuPlace, useLayout, usePlacedParts, type CanvasProps, type Moving, type PropertiesTarget } from "./canvas-common"
import { CanvasStatus, GridSelect, KeepButton } from "./CanvasTools"
import { gridStepOptions, type GridLook } from "./grid"
import { unionBoxes, type Camera, type PartBox, type Point, type Size } from "./geometry"
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
import { doubleClickAction, targetAt, type GestureDrawings, type GestureWires } from "./gestures"
import type { ContextTarget } from "./press"
import type { PickContext } from "./pick"
import type { PickFilter } from "./pick-filter"
import { cursorFor, pointerHandlers, useCanvasGestures, type Gesture, type GestureInput, type PointerInput, type Press } from "./use-canvas-gestures"
import { useDraggedLabel, useLabelDrag, type LabelTools, type MovingLabel } from "./use-label-drag"
import { useTargetActions } from "../shell/use-target-actions"
import { useLabelPalette } from "./use-label-palette"
import { boxToolCommand } from "./box-tool"
import { useFitSelection } from "./use-fit-selection"
import { useNoteTool } from "./use-note-tool"
import { usePartKeys } from "./use-part-keys"
import type { KeyMove } from "./use-key-edits"
import { labelsAfterMove, previewMoving } from "./move-preview"
import type { Anchor } from "./positions"
import { useWireTool } from "./use-wire-tool"
import { useSheetWires, type SheetCorners } from "./use-sheet-wires"
import type { WireLine } from "./wire-hit"
import { drawWireHandles, drawWireHover, SHEET_WIRE_LOOK } from "./wire-overlay"
import { liveShapes, withShapes } from "./wire-drag"
import type { SchematicDrawing } from "../../../src/engine/model.js"
import { drawingBox } from "./drawing-hit"
import { useSheetDrawings } from "./use-sheet-drawings"

const EMPTY_SHEET_CAMERA: Camera = { cx: 0, cy: 0, scale: 60 }
const FIT_MARGIN = 0.06
/** How close to a pin end, wire or label the pointer must be for the H key, in CSS pixels. */
const HIGHLIGHT_REACH_PX = 12

type WireTool = ReturnType<typeof useWireTool>
type Palette = ReturnType<typeof useLabelPalette>
type NoteTool = ReturnType<typeof useNoteTool>

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
  selection: Selection
  locked: ReadonlySet<string>
  circuit: CircuitData
  gesture: Gesture | undefined
  /** The net label or power symbol shown away from where the design has it. */
  movingLabels: MovingLabel[]
  /** The label under the pointer. */
  hoverLabel: NetLabel | undefined
  /** The drawing under the pointer. */
  hoverDrawing: SchematicDrawing | undefined
  /** The wire under the pointer, and the wire selected alone, which gets its handles; every selected wire is red. */
  hoverWire: WireLine | undefined
  selectedWire: WireLine | undefined
  /** Wires drawn in a new shape: those a move takes along, the one being reshaped, then those waiting for their build. */
  wireShapes: readonly WireLine[]
  palette: Palette
  /** The highlighted nets and the pins on them. */
  highlight: ReturnType<typeof highlightOf>
  markers: readonly ViolationMarker[]
  activeViolation: string | null
  /** The grid's step and style. */
  grid: GridLook
}

/**
 * The sheet with the wires in `shapes` drawn in their new shapes and the labels a move takes along at their new places
 * (move-preview.ts), and the selected wire's line in its own.
 */
function useShapedSheet(design: Design, selectedWire: WireLine | undefined, shapes: readonly WireLine[], moving: Moving | undefined) {
  const sheet = useMemo(() => {
    const labels = labelsAfterMove(design.schematic, moving)
    if (shapes.length === 0 && labels === design.schematic.labels) return design.schematic
    return { ...design.schematic, wires: [...withShapes(design.schematic.wires, shapes)], labels: [...labels] }
  }, [design.schematic, shapes, moving])
  const selected = useMemo(() => selectedWire && withShapes([selectedWire], shapes)[0], [selectedWire, shapes])
  return { sheet, selected }
}

/** Draws the sheet and its violation rings, the wire being drawn and the editor layer; a sheet without parts gets a default view. */
function useSheetPaint(canvasRef: RefObject<HTMLCanvasElement | null>, scene: SheetScene): void {
  const { design, border, camera, size, moving, boxes, hover, selection, locked, circuit, gesture, movingLabels, hoverLabel, hoverDrawing, hoverWire, palette, highlight, markers, activeViolation, grid } = scene
  const { wiring, drawing, activePins, pendingWires, preview } = scene.wire
  const { ghosts, ghostWires, armed } = palette
  const { sheet, selected: selectedWire } = useShapedSheet(design, scene.selectedWire, scene.wireShapes, moving)
  useEffect(() => {
    const view = camera ?? EMPTY_SHEET_CAMERA
    const prepared = prepareCanvas(canvasRef.current, size, view, schematicTheme.background, (c, cam, s, r) => drawSchematicGrid(c, cam, s, grid, r))
    if (!prepared) return
    const { ctx, ratio } = prepared
    drawSheetBorder(ctx, view, size, border, ratio)
    drawSchematic(ctx, sheet, { camera: view, size }, {
      ratio,
      showPins: wiring || drawing !== null || armed,
      activePins,
      pending: [...pendingWires, ...ghostWires, ...movingLabels.map((m) => m.wire)],
      movingLabels,
      ghostLabels: ghosts,
      selectedWires: selection.wires,
      selectedLabels: selection.labels,
      selectedDrawings: selection.drawings,
      ...(moving?.drawings ? { movingDrawings: moving.drawings } : {}),
      ...(highlight ? { highlight } : {}),
      ...(moving ? { moving: { components: moving.names, by: moving.offset } } : {}),
      violations: markers,
      ...(activeViolation ? { activeViolation } : {}),
    })
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    if (preview) drawWirePreview(ctx, view, size, preview, "drawing", schematicTheme.wire, ratio)
    const shownHover = drawing ? undefined : hover
    drawEditorLayer(ctx, view, size, { view: "schematic", boxes, moving, hover: shownHover, selection, locked, marks: circuit.annotations.marks, gesture, look: SHEET_LOOK, ratio })
    if (hoverLabel && !drawing && !gesture) drawOutline(ctx, view, size, labelHitBox(hoverLabel), { x: 0, y: 0 }, "hover", SHEET_LOOK, ratio)
    if (hoverDrawing && !selection.hasDrawing(hoverDrawing.id) && !drawing && !gesture) drawOutline(ctx, view, size, drawingBox(hoverDrawing), { x: 0, y: 0 }, "hover", SHEET_LOOK, ratio)
    if (hoverWire && !selection.hasWire(hoverWire.id) && !wiring && !drawing && !gesture) drawWireHover(ctx, view, size, hoverWire.points, SHEET_WIRE_LOOK, ratio)
    // A net label dragged off the selected wire hides its line, so its handles go too.
    if (selectedWire && !movingLabels.some((m) => m.hideWire === selectedWire.id)) drawWireHandles(ctx, view, size, selectedWire.points, SHEET_WIRE_LOOK, ratio)
  }, [canvasRef, sheet, border, camera, size, wiring, drawing, activePins, pendingWires, preview, moving, movingLabels, hoverLabel, hoverDrawing, hoverWire, selectedWire, boxes, hover, selection, locked, circuit, gesture, ghosts, ghostWires, armed, highlight, markers, activeViolation, grid])
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

interface SheetHoverInput {
  boxes: PartBox[]
  wire: WireTool
  labels: LabelTools
  filter: PickFilter
  wires: GestureWires
  drawings: GestureDrawings
  /** Clears the cursor's place in the status line when the pointer leaves the sheet. */
  setCursor(at: Point | undefined): void
}

/** The part, net label, wire or drawing under the pointer, and the wire tool's view of it; `leave` forgets them when the pointer leaves the sheet. */
function useSheetHover({ boxes, wire, labels, filter, wires, drawings, setCursor }: SheetHoverInput) {
  const [target, setTarget] = useState<ContextTarget>({ kind: "canvas" })
  const at = (world: Point) => {
    wire.hover(world)
    // What a click may not pick (pick.ts: the Filter tab) is not outlined under the pointer either.
    setTarget(targetAt(boxes, labels, world, { selection: Selection.none, armed: null, filter }, wires, drawings))
  }
  const leave = () => {
    setTarget({ kind: "canvas" })
    setCursor(undefined)
    wire.leave()
  }
  const part = target.kind === "part" ? target.name : undefined
  const label = target.kind === "label" ? target.label : undefined
  const wireId = target.kind === "wire" ? target.id : undefined
  const drawing = target.kind === "drawing" ? target.id : undefined
  return { part, label, wire: wireId, drawing, over: target.kind !== "canvas", at, leave }
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
  note: NoteTool
  gesture: Gesture | undefined
  /** A Rotate press is held until the next build. */
  rotateHeld: boolean
  snap: boolean
  empty: boolean
}

/**
 * The sheet's element: the canvas under the hint, the label name field and the status line; the browser's own menu
 * never shows. The canvas alone is the image, so the name field beside it stays a field to assistive tech.
 */
function SheetView({ wrapRef, canvasRef, size, camera, cursor, pointer, onLeave, cursorStyle, wire, palette, note, gesture, rotateHeld, snap, empty }: SheetViewProps) {
  const hint = wireHint(wire) ?? paletteHint(palette) ?? note.hint
  return (
    <div className="schematic-canvas" ref={wrapRef} style={{ cursor: cursorStyle }} {...pointer} onPointerLeave={onLeave} onContextMenu={(e) => e.preventDefault()}>
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height: size.height }}
        role="img"
        aria-label="Schematic. Drag symbols, net labels and drawings to move them, click a wire to select it, Shift or Ctrl click parts, wires, net labels and drawings to add them, drag a wire or its corner handles to reshape it, drag the background to select, drag with the right button to pan, scroll to zoom. Double click a net label to rename its net. Click a free pin or press W over a pin to draw a wire."
      />
      {hint && (
        <div className="canvas-top">
          <div className="canvas-hint">{hint}</div>
        </div>
      )}
      <NameInput palette={palette} camera={camera} size={size} />
      <CanvasStatus cursor={cursor} zoom={(camera ?? EMPTY_SHEET_CAMERA).scale} detail={wire.under.end?.label} gesture={gesture} rotateHeld={rotateHeld} snap={snap} />
      {empty && <p className="empty">This schematic has no parts yet.</p>}
    </div>
  )
}

/** Answers the context menu's Rename: finds the label in the design as it is now, then opens the name input. */
function useLabelRenameAction(design: Design, palette: Palette, actions: Actions): void {
  useTargetActions((action) => {
    const label = design.schematic.labels.find((candidate) => candidate.id === action.labelId)
    if (label) palette.rename(label)
    else actions.notify("That label is gone; right click it again.")
  })
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

/** The wires a move takes along (dragged, or sent and waiting for its build), the wire being reshaped, then those reshaped and waiting. */
function useWireShapes(gesture: Gesture | undefined, pending: readonly WireLine[], moved: readonly WireLine[] | undefined): readonly WireLine[] {
  return useMemo(() => {
    const shaped = liveShapes(gesture?.kind === "reshape" ? gesture : undefined, pending)
    return moved && moved.length > 0 ? [...moved, ...shaped] : shaped
  }, [gesture, pending, moved])
}

/** The last arrow move, drawn from the sheet as it is now until a build that started after it lands (move-preview.ts). */
function useKeyMoving(keyMove: KeyMove | undefined, builtFrom: number, anchors: ReadonlyMap<string, Anchor>): Moving | undefined {
  return useMemo(() => (keyMove && keyMove.sentAt > builtFrom ? previewMoving(keyMove, anchors) : undefined), [keyMove, builtFrom, anchors])
}

/** The label being dragged, then those a selection's move takes on their own, then those moved and waiting for their build. */
function useMovingLabels(design: Design, gesture: Gesture | undefined, pending: MovingLabel[], moved: readonly MovingLabel[] | undefined): MovingLabel[] {
  const dragged = useMemo(() => (gesture?.kind === "label" && gesture.moved && !gesture.blocker ? { id: gesture.label.id, at: gesture.at } : undefined), [gesture])
  const draggedLabel = useDraggedLabel(design, dragged)
  return useMemo(() => {
    const first = [...(draggedLabel ? [draggedLabel] : []), ...(moved ?? [])]
    return first.length === 0 ? pending : [...first, ...pending.filter((m) => !first.some((f) => f.id === m.id))]
  }, [draggedLabel, pending, moved])
}

interface SheetKeysInput {
  design: Design
  /** When the build behind the shown design started (ms): an arrow move sent before it is drawn by the design itself. */
  builtFrom: number
  camera: Camera | undefined
  cursor: Point | undefined
  fit(): void
  wire: WireTool
  palette: Palette
  highlightNets: Highlight
  onHighlight(nets: Highlight): void
  keys: Omit<Parameters<typeof usePartKeys>[0], "paused" | "fit" | "netUnderPointer" | "netsOf" | "onHighlight">
}

/** The part keys with H over the sheet, and the hand-over between wiring and the Place tools; returns what to draw lit and the last arrow move. */
function useSheetKeys({ design, builtFrom, camera, cursor, fit, wire, palette, highlightNets, onHighlight, keys }: SheetKeysInput): { highlight: SheetScene["highlight"]; rotateHeld: boolean; keyMoving: Moving | undefined } {
  const cursorRef = useRef<Point | undefined>(undefined)
  cursorRef.current = cursor
  const netUnderPointer = useCallback(
    () => (camera && cursorRef.current ? schematicNetAt(design, cursorRef.current, HIGHLIGHT_REACH_PX / camera.scale) : undefined),
    [design, camera],
  )
  const netsOf = useCallback((part: string) => partNets(design, part), [design])
  const { rotateHeld, keyMove } = usePartKeys({ ...keys, paused: wire.drawing !== null, fit, netUnderPointer, netsOf, onHighlight })
  const { wiring, drawing } = wire
  const { disarm } = palette
  // Wiring takes over from a Place tool, as arming a Place tool stops wiring.
  useEffect(() => {
    if (wiring || drawing) disarm()
  }, [wiring, drawing, disarm])
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
  return { highlight: useHighlight(design, highlightNets), rotateHeld, keyMoving: useKeyMoving(keyMove, builtFrom, keys.layout.anchors) }
}

/** Tells the toolbar which tool is armed (wiring, a Place tool or Fit area), and how to put it away. */
function useArmedTool(wire: WireTool, palette: Palette, note: NoteTool): void {
  const { wiring, cancel } = wire
  const { tool, disarm } = palette
  const { which, disarm: putNoteAway } = note
  const active = armedCommand(wiring, tool) ?? boxToolCommand(which)
  useEffect(() => {
    setToolState({
      active,
      stop: () => {
        disarm()
        cancel()
        putNoteAway()
      },
    })
  }, [active, disarm, cancel, putNoteAway])
  useEffect(() => clearToolState, [])
}

/** Place → Note box, which the wire tool and the Place tools step aside for, and which steps aside for them. */
function useSheetNoteTool(wire: WireTool, palette: Palette): NoteTool {
  const { cancel, wiring, drawing } = wire
  const { disarm, armed } = palette
  const onArm = useCallback(() => {
    disarm()
    cancel()
  }, [disarm, cancel])
  const note = useNoteTool(onArm)
  const putAway = note.disarm
  useEffect(() => {
    if (wiring || drawing || armed) putAway()
  }, [wiring, drawing, armed, putAway])
  return note
}

/** What the gestures see armed: the note tool, or a Place tool, with which an empty left drag pans as before (R26). */
function useArmedForGestures(note: NoteTool, palette: Palette): GestureInput["tool"] {
  const { disarm: putNoteAway } = note
  const { disarm: putPlaceAway } = palette
  const disarm = useCallback(() => {
    putNoteAway()
    putPlaceAway()
  }, [putNoteAway, putPlaceAway])
  return { armed: note.tool ?? (palette.armed ? "place" : null), disarm }
}

interface SheetPointerInput extends Omit<PointerInput, "tool" | "open" | "gestures"> {
  /** The gestures, and which wire was selected before a double click's first press. */
  gestures: PointerInput["gestures"] & { wireBeforeDoubleClick(): string | undefined }
  boxes: PartBox[]
  labels: LabelTools
  wires: GestureWires
  drawings: GestureDrawings
  /** The selected wire's corner handles. */
  corners: SheetCorners
  wire: WireTool
  palette: Palette
  note: NoteTool
  /** What a double click picks with: the selection and the armed tool. */
  picking: PickContext
  onOpenProperties(target: PropertiesTarget): void
}

/**
 * The sheet's pointer: the wire tool and the Place tools see a press first, unless the note tool is armed. A double
 * click does what doubleClickAction says: removes a corner of a wire selected before it began, else opens Properties
 * on a part or a wire, or renames the net of a label, while no tool is armed.
 */
function sheetPointer({ boxes, labels, wires, drawings, corners, wire, palette, note, picking, onOpenProperties, ...input }: SheetPointerInput) {
  const tool = (event: Press, world: Point) => !note.armed && (palette.press(event, world) || wire.press(event, world))
  const open = (world: Point) => {
    const busy = note.armed || palette.armed || wire.wiring || wire.drawing !== null
    const target = targetAt(boxes, labels, world, picking, wires, drawings)
    const action = doubleClickAction({ busy, handle: corners.at(world, picking), target, selectedBefore: input.gestures.wireBeforeDoubleClick() })
    if (action.kind === "removeCorner") corners.drop(action.id, action.index)
    if (action.kind === "properties") onOpenProperties(action.target)
    if (action.kind === "rename") palette.rename(action.label)
  }
  return pointerHandlers({ ...input, tool, open })
}

/**
 * The schematic, drawn by copperflow's own renderer under its camera, grid and tools, with the
 * wire tool (see useWireTool), the Place tools (see useLabelPalette) and the note tool (see useNoteTool).
 */
export function SchematicCanvas(props: CanvasProps) {
  const { design, buildId, builtMark, buildStatus, project, builtFrom, circuit, actions, selection, onSelect, highlight: highlightNets, onHighlight, gridStyle, gridStep: step, snap, onGridStep: setStep, markers, activeViolation, focus, onFocused } = props
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
  useFitSelection({ selection, boxes: parts.boxes, size, setCamera, notify: actions.notify })
  const wire = useWireTool({ design, actions, camera, cursor, step, snap, buildId, builtFrom })
  const palette = useLabelPalette({ design, circuit, actions, camera, cursor, builtFrom, onArm: wire.cancel })
  const note = useSheetNoteTool(wire, palette)
  // Parts moved here take the hand-drawn wires at their pins along (wire-follow.ts), in the move's own edit.
  const follow = useMemo(() => ({ design, locked: parts.locked }), [design, parts.locked])
  const common = { view: "schematic", circuit, actions, onSelect, blockerFor: parts.blockerFor, follow } as const
  const labels = useLabelDrag({ design, circuit, actions, builtFrom })
  const wires = useSheetWires({ design, circuit, actions, locked: parts.locked, camera, selection, onSelect, builtFrom, wiring: wire.wiring || wire.drawing !== null })
  const drawings = useSheetDrawings({ design, circuit, camera, locked: parts.locked })
  const tool = useArmedForGestures(note, palette)
  useArmedTool(wire, palette, note)
  const gestures = useCanvasGestures({ ...common, camera, setCamera, size, boxes: parts.boxes, anchors: parts.anchors, step, snap, builtFrom, labels: labels.tools, wires: wires.hits, drawings: drawings.hits, selection, tool, filter: props.pickFilter, onContextMenu: props.onContextMenu })
  useLabelRenameAction(design, palette, actions)
  const layout = useLayout(parts, step, snap)
  const menuPlace = useKeyMenuPlace(wrapRef, selection.primary, parts.boxes, camera, size, wires.menuWire)
  const keys = { ...common, selection, layout, builtMark, buildStatus, moveWaiting: gestures.pending !== undefined, menuPlace, onContextMenu: props.onContextMenu, wire: wires.keys, drawings: drawings.removal }
  const { highlight, rotateHeld, keyMoving } = useSheetKeys({ design, builtFrom, camera, cursor, fit, wire, palette, highlightNets, onHighlight, keys })
  const hover = useSheetHover({ boxes: parts.boxes, wire, labels: labels.tools, filter: props.pickFilter, wires: wires.hits, drawings: drawings.hits, setCursor })
  const { gesture } = gestures
  const moving = gestures.moving ?? keyMoving
  const movingLabels = useMovingLabels(design, gesture, labels.pending, moving?.labels)
  const hoverWire = useMemo(() => wires.lineOf(hover.wire), [wires.lineOf, hover.wire])
  const wireShapes = useWireShapes(gesture, wires.pending, moving?.wires)
  useSheetPaint(canvasRef, { design, border, camera, size, wire, moving, boxes: parts.boxes, hover: hover.part, selection, locked: parts.locked, circuit, gesture, movingLabels, hoverLabel: hover.label, hoverDrawing: drawings.drawingOf(hover.drawing), hoverWire, selectedWire: wires.selected, wireShapes, palette, highlight, markers, activeViolation, grid })
  const picking = { selection, armed: tool.armed, filter: props.pickFilter }
  const pointer = sheetPointer({ camera, size, element: wrapRef, gestures, setCursor, hover: hover.at, boxes: parts.boxes, labels: labels.tools, wires: wires.hits, drawings: drawings.hits, corners: wires.corners, wire, palette, note, picking, onOpenProperties: props.onOpenProperties })
  const cursorStyle = cursorFor(gesture, wire.drawing !== null || wire.overPin || palette.armed || note.armed, hover.over)
  // The toolbar's controls sit beside the sheet: inside it, their portal's events would reach the sheet's handlers.
  return (
    <>
      <SheetTools step={step} setStep={setStep} keep={{ show: parts.autoPlaced, onKeep: () => keepAutoPlaced(design, "schematic", parts.blockerFor, actions) }} />
      <SheetView {...{ wrapRef, canvasRef, size, camera, cursor, pointer, onLeave: hover.leave, cursorStyle, wire, palette, note, gesture, rotateHeld, snap }} empty={parts.boxes.length === 0} />
    </>
  )
}
