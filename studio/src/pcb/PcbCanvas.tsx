import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { CircuitData, Design } from "../api"
import { Selection } from "../selection"
import type { WorldPad } from "../../../src/engine/pcb.js"
import { keepAutoPlaced } from "./auto-placed"
import { drawEditorLayer, prepareCanvas, useCamera, useCameraFocus, useElementSize, useKeyMenuPlace, useLayout, usePlacedParts, type CanvasProps, type Moving } from "./canvas-common"
import { ViewTools } from "../shell/ViewTools"
import { CanvasStatus, GridSelect, KeepButton } from "./CanvasTools"
import { PALETTE } from "./ctx"
import { canPick, type PickContext } from "./pick"
import type { PickFilter } from "./pick-filter"
import { pickLayersOf, type LayerVisibility, type PickLayers } from "./layers"
import { gridStepOptions, type GridLook } from "./grid"
import { pointBounds, unionBoxes, type Camera, type PartBox, type Point, type Size } from "./geometry"
import { NO_HIGHLIGHT, partNets, pcbNetAt, type Highlight } from "./highlight"
import type { ViolationMarker } from "./markers"
import { drawGrid, PCB_LOOK } from "./overlays"
import { drawPcb, padAt } from "./pcb-draw"
import type { Unit } from "./units"
import { targetAt } from "./gestures"
import { cursorFor, pointerHandlers, useCanvasGestures, type Gesture } from "./use-canvas-gestures"
import { useFitSelection } from "./use-fit-selection"
import { useBoxToolState, useNoteTool } from "./use-note-tool"
import { usePartKeys, type PartKeysInput } from "./use-part-keys"
import type { CopperScene } from "./copper-draw"
import { copperCursor, copperPress, hoverCopper, useCopper, withCopperDrag } from "./use-copper"

const BACKGROUND = PALETTE.background

/** "U1.VIN on GND" for the pad under the pointer: the pin's own name when it has one, and its named net. */
function padLabel(design: Design, pad: WorldPad): string {
  const pin = design.circuit.components.find((c) => c.id === pad.component)?.pins.find((p) => p.id === pad.pin)
  const name = pin?.names.find((n) => !/^pin\d+$/.test(n)) ?? pin?.names[0]
  const net = design.circuit.nets.find((n) => n.id === pad.net)?.names[0]
  return `${name ? `${pad.component}.${name}` : pad.id}${net ? ` on ${net}` : ""}`
}

interface PcbScene {
  design: Design
  camera: Camera | undefined
  size: Size
  layers: LayerVisibility
  hoverPad: WorldPad | undefined
  moving: Moving | undefined
  boxes: PartBox[]
  hover: string | undefined
  selection: Selection
  locked: ReadonlySet<string>
  circuit: CircuitData
  gesture: Gesture | undefined
  /** The nets highlighted by the Net tab, the H key or the menu; the net of the pad under the pointer shows when there are none. */
  highlightNets: Highlight
  markers: readonly ViolationMarker[]
  activeViolation: string | null
  /** The grid's step and style. */
  grid: GridLook
  /** The layout file's tracks and vias as shown, with their selection and hover. */
  copper: CopperScene
}

/** Draws the board and its violation rings, then the editor layer, whenever anything visible changes. */
function usePcbPaint(canvasRef: RefObject<HTMLCanvasElement | null>, scene: PcbScene): void {
  const { design, camera, size, layers, hoverPad, moving, boxes, hover, selection, locked, circuit, gesture, highlightNets, markers, activeViolation, grid, copper } = scene
  const litNets = useMemo(() => (highlightNets.length > 0 ? highlightNets : hoverPad?.net ? [hoverPad.net] : NO_HIGHLIGHT), [highlightNets, hoverPad])
  useEffect(() => {
    if (!camera) return
    const prepared = prepareCanvas(canvasRef.current, size, camera, BACKGROUND, (c, cam, s, r) => drawGrid(c, cam, s, grid, r))
    if (!prepared) return
    const { ctx, ratio } = prepared
    drawPcb(ctx, design.pcb, { camera, size }, {
      ratio,
      layers,
      ...(litNets.length > 0 ? { highlight: { nets: litNets } } : {}),
      ...(moving ? { moving: { components: moving.names, by: moving.offset } } : {}),
      violations: markers,
      ...(activeViolation ? { activeViolation } : {}),
      copper,
    })
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawEditorLayer(ctx, camera, size, { view: "pcb", boxes, moving, hover, selection, locked, marks: circuit.annotations.marks, gesture, look: PCB_LOOK, ratio })
  }, [canvasRef, design, camera, size, layers, litNets, moving, boxes, hover, selection, locked, circuit, gesture, markers, activeViolation, grid, copper])
}

