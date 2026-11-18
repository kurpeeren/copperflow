import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { CircuitData, Design } from "../api"
import { Selection } from "../selection"
import type { WorldPad } from "../../../src/engine/pcb.js"
import { keepAutoPlaced } from "./auto-placed"
import { notePointer } from "../shell/pointer-place"
import { drawEditorLayer, prepareCanvas, useCamera, useCameraFocus, useElementSize, useKeyMenuPlace, useLayout, usePlacedParts, type CanvasProps, type Moving } from "./canvas-common"
import { ViewTools } from "../shell/ViewTools"
import { CanvasHint, CanvasStatus, GridSelect, KeepButton } from "./CanvasTools"
import { PALETTE } from "./ctx"
import { canPick, type PickContext } from "./pick"
import type { PickFilter } from "./pick-filter"
import { pickLayersOf, type LayerVisibility, type PickLayers } from "./layers"
import { gridStepOptions, type GridLook } from "./grid"
import { pointBounds, unionBoxes, worldToScreen, type Camera, type PartBox, type Point, type Size } from "./geometry"
import { NO_HIGHLIGHT, partNets, pcbNetAt, type Highlight } from "./highlight"
import type { ViolationMarker } from "./markers"
import { drawGrid, drawTextOutlines, PCB_LOOK } from "./overlays"
import { boardWithTextMoves, type PartText, type TextMove } from "./part-text"
import { usePartTexts, useShownTexts } from "./use-part-texts"
import { drawPcb, padAt } from "./pcb-draw"
import type { Unit } from "./units"
import { targetAt, textTakesPress, type GestureTexts } from "./gestures"
import { cursorFor, pointerHandlers, useCanvasGestures, type Gesture, type Press } from "./use-canvas-gestures"
import { useFitSelection } from "./use-fit-selection"
import { useNoteTool } from "./use-note-tool"
import { boxToolCommand } from "./box-tool"
import { clearToolState, setToolState } from "../shell/tool-state"
import type { CommandId } from "../shell/menus"
import { selectedCopperLine } from "./key-menu"
import type { ActiveLayer } from "./layers"
import { padName } from "./track-targets"
import { useTrackArm, useTrackTool } from "./use-track-tool"
import { useTrackShape } from "./use-track-shape"
import { usePartKeys, type PartKeysInput } from "./use-part-keys"
import type { CopperScene } from "./copper-draw"
import { copperBoxes } from "./copper-hit"
import { copperCursor, copperIdAt, copperPress, copperSegmentAt, hoverCopper, useCopper, withCopperDrag, type CopperParts } from "./use-copper"
import { anchorLookup, moveEach, sendGroupEditMarked } from "./group-edits"
import { HoverLabel, useHoverLabel } from "./HoverLabel"
import { withHoverLabel, type HoverDriver } from "./hover-driver"
import { hoverTarget, stillOver, type HoverTarget, type PcbHoverScene } from "./hover-label"
import type { PourScene } from "./pour-draw"
import type { PourFillMode } from "./pour-view"
import { HoleDiameterField } from "./HoleDiameterField"
import { usePours, withPourDrag } from "./use-pours"
import { useSilkTexts, withSilkTextDrag } from "./use-silk-texts"
import type { SilkTextScene } from "./silk-text-draw"
import { pcbPress } from "./press-order"
import { usePartPlaceTool, type PartPlaceTool } from "./use-part-place-tool"
import { useBoardTextTool } from "./use-board-text-tool"
import { InlineTextField } from "./DrawText"
import { disarmPart } from "../shell/armed-part"

const BACKGROUND = PALETTE.background

/** "U1.VIN on GND" for the pad under the pointer: the pin's own name when it has one, and its named net. */
function padLabel(design: Design, pad: WorldPad): string {
  const net = design.circuit.nets.find((n) => n.id === pad.net)?.names[0]
  return `${padName(design, pad)}${net ? ` on ${net}` : ""}`
}

/** Tells the toolbar which PCB tool is armed (Single routing, Via or Fit area), and how to put them all away. */
function usePcbToolState(command: CommandId | null, disarmNote: () => void, disarmTrack: () => void): void {
  useEffect(() => {
    const stop = () => {
      disarmNote()
      disarmTrack()
    }
    setToolState({ active: command, stop })
  }, [command, disarmNote, disarmTrack])
  useEffect(() => clearToolState, [])
}

