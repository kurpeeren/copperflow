import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { CircuitData, Design } from "../api"
import type { Selection } from "../selection"
import type { WorldPad } from "../../../src/engine/pcb.js"
import { keepAutoPlaced } from "./auto-placed"
import { drawEditorLayer, prepareCanvas, useCamera, useCameraFocus, useElementSize, usePlacedParts, type CanvasProps, type Moving } from "./canvas-common"
import { ViewTools } from "../shell/ViewTools"
import { CanvasStatus, GridSelect, KeepButton } from "./CanvasTools"
import { PALETTE, type Layers } from "./ctx"
import { gridStepOptions, type GridLook } from "./grid"
import { hitTest, pointBounds, unionBoxes, type Camera, type PartBox, type Point, type Size } from "./geometry"
import { NO_HIGHLIGHT, partNets, pcbNetAt, type Highlight } from "./highlight"
import type { ViolationMarker } from "./markers"
import { drawGrid, PCB_LOOK } from "./overlays"
import { drawPcb, padAt } from "./pcb-draw"
import type { Unit } from "./units"
import { cursorFor, pointerHandlers, useCanvasGestures, type Gesture } from "./use-canvas-gestures"
import { useNoteTool } from "./use-note-tool"
import { usePartKeys, type PartKeysInput } from "./use-part-keys"

const LAYER_BUTTONS = [
  ["topCopper", "Top"],
  ["bottomCopper", "Bottom"],
  ["silkscreen", "Silk"],
  ["courtyard", "Courtyard"],
] as const
const DEFAULT_LAYERS: Layers = { topCopper: true, bottomCopper: true, silkscreen: true, courtyard: true, fabrication: false }
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
  layers: Layers
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
}

/** Draws the board and its violation rings, then the editor layer, whenever anything visible changes. */
function usePcbPaint(canvasRef: RefObject<HTMLCanvasElement | null>, scene: PcbScene): void {
  const { design, camera, size, layers, hoverPad, moving, boxes, hover, selection, locked, circuit, gesture, highlightNets, markers, activeViolation, grid } = scene
  const litNets = useMemo(() => (highlightNets.length > 0 ? highlightNets : hoverPad?.net ? [hoverPad.net] : NO_HIGHLIGHT), [highlightNets, hoverPad])
  useEffect(() => {
    if (!camera) return
    const prepared = prepareCanvas(canvasRef.current, size, camera, BACKGROUND, (c, cam, s) => drawGrid(c, cam, s, grid))
    if (!prepared) return
    const { ctx, ratio } = prepared
    drawPcb(ctx, design.pcb, { camera, size }, {
      ratio,
      layers,
      ...(litNets.length > 0 ? { highlight: { nets: litNets } } : {}),
      ...(moving ? { moving: { components: moving.names, by: moving.offset } } : {}),
      violations: markers,
      ...(activeViolation ? { activeViolation } : {}),
    })
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawEditorLayer(ctx, camera, size, { view: "pcb", boxes, moving, hover, selection, locked, marks: circuit.annotations.marks, gesture, look: PCB_LOOK })
  }, [canvasRef, design, camera, size, layers, litNets, moving, boxes, hover, selection, locked, circuit, gesture, markers, activeViolation, grid])
}

interface PcbToolsProps {
  unit: Unit
  step: number
  setStep(step: number): void
  layers: Layers
  setLayers(layers: Layers): void
  keep: { show: boolean; onKeep(): void }
}

/** Grid, the layer switches and "Keep these positions", in the toolbar's right side. */
function PcbTools({ unit, step, setStep, layers, setLayers, keep }: PcbToolsProps) {
  return (
    <ViewTools>
      <GridSelect step={step} options={gridStepOptions("pcb", unit)} onChange={setStep} />
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
      <KeepButton {...keep} title="Write the faded parts' positions into the code as pcbX and pcbY" />
    </ViewTools>
  )
}