interface PcbToolsProps {
  unit: Unit
  step: number
  setStep(step: number): void
  keep: { show: boolean; onKeep(): void }
}

/** Grid and "Keep these positions", in the toolbar's right side; the layers are in the Layer panel. */
function PcbTools({ unit, step, setStep, keep }: PcbToolsProps) {
  return (
    <ViewTools>
      <GridSelect step={step} options={gridStepOptions("pcb", unit)} onChange={setStep} />
      <KeepButton {...keep} title="Write the faded parts' positions into the code as pcbX and pcbY" />
    </ViewTools>
  )
}

/** The part and the pad under the pointer. */
function usePcbHover(design: Design, boxes: PartBox[], pick: PickLayers, filter: PickFilter) {
  const [part, setPart] = useState<string>()
  const [pad, setPad] = useState<WorldPad>()
  // Parts and pads on hidden layers, or of a kind the Filter tab switched off, are not there to hover, as they are not there to pick.
  const at = (world: Point) => {
    const context: PickContext = { selection: Selection.none, armed: null, layers: pick, filter }
    const target = targetAt(boxes, undefined, world, context)
    setPart(target.kind === "part" ? target.name : undefined)
    setPad(padAt(design.pcb, world, pick.visible, (name) => canPick({ kind: "part", name }, context)))
  }
  const leave = () => {
    setPart(undefined)
    setPad(undefined)
  }
  return { part, pad, at, leave }
}

type PcbKeysInput = Omit<PartKeysInput, "paused" | "netUnderPointer" | "netsOf">

/** The part keys, with H lighting the net under the pointer. */
function usePcbKeys(design: Design, cursor: Point | undefined, visible: LayerVisibility, keys: PcbKeysInput): { rotateHeld: boolean } {
  const cursorRef = useRef<Point | undefined>(undefined)
  cursorRef.current = cursor
  const netUnderPointer = useCallback(() => (cursorRef.current ? pcbNetAt(design.pcb, cursorRef.current, visible) : undefined), [design, visible])
  const netsOf = useCallback((part: string) => partNets(design, part), [design])
  return usePartKeys({ ...keys, paused: false, netUnderPointer, netsOf })
}

interface PcbSurfaceProps {
  canvasRef: RefObject<HTMLCanvasElement | null>
  size: Size
  cursorStyle: string
  pointer: ReturnType<typeof pointerHandlers>
  /** The pointer left the board. */
  onLeave(): void
  /** The armed tool's hint, over the board's top left corner. */
  hint: string | undefined
}

/** The canvas element the board is painted on, with its pointer handlers; the browser's own menu never shows. */
function PcbSurface({ canvasRef, size, cursorStyle, pointer, onLeave, hint }: PcbSurfaceProps) {
  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height: size.height, cursor: cursorStyle }}
        {...pointer}
        onPointerLeave={onLeave}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="PCB layout. Drag parts to move them, drag the background to select, drag with the right button to pan, scroll to zoom."
        role="img"
      />
      {hint && (
        <div className="canvas-top">
          <div className="canvas-hint">{hint}</div>
        </div>
      )}
    </>
  )
}

/** The board outline's bounds, or the parts' when there is no outline. */
function useBoardBounds(design: Design, boxes: PartBox[]) {
  return useMemo(() => pointBounds(design.pcb.board?.outline ?? []) ?? unionBoxes(boxes.map((b) => b.box)), [design, boxes])
}