/** The PCB's own props: the active copper layer, which the Layer panel's select and V change. */
export interface PcbCanvasProps extends CanvasProps {
  activeLayer: ActiveLayer
  onActiveLayer(layer: ActiveLayer): void
  /** View → Pour fill. */
  pourFill: PourFillMode
  /** The pours hidden in the Layer panel, by id. */
  hiddenPours: ReadonlySet<string>
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
  /** The designators as drawn (moves in place), the moves, and the one under the pointer. */
  texts: { shown: readonly PartText[]; moves: readonly TextMove[]; hover: string | undefined }
  /** The copper pours and holes: the fill mode, the selected, hovered, hidden and dragged ones, the one being drawn. */
  pours: PourScene
  /** The board's silkscreen texts: the selected, hovered and dragged ones. */
  silkTexts: SilkTextScene
}

/** Draws the board and its violation rings, then the editor layer, whenever anything visible changes. */
function usePcbPaint(canvasRef: RefObject<HTMLCanvasElement | null>, scene: PcbScene): void {
  const { design, camera, size, layers, hoverPad, moving, boxes, hover, selection, locked, circuit, gesture, highlightNets, markers, activeViolation, grid, copper, texts, pours, silkTexts } = scene
  const board = useMemo(() => boardWithTextMoves(design.pcb, texts.moves), [design.pcb, texts.moves])
  const litNets = useMemo(() => (highlightNets.length > 0 ? highlightNets : hoverPad?.net ? [hoverPad.net] : NO_HIGHLIGHT), [highlightNets, hoverPad])
  useEffect(() => {
    if (!camera) return
    const prepared = prepareCanvas(canvasRef.current, size, camera, BACKGROUND, (c, cam, s, r) => drawGrid(c, cam, s, grid, r))
    if (!prepared) return
    const { ctx, ratio } = prepared
    drawPcb(ctx, board, { camera, size }, {
      ratio,
      layers,
      ...(litNets.length > 0 ? { highlight: { nets: litNets } } : {}),
      ...(moving ? { moving: { components: moving.names, by: moving.offset } } : {}),
      violations: markers,
      ...(activeViolation ? { activeViolation } : {}),
      copper,
      pours,
      silkTexts,
    })
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawEditorLayer(ctx, camera, size, { view: "pcb", boxes, moving, hover, selection, locked, marks: circuit.annotations.marks, gesture, look: PCB_LOOK, ratio })
    drawTextOutlines(ctx, { camera, size }, texts.shown, { selected: selection.texts, hover: gesture ? undefined : texts.hover }, PCB_LOOK, ratio)
  }, [canvasRef, board, camera, size, layers, litNets, moving, boxes, hover, selection, locked, circuit, gesture, markers, activeViolation, grid, copper, texts, pours, silkTexts])
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

/** The part, the designator and the pad under the pointer. */
function usePcbHover(design: Design, boxes: PartBox[], pick: PickLayers, filter: PickFilter, texts: GestureTexts) {
  const [part, setPart] = useState<string>()
  const [text, setText] = useState<string>()
  const [pad, setPad] = useState<WorldPad>()
  // Parts and pads on hidden layers, or of a kind the Filter tab switched off, are not there to hover, as they are not there to pick.
  const at = (world: Point) => {
    const context: PickContext = { selection: Selection.none, armed: null, layers: pick, filter }
    const target = targetAt(boxes, undefined, world, context, undefined, undefined, texts)
    setPart(target.kind === "part" ? target.name : undefined)
    setText(target.kind === "text" ? target.id : undefined)
    setPad(padAt(design.pcb, world, pick.visible, (name) => canPick({ kind: "part", name }, context)))
  }
  const leave = () => {
    setPart(undefined)
    setText(undefined)
    setPad(undefined)
  }
  return { part, text, pad, at, leave }
}

type PcbKeysInput = Omit<PartKeysInput, "netUnderPointer" | "netsOf">

/** The part keys, with H lighting the net under the pointer; R, Space and Delete wait while a track is drawn (paused). */
function usePcbKeys(design: Design, cursor: Point | undefined, visible: LayerVisibility, keys: PcbKeysInput): { rotateHeld: boolean } {
  const cursorRef = useRef<Point | undefined>(undefined)
  cursorRef.current = cursor
  const netUnderPointer = useCallback(() => (cursorRef.current ? pcbNetAt(design.pcb, cursorRef.current, visible) : undefined), [design, visible])
  const netsOf = useCallback((part: string) => partNets(design, part), [design])
  return usePartKeys({ ...keys, netUnderPointer, netsOf })
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
      <CanvasHint hint={hint} />
    </>
  )
}

