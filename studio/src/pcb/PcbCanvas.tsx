import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { CircuitData, Design } from "../api"
import type { WorldPad } from "../../../src/engine/pcb.js"
import { keepAutoPlaced } from "./auto-placed"
import { drawEditorLayer, prepareCanvas, useCamera, useCameraFocus, useElementSize, usePlacedParts, type CanvasProps, type Moving } from "./canvas-common"
import { blurButton, CanvasStatus, KeepButton, SnapSelect } from "./CanvasTools"
import type { Layers } from "./ctx"
import { hitTest, pointBounds, unionBoxes, type Camera, type PartBox, type Point, type Size } from "./geometry"
import { pcbNetAt } from "./highlight"
import type { ViolationMarker } from "./markers"
import { drawPcb, padAt } from "./pcb-draw"
import type { Unit } from "./units"
import { cursorFor, pointerHandlers, useCanvasGestures, type Gesture } from "./use-canvas-gestures"
import { usePartKeys } from "./use-part-keys"

const LAYER_BUTTONS = [
  ["topCopper", "Top"],
  ["bottomCopper", "Bottom"],
  ["silkscreen", "Silk"],
  ["courtyard", "Courtyard"],
] as const
const DEFAULT_LAYERS: Layers = { topCopper: true, bottomCopper: true, silkscreen: true, courtyard: true, fabrication: false }
const BACKGROUND = "#121417"

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
  selected: string | null
  locked: ReadonlySet<string>
  circuit: CircuitData
  gesture: Gesture | undefined
  /** The net highlighted by the Nets tab or the H key; the net of the pad under the pointer shows when there is none. */
  highlightNet: string | null
  markers: readonly ViolationMarker[]
  activeViolation: string | null
}

/** Draws the board and its violation rings, then the editor layer, whenever anything visible changes. */
function usePcbPaint(canvasRef: RefObject<HTMLCanvasElement | null>, scene: PcbScene): void {
  const { design, camera, size, layers, hoverPad, moving, boxes, hover, selected, locked, circuit, gesture, highlightNet, markers, activeViolation } = scene
  const litNet = highlightNet ?? hoverPad?.net ?? null
  useEffect(() => {
    if (!camera) return
    const prepared = prepareCanvas(canvasRef.current, size, camera, BACKGROUND)
    if (!prepared) return
    const { ctx, ratio } = prepared
    drawPcb(ctx, design.pcb, { camera, size }, {
      ratio,
      layers,
      ...(litNet ? { highlight: { net: litNet } } : {}),
      ...(moving ? { moving: { component: moving.name, by: moving.offset } } : {}),
      violations: markers,
      ...(activeViolation ? { activeViolation } : {}),
    })
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    const noteBox = gesture?.kind === "box" ? gesture : undefined
    drawEditorLayer(ctx, camera, size, { view: "pcb", boxes, moving, hover, selected, locked, marks: circuit.annotations.marks, noteBox })
  }, [canvasRef, design, camera, size, layers, litNet, moving, boxes, hover, selected, locked, circuit, gesture, markers, activeViolation])
}

interface PcbToolsProps {
  unit: Unit
  step: number
  setStep(step: number): void
  fit(): void
  layers: Layers
  setLayers(layers: Layers): void
  keep: { show: boolean; onKeep(): void }
}

/** Snap, fit, the layer switches and "Keep these positions". */
function PcbTools({ unit, step, setStep, fit, layers, setLayers, keep }: PcbToolsProps) {
  return (
    <div className="canvas-tools" onClick={blurButton}>
      <SnapSelect step={step} onChange={setStep} unit={unit} />
      <button onClick={fit} title="Fit the board (F or K)">
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
      <KeepButton {...keep} title="Write the faded parts' positions into the code as pcbX and pcbY" />
    </div>
  )
}

/** The PCB, drawn by copperflow's own renderer under its camera, grid and tools. */
export function PcbCanvas({ design, builtFrom, circuit, actions, selected, onSelect, highlight, onHighlight, unit, onToggleUnit, markers, activeViolation, focus, onFocused }: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(wrapRef)
  const [hover, setHover] = useState<string>()
  const [cursor, setCursor] = useState<Point>()
  const [step, setStep] = useState(0.5)
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS)
  const [hoverPad, setHoverPad] = useState<WorldPad>()
  const parts = usePlacedParts(design, "pcb", circuit)
  const bounds = useMemo(() => pointBounds(design.pcb.board?.outline ?? []) ?? unionBoxes(parts.boxes.map((b) => b.box)), [design, parts.boxes])
  const { camera, setCamera, fit } = useCamera(wrapRef, size, bounds)
  useCameraFocus("pcb", focus, camera, setCamera, onFocused)
  const common = { view: "pcb", circuit, actions, onSelect, blockerFor: parts.blockerFor } as const
  const gestures = useCanvasGestures({ ...common, camera, setCamera, size, boxes: parts.boxes, anchors: parts.anchors, step, builtFrom })
  const cursorRef = useRef<Point | undefined>(undefined)
  cursorRef.current = cursor
  const netUnderPointer = useCallback(() => (cursorRef.current ? pcbNetAt(design.pcb, cursorRef.current) : undefined), [design])
  usePartKeys({ ...common, selected, paused: false, fit, netUnderPointer, onHighlight })
  const { moving, gesture } = gestures
  usePcbPaint(canvasRef, { design, camera, size, layers, hoverPad, moving, boxes: parts.boxes, hover, selected, locked: parts.locked, circuit, gesture, highlightNet: highlight, markers, activeViolation })
  const hoverAt = (world: Point) => {
    setHover(hitTest(parts.boxes, world)?.name)
    setHoverPad(padAt(design.pcb, world))
  }
  const pointer = pointerHandlers({ camera, size, element: canvasRef, gestures, setCursor, hover: hoverAt })

  return (
    <div className="pcb-canvas" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height: size.height, cursor: cursorFor(gesture, false, hover !== undefined) }}
        {...pointer}
        onPointerLeave={() => {
          setHover(undefined)
          setHoverPad(undefined)
          setCursor(undefined)
        }}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="PCB layout. Drag parts to move them, drag the background to pan, scroll to zoom."
        role="img"
      />
      <PcbTools unit={unit} step={step} setStep={setStep} fit={fit} layers={layers} setLayers={setLayers} keep={{ show: parts.autoPlaced, onKeep: () => keepAutoPlaced(design, "pcb", parts.blockerFor, actions) }} />
      <CanvasStatus cursor={cursor} zoom={camera?.scale} unit={unit} onToggleUnit={onToggleUnit} detail={hoverPad && padLabel(design, hoverPad)} gesture={gesture} />
    </div>
  )
}