/** The PCB, drawn by copperflow's own renderer under its camera, grid and tools. */
export function PcbCanvas(props: CanvasProps) {
  const { design, builtFrom, builtMark, buildStatus, circuit, actions, selection, onSelect, highlight, onHighlight, unit, onToggleUnit, gridStyle, gridStep: step, snap, onGridStep: setStep, markers, activeViolation, focus, onFocused, layers, pickFilter } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(wrapRef)
  const [cursor, setCursor] = useState<Point>()
  const grid = useMemo<GridLook>(() => ({ step, style: gridStyle }), [step, gridStyle])
  const pick = useMemo(() => pickLayersOf(design.pcb.parts, layers), [design, layers])
  const parts = usePlacedParts(design, "pcb", circuit)
  const bounds = useBoardBounds(design, parts.boxes)
  const { camera, setCamera, fit } = useCamera(wrapRef, size, bounds)
  useCameraFocus("pcb", focus, camera, setCamera, onFocused)
  useFitSelection({ selection, boxes: parts.boxes, size, setCamera, notify: actions.notify })
  const common = { view: "pcb", circuit, actions, onSelect, blockerFor: parts.blockerFor } as const
  const note = useNoteTool()
  useBoxToolState(note.which, note.disarm)
  const tool = { armed: note.tool, disarm: note.disarm }
  const gestures = useCanvasGestures({ ...common, camera, setCamera, size, boxes: parts.boxes, anchors: parts.anchors, step, snap, builtFrom, selection, tool, layers: pick, filter: pickFilter, onContextMenu: props.onContextMenu })
  const copper = useCopper({ design, builtFrom, camera, size, canvas: canvasRef, layers, filter: pickFilter, armed: note.tool, selection, onSelect, actions, step, snap })
  const layout = useLayout(parts, step, snap)
  const menuPlace = useKeyMenuPlace(canvasRef, selection.primary, parts.boxes, camera, size)
  const { rotateHeld } = usePcbKeys(design, cursor, layers, { ...common, selection, layout, builtMark, buildStatus, moveWaiting: gestures.pending !== undefined, fit, onHighlight, menuPlace, onContextMenu: props.onContextMenu, copper: copper.keys })
  const hover = usePcbHover(design, parts.boxes, pick, pickFilter)
  const { moving, gesture } = gestures
  usePcbPaint(canvasRef, { design, camera, size, layers, hoverPad: hover.pad, moving, boxes: parts.boxes, hover: hover.part, selection, locked: parts.locked, circuit, gesture, highlightNets: highlight, markers, activeViolation, grid, copper: copper.scene })
  // Copper is above the pads and parts: what is under the pointer there is the track or via.
  const open = (world: Point) => {
    if (hoverCopper(copper, world)) return
    const target = targetAt(parts.boxes, undefined, world, { selection, armed: note.tool, layers: pick, filter: pickFilter })
    if (target.kind === "part") props.onOpenProperties(target)
  }
  const hoverAt = (world: Point) => (hoverCopper(copper, world) ? hover.leave() : hover.at(world))
  const pointer = withCopperDrag(copper, pointerHandlers({ camera, size, element: canvasRef, gestures, setCursor, hover: hoverAt, open, tool: copperPress(copper) }), setCursor)
  const onLeave = () => {
    hover.leave()
    copper.setHover(undefined)
    setCursor(undefined)
  }
  const cursorStyle = copperCursor(copper) ?? cursorFor(gesture, note.armed, hover.part !== undefined)
  return (
    <div className="pcb-canvas" ref={wrapRef}>
      <PcbSurface canvasRef={canvasRef} size={size} cursorStyle={cursorStyle} pointer={pointer} onLeave={onLeave} hint={note.hint} />
      <PcbTools unit={unit} step={step} setStep={setStep} keep={{ show: parts.autoPlaced, onKeep: () => keepAutoPlaced(design, "pcb", parts.blockerFor, actions, circuit) }} />
      <CanvasStatus cursor={cursor} zoom={camera?.scale} unit={unit} onToggleUnit={onToggleUnit} detail={hover.pad && padLabel(design, hover.pad)} gesture={gesture} rotateHeld={rotateHeld} snap={snap} />
    </div>
  )
}