interface CopperPartsInput {
  parts: ReturnType<typeof usePlacedParts>
  circuit: CircuitData
  actions: CanvasProps["actions"]
  selection: Selection
  armed: PickContext["armed"]
  pick: PickLayers
  pickFilter: PickFilter
}

/** What a drag of parts and copper together asks of the board's parts (use-copper.ts CopperParts). */
function useCopperParts({ parts, circuit, actions, selection, armed, pick, pickFilter }: CopperPartsInput): CopperParts {
  return useMemo(
    () => ({
      selectedAt: (world: Point) => {
        const target = targetAt(parts.boxes, undefined, world, { selection, armed, layers: pick, filter: pickFilter })
        return target.kind === "part" && selection.has(target.name) ? target.name : undefined
      },
      originOf: (name: string) => parts.anchors.get(name)?.origin ?? parts.boxes.find((box) => box.name === name)?.center ?? { x: 0, y: 0 },
      blockerFor: parts.blockerFor,
      move: (names: readonly string[], offset: Point) => sendGroupEditMarked(moveEach(circuit, names, "pcb", anchorLookup(parts.anchors, parts.boxes), offset, parts.blockerFor), actions),
    }),
    [parts, circuit, actions, selection, armed, pick, pickFilter],
  )
}

/** The board outline's bounds, or the parts' when there is no outline. */
function useBoardBounds(design: Design, boxes: PartBox[]) {
  return useMemo(() => pointBounds(design.pcb.board?.outline ?? []) ?? unionBoxes(boxes.map((b) => b.box)), [design, boxes])
}

interface PcbPointerInput {
  copper: ReturnType<typeof useCopper>
  pours: ReturnType<typeof usePours>
  silk: ReturnType<typeof useSilkTexts>
  track: ReturnType<typeof useTrackTool>
  hover: ReturnType<typeof usePcbHover>
  boxes: PartBox[]
  context: PickContext
  /** The designators, which copper does not cover (gestures.ts textTakesPress). */
  texts: GestureTexts
  camera: Camera | undefined
  size: Size
  canvasRef: RefObject<HTMLCanvasElement | null>
  gestures: ReturnType<typeof useCanvasGestures>
  setCursor(world: Point | undefined): void
  onOpenProperties: CanvasProps["onOpenProperties"]
  onSelect: CanvasProps["onSelect"]
  /** The hover label: told where the pointer is, when it leaves, presses and turns the wheel. */
  label: Pick<HoverDriver, "leave" | "press" | "stale" | "over"> & { at(world: Point): void }
  /** Click to place a part picked in the Library: it sees a press before every other tool. */
  partPlace: PartPlaceTool
}

/**
 * The pointer handlers: the track tool sees a press first, then copper (above the pads and parts), then the gestures.
 * A double click on a track selects the segment under the pointer; on a part it opens Properties.
 */
function pcbPointer({ copper, pours, silk, track, hover, boxes, context, texts, camera, size, canvasRef, gestures, setCursor, onOpenProperties, onSelect, label, partPlace }: PcbPointerInput) {
  const textFirst = (world: Point) => textTakesPress(boxes, world, context, texts)
  const open = (world: Point) => {
    if (track.armed || pours.armed || partPlace.armed) return
    const segment = textFirst(world) ? undefined : copperSegmentAt(copper, world)
    if (segment) return onSelect((current) => current.onlySegment(segment))
    if (!textFirst(world) && copperIdAt(copper, world) !== undefined) return
    const target = targetAt(boxes, undefined, world, context)
    if (target.kind === "part") onOpenProperties(target)
  }
  const hoverAt = (world: Point) => {
    notePointer("pcb", world)
    label.at(world)
    if (!track.armed && !pours.armed && silk.hoverAt(world)) {
      copper.setHover(undefined)
      pours.clearHover()
      return hover.leave()
    }
    if (textFirst(world)) {
      copper.setHover(undefined)
      pours.clearHover()
      return hover.at(world)
    }
    if (hoverCopper(copper, world)) {
      pours.clearHover()
      return hover.leave()
    }
    hover.at(world)
    pours.hoverAt(world)
  }
  const pressCopper = copperPress(copper)
  const press = pcbPress({ pourTool: pours.toolPress, route: track.press, pourCorner: (event, world) => pours.cornerPress(event, world) || silk.press(event, world), text: textFirst, copper: pressCopper, pour: pours.pickPress })
  const tool: typeof press = (event, world) => partPlace.press(event, world) || press(event, world)
  const handlers = pointerHandlers({ camera, size, element: canvasRef, gestures, setCursor, hover: hoverAt, open, tool })
  const pointer = withHoverLabel(withSilkTextDrag(silk, withPourDrag(pours, withCopperDrag(copper, handlers, setCursor), setCursor), setCursor), label)
  const onLeave = () => {
    label.leave()
    silk.clearHover()
    hover.leave()
    copper.setHover(undefined)
    pours.clearHover()
    setCursor(undefined)
  }
  return { pointer, onLeave }
}