/** The part and the pad under the pointer. */
function usePcbHover(design: Design, boxes: PartBox[]) {
  const [part, setPart] = useState<string>()
  const [pad, setPad] = useState<WorldPad>()
  const at = (world: Point) => {
    setPart(hitTest(boxes, world)?.name)
    setPad(padAt(design.pcb, world))
  }
  const leave = () => {
    setPart(undefined)
    setPad(undefined)
  }
  return { part, pad, at, leave }
}

type PcbKeysInput = Omit<PartKeysInput, "paused" | "netUnderPointer" | "netsOf">

/** The part keys, with H lighting the net under the pointer. */
function usePcbKeys(design: Design, cursor: Point | undefined, keys: PcbKeysInput): void {
  const cursorRef = useRef<Point | undefined>(undefined)
  cursorRef.current = cursor
  const netUnderPointer = useCallback(() => (cursorRef.current ? pcbNetAt(design.pcb, cursorRef.current) : undefined), [design])
  const netsOf = useCallback((part: string) => partNets(design, part), [design])
  usePartKeys({ ...keys, paused: false, netUnderPointer, netsOf })
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
  const { design, builtFrom, circuit, actions, selection, onSelect, highlight, onHighlight, unit, onToggleUnit, gridStyle, gridStep: step, onGridStep: setStep, markers, activeViolation, focus, onFocused } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(wrapRef)
  const [cursor, setCursor] = useState<Point>()
  const grid = useMemo<GridLook>(() => ({ step, style: gridStyle }), [step, gridStyle])
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS)
  const parts = usePlacedParts(design, "pcb", circuit)
  const bounds = useBoardBounds(design, parts.boxes)
  const { camera, setCamera, fit } = useCamera(wrapRef, size, bounds)
  useCameraFocus("pcb", focus, camera, setCamera, onFocused)
  const common = { view: "pcb", circuit, actions, onSelect, blockerFor: parts.blockerFor } as const
  const note = useNoteTool()
  const tool = { armed: note.tool, disarm: note.disarm }
  const gestures = useCanvasGestures({ ...common, camera, setCamera, size, boxes: parts.boxes, anchors: parts.anchors, step, builtFrom, selection, tool, onContextMenu: props.onContextMenu })
  usePcbKeys(design, cursor, { ...common, selection, layout: { anchors: parts.anchors, boxes: parts.boxes, step }, builtFrom, moveWaiting: gestures.pending !== undefined, fit, onHighlight })
  const hover = usePcbHover(design, parts.boxes)
  const { moving, gesture } = gestures
  usePcbPaint(canvasRef, { design, camera, size, layers, hoverPad: hover.pad, moving, boxes: parts.boxes, hover: hover.part, selection, locked: parts.locked, circuit, gesture, highlightNets: highlight, markers, activeViolation, grid })
  const open = (world: Point) => {
    const hit = note.armed ? undefined : hitTest(parts.boxes, world)
    if (hit) props.onOpenProperties(hit.name)
  }
  const pointer = pointerHandlers({ camera, size, element: canvasRef, gestures, setCursor, hover: hover.at, open })
  const onLeave = () => {
    hover.leave()
    setCursor(undefined)
  }
  return (
    <div className="pcb-canvas" ref={wrapRef}>
      <PcbSurface canvasRef={canvasRef} size={size} cursorStyle={cursorFor(gesture, note.armed, hover.part !== undefined)} pointer={pointer} onLeave={onLeave} hint={note.hint} />
      <PcbTools unit={unit} step={step} setStep={setStep} layers={layers} setLayers={setLayers} keep={{ show: parts.autoPlaced, onKeep: () => keepAutoPlaced(design, "pcb", parts.blockerFor, actions) }} />
      <CanvasStatus cursor={cursor} zoom={camera?.scale} unit={unit} onToggleUnit={onToggleUnit} detail={hover.pad && padLabel(design, hover.pad)} gesture={gesture} />
    </div>
  )
}