/** The PCB, drawn by copperflow's own renderer under its camera, grid and tools. */
export function PcbCanvas(props: PcbCanvasProps) {
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
  const trackArm = useTrackArm()
  const disarmPours = useRef<() => void>(() => undefined)
  const disarmTrackAndPours = useCallback(() => {
    trackArm.disarm()
    disarmPours.current()
  }, [trackArm])
  const note = useNoteTool(disarmTrackAndPours)
  const disarmNoteAndTrack = useCallback(() => {
    note.disarm()
    trackArm.disarm()
  }, [note, trackArm])
  const pours = usePours({ design, circuit, actions, camera, size, canvas: canvasRef, cursor, layers, hidden: props.hiddenPours, filter: pickFilter, armed: note.tool, othersArmed: note.armed || trackArm.armed !== null, selection, onSelect, step, snap, activeLayer: props.activeLayer, mode: props.pourFill, onArm: disarmNoteAndTrack })
  disarmPours.current = pours.disarm
  const silk = useSilkTexts({ design, circuit, actions, camera, size, canvas: canvasRef, layers, filter: pickFilter, armed: note.tool, selection, onSelect, step, snap })
  const copperParts = useCopperParts({ parts, circuit, actions, selection, armed: note.tool, pick, pickFilter })
  const copper = useCopper({ design, builtMark, parts: copperParts, camera, size, canvas: canvasRef, layers, filter: pickFilter, armed: note.tool, selection, onSelect, actions, step, snap, routing: trackArm.route !== null })
  const copperAreas = useMemo(() => copperBoxes(copper.shown, layers), [copper.shown, layers])
  useTrackShape({ design, builtMark, selection, lockedParts: parts.locked, routing: trackArm.route !== null, send: (change) => copper.latest.current.send(change), busy: () => copper.latest.current.inFlight, notify: actions.notify })
  const track = useTrackTool({ design, builtMark, copper: copper.shown, camera, cursor, step, snap, layers, activeLayer: props.activeLayer, onActiveLayer: props.onActiveLayer, locked: parts.locked, actions, arm: trackArm, onArm: note.disarm })
  usePcbToolState(track.command ?? boxToolCommand(note.which), note.disarm, trackArm.disarm)
  // Arming the board text or a Library part puts the other PCB tools away, and each of the two the other.
  const putAway = (other: () => void) => () => [disarmNoteAndTrack, pours.disarm, other].forEach((stop) => stop())
  const boardText = useBoardTextTool({ design, circuit, actions, step, snap, activeLayer: props.activeLayer, othersArmed: note.armed || trackArm.armed !== null || pours.armed, putOthersAway: putAway(disarmPart), onSelect })
  const partPlace = usePartPlaceTool({ view: "pcb", step, snap, othersArmed: note.armed || trackArm.armed !== null || pours.armed || boardText.armed, putOthersAway: putAway(boardText.disarm) })
  const firstTool: PartPlaceTool = { armed: partPlace.armed || boardText.armed, press: (event, world) => partPlace.press(event, world) || boardText.press(event, world), hint: partPlace.hint ?? boardText.hint }
  const silkShown = useCallback((name: string) => {
    const part = design.pcb.parts.find((p) => p.component === name)
    return part !== undefined && layers[part.side === "top" ? "topSilk" : "bottomSilk"]
  }, [design, layers])
  const texts = usePartTexts({ view: "pcb", design, circuit, actions, locked: parts.locked, builtFrom, drawn: silkShown })
  const gestures = useCanvasGestures({ ...common, camera, setCamera, size, boxes: parts.boxes, anchors: parts.anchors, step, snap, builtFrom, selection, tool: { armed: note.tool, disarm: note.disarm }, layers: pick, copper: copperAreas, copperAt: (world) => copperIdAt(copper, world), texts: texts.tools, filter: pickFilter, onContextMenu: track.armed ? track.cancel : props.onContextMenu })
  const layout = useLayout(parts, step, snap)
  const copperLine = useMemo(() => selectedCopperLine(selection.copper, selection.total, copper.shown), [selection, copper.shown])
  const menuPlace = useKeyMenuPlace(canvasRef, selection.primary, parts.boxes, camera, size, undefined, copperLine)
  const { rotateHeld } = usePcbKeys(design, cursor, layers, { ...common, paused: track.routing || pours.busy, board: pours.removal, selection, layout, builtMark, buildStatus, moveWaiting: gestures.pending !== undefined, fit, onHighlight, menuPlace, onContextMenu: props.onContextMenu, copper: copper.keys, texts })
  const hover = usePcbHover(design, parts.boxes, pick, pickFilter, texts.tools)
  const { gesture } = gestures
  const shownTexts = useShownTexts(texts, gesture)
  const sceneTexts = useMemo(() => ({ ...shownTexts, hover: hover.text }), [shownTexts, hover.text])
  const moving = copper.moving ? { names: copper.moving.names, offset: copper.moving.offset } : gestures.moving
  const copperScene: CopperScene = { ...copper.scene, activeLayer: props.activeLayer, routes: track.routes }
  usePcbPaint(canvasRef, { design, camera, size, layers, hoverPad: hover.pad, moving, boxes: parts.boxes, hover: hover.part, selection, locked: parts.locked, circuit, gesture, highlightNets: highlight, markers, activeViolation, grid, copper: copperScene, texts: sceneTexts, pours: pours.scene, silkTexts: silk.scene })
  const context: PickContext = { selection, armed: note.tool, layers: pick, filter: pickFilter }
  const scene: PcbHoverScene | undefined = camera && { view: "pcb", design, copper: copper.shown, scale: camera.scale, layers: pick, context, boxes: parts.boxes, texts: texts.tools, pours: { hidden: props.hiddenPours, activeLayer: props.activeLayer } }
  const probe = scene && { pick: (world: Point) => hoverTarget(world, scene), still: (target: HoverTarget, world: Point) => stillOver(target, world, scene) }
  const hoverLabel = useHoverLabel({ enabled: props.hoverLabels, busy: track.routing, probe, camera, design })
  const label = { ...hoverLabel, at: (world: Point) => camera && hoverLabel.move(world, worldToScreen(camera, size, world)) }
  const { pointer, onLeave } = pcbPointer({ copper, pours, silk, track, hover, boxes: parts.boxes, context, texts: texts.tools, camera, size, canvasRef, gestures, setCursor, onOpenProperties: props.onOpenProperties, onSelect, label, partPlace: firstTool })
  const cursorStyle = track.armed || firstTool.armed ? "crosshair" : (silk.cursor ?? pours.cursor ?? copperCursor(copper) ?? cursorFor(gesture, note.armed, hover.part !== undefined || hover.text !== undefined))
  return (
    <div className="pcb-canvas" ref={wrapRef}>
      <PcbSurface canvasRef={canvasRef} size={size} cursorStyle={cursorStyle} pointer={pointer} onLeave={onLeave} hint={firstTool.hint ?? note.hint ?? pours.hint ?? track.hint} />
      {pours.state?.tool === "hole" && <HoleDiameterField value={pours.diameter} onChange={pours.setDiameter} />}
      {boardText.at && camera && <InlineTextField field={{ label: "Text", initial: "", at: boardText.at }} camera={camera} size={size} actions={boardText} />}
      <HoverLabel state={hoverLabel.state} />
      <PcbTools unit={unit} step={step} setStep={setStep} keep={{ show: parts.autoPlaced, onKeep: () => keepAutoPlaced(design, "pcb", parts.blockerFor, actions, circuit) }} />
      <CanvasStatus cursor={cursor} zoom={camera?.scale} unit={unit} onToggleUnit={onToggleUnit} detail={track.status ?? (hover.pad && padLabel(design, hover.pad))} gesture={gesture} rotateHeld={rotateHeld} snap={snap} />
    </div>
  )
}
