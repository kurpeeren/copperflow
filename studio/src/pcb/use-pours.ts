// The PCB canvas's copper pours and holes: Place → Copper pour (corners clicked, closed by a double click, Enter or a
// click on the first corner), Place → Copper pour: Whole board, Place → Hole with its diameter; the press that picks a
// pour by its outline or a hole, the corner drag of the selected pour, the one under the pointer, and what they look
// like (pour-draw.ts PourScene). The logic is in pour-tool.ts and pour-hit.ts; this hook holds the state and sends the
// edits, one history entry each.
import { lockGate } from "../ai-lock-gate.js"
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from "react"
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import { togglesSelection, type Selection, type SelectionChange } from "../selection"
import { useCommands } from "../shell/commands"
import type { PourCommand } from "../shell/command-owners"
import { keyAction, keyInput } from "./canvas-keys"
import { toLocal } from "./canvas-common"
import { isDoubleClick } from "./draw-tools"
import { screenToWorld, snapPoint, type Camera, type Point, type Size } from "./geometry"
import type { ActiveLayer, LayerVisibility } from "./layers"
import { canPick } from "./pick"
import type { PickFilter } from "./pick-filter"
import type { PourScene } from "./pour-draw"
import { holeAt, pourCornerAt, pourEdgeAt, poursOf } from "./pour-hit"
import {
  boardItemBlocker,
  boardRemoval,
  DEFAULT_HOLE_DIAMETER,
  defaultPourNet,
  holeDiameter,
  holeEdit,
  holeSummary,
  idlePourTool,
  pourCornerEdit,
  pourEdit,
  pourHint,
  pourPreview,
  pourSummary,
  pourToolStep,
  type PourTool,
  type PourToolEvent,
  type PourToolState,
} from "./pour-tool"
import type { PourFillMode } from "./pour-view"
import { newBoardItemId } from "../../../src/core/board-items.js"
import { DRAG_THRESHOLD_PX, type ArmedTool, type Press } from "./press"

export interface PoursInput {
  design: Design
  circuit: CircuitData
  actions: Actions
  camera: Camera | undefined
  size: Size
  canvas: RefObject<HTMLCanvasElement | null>
  cursor: Point | undefined
  layers: LayerVisibility
  /** The pours hidden in the Layer panel. */
  hidden: ReadonlySet<string>
  filter: PickFilter
  /** The note box or Fit area tool, which takes every press. */
  armed: ArmedTool
  /** Another PCB tool is armed (Single routing, Via, Note box, Fit area): the pour tools step aside. */
  othersArmed: boolean
  selection: Selection
  onSelect(change: SelectionChange): void
  step: number
  snap: boolean
  activeLayer: ActiveLayer
  mode: PourFillMode
  /** Called when a pour tool is armed, so the other tools step aside. */
  onArm(): void
}

/** A corner of the selected pour being dragged. */
interface CornerDrag {
  id: string
  index: number
  outline: readonly Point[]
  start: Point
  to: Point
  moved: boolean
}

const locksOf = (circuit: CircuitData): ReadonlySet<string> => new Set(circuit.annotations.locks.map((lock) => lock.part))

/** Selects a new pour, by the id its edit gave it, once the build has it. */
function useSelectNewPour(design: Design, onSelect: PoursInput["onSelect"]) {
  const [waiting, setWaiting] = useState<string | null>(null)
  const pours = poursOf(design)
  useEffect(() => {
    if (waiting === null || !pours.some((pour) => pour.id === waiting)) return
    onSelect((current) => current.clear().onlyBoard(waiting))
    setWaiting(null)
  }, [pours, waiting, onSelect])
  return useCallback((id: string) => setWaiting(id), [])
}

/** A failed send the actions did not report themselves: told, and counted as failed. */
const reported = (actions: Actions) => (error: unknown): false => {
  actions.notify(`Not written: ${error instanceof Error ? error.message : String(error)}`)
  return false
}

/** The armed tool's state; `send` runs one event through it and hands a closed outline or a hole's place to `write`. */
function useToolState(onArm: () => void, write: (step: { outline?: Point[]; hole?: Point; refused?: string }) => void) {
  const [state, setState] = useState<PourToolState | null>(null)
  const ref = useRef(state)
  ref.current = state
  const send = useCallback(
    (event: PourToolEvent) => {
      const current = ref.current
      if (!current) return
      const next = pourToolStep(current, event)
      ref.current = next.state
      setState(next.state)
      if (next.outline || next.hole || next.refused) write(next)
    },
    [write],
  )
  const arm = useCallback(
    (tool: PourTool) => {
      onArm()
      ref.current = idlePourTool(tool)
      setState(ref.current)
    },
    [onArm],
  )
  const disarm = useCallback(() => {
    ref.current = null
    setState(null)
  }, [])
  return { state, send, arm, disarm }
}

/** Esc cancels the pour in progress or puts the tool away; with corners clicked, Enter closes the pour and Backspace removes the last corner. */
function useToolKeys(state: PourToolState | null, send: (event: PourToolEvent) => void): void {
  useEffect(() => {
    if (!state) return
    const busy = state.points.length > 0
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || keyInput(event).typing) return
      event.stopPropagation()
      send({ type: "cancel" })
    }
    const onKey = (event: KeyboardEvent) => {
      const action = busy ? keyAction(keyInput(event), { view: "pcb", drawing: true })?.action : undefined
      const toolEvent: PourToolEvent | undefined = action === "finishShape" ? { type: "finish" } : action === "removeCorner" ? { type: "removeCorner" } : undefined
      if (!toolEvent) return
      event.preventDefault()
      send(toolEvent)
    }
    window.addEventListener("keydown", onEscape, true)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onEscape, true)
      window.removeEventListener("keydown", onKey)
    }
  }, [state, send])
}

/** Esc drops a corner drag, before the other keys see it. */
function useDragEscape(dragging: boolean, cancel: () => void): void {
  const ref = useRef(cancel)
  ref.current = cancel
  useEffect(() => {
    if (!dragging) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      ref.current()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [dragging])
}

/** What the handlers read on each event: the latest input and state. */
interface Latest {
  input: PoursInput
  diameter: string
  drag: CornerDrag | undefined
  waitForPour(id: string): void
}

/** Writes a closed pour, or a whole-board one (no outline), of the default net on the active layer; selects it once built. */
function writePour(latest: Latest, outline: readonly Point[] | undefined): void {
  const { input } = latest
  const net = defaultPourNet(input.design)
  if (net === undefined) return input.actions.notify("The circuit has no net for a copper pour yet.")
  // addPour puts a new pour after every <copperpour> tag, so it takes the next id (board-items.ts newBoardItemId).
  const id = newBoardItemId(input.circuit.model.boardItems ?? [], "copperpour")
  void input.actions
    .edit([pourEdit(net, input.activeLayer, outline)], pourSummary(net, input.activeLayer, outline === undefined))
    .catch(reported(input.actions))
    .then((ok) => ok && latest.waitForPour(id))
}

function writeHole(latest: Latest, at: Point): void {
  const diameter = holeDiameter(latest.diameter)
  if (typeof diameter !== "number") return latest.input.actions.notify(diameter.message)
  void latest.input.actions.edit([holeEdit(at, diameter)], holeSummary(diameter)).catch(reported(latest.input.actions))
}

/** A press that picks: a corner of the selected pour starts its drag; else a hole, else a pour's outline, is selected (toggled with Shift or Ctrl). */
function pickPress(latest: Latest, event: Press, world: Point): boolean {
  const { input } = latest
  const { camera, design, selection } = input
  if (!camera || event.button !== 0 || input.armed === "note" || input.armed === "zoom") return false
  const context = { selection, armed: input.armed, filter: input.filter }
  if (!canPick({ kind: "pour", id: "" }, context)) return false
  const id = holeAt(design.pcb.holes, world, camera.scale, input.layers) ?? pourEdgeAt(design, world, camera.scale, input.layers, input.hidden)
  if (id === undefined) return false
  input.onSelect((current) => (togglesSelection(event) ? current.toggleBoard(id) : current.onlyBoard(id)))
  return true
}

/** A press on a corner handle of the pour selected alone starts that corner's drag; a locked or read-only pour says why. */
function cornerPress(latest: Latest, event: Press, world: Point, put: (drag: CornerDrag) => void): boolean {
  const { input } = latest
  const id = input.selection.soleBoard
  const pour = id === undefined ? undefined : poursOf(input.design).find((one) => one.id === id)
  if (!pour?.outline || !input.camera || event.button !== 0 || togglesSelection(event)) return false
  const index = pourCornerAt(pour.outline, world, input.camera.scale)
  if (index === undefined) return false
  const blocker = boardItemBlocker(input.circuit.model, locksOf(input.circuit), pour.id)
  if (blocker) {
    input.actions.notify(`Not moved: ${blocker}`)
    return true
  }
  put({ id: pour.id, index, outline: pour.outline, start: world, to: pour.outline[index] as Point, moved: false })
  return true
}

/** The outline a corner drag shows: the pour's own with the dragged corner at the pointer (on the grid while Snap is on). */
const draggedOutline = (drag: CornerDrag): Point[] => drag.outline.map((corner, i) => (i === drag.index ? drag.to : corner))

export function usePours(input: PoursInput) {
  const { design, circuit, onSelect } = input
  const [diameter, setDiameter] = useState(String(DEFAULT_HOLE_DIAMETER))
  const waitForPour = useSelectNewPour(design, onSelect)
  const [drag, setDrag] = useState<CornerDrag>()
  const dragRef = useRef<CornerDrag | undefined>(undefined)
  const [hover, setHover] = useState<string>()
  // A dragged outline stays drawn until the build after its edit lands.
  const [sent, setSent] = useState<{ id: string; outline: readonly Point[] } | undefined>()
  useEffect(() => setSent(undefined), [design])
  const put = (next: CornerDrag | undefined) => {
    dragRef.current = next
    setDrag(next)
  }
  const now: Latest = { input, diameter, drag, waitForPour }
  const latest = useRef(now)
  latest.current = now
  const write = useCallback((step: { outline?: Point[]; hole?: Point; refused?: string }) => {
    if (step.refused) latest.current.input.actions.notify(step.refused)
    if (step.outline) writePour(latest.current, step.outline)
    if (step.hole) writeHole(latest.current, step.hole)
  }, [])
  const tool = useToolState(input.onArm, write)
  useToolKeys(tool.state, tool.send)
  const { disarm } = tool
  useEffect(() => {
    if (input.othersArmed) disarm()
  }, [input.othersArmed, disarm])
  useDragEscape(drag !== undefined, () => put(undefined))
  useCommands({
    placePour: () => tool.arm("pour"),
    placeHole: () => tool.arm("hole"),
    placePourBoard: () => writePour(latest.current, undefined),
  } satisfies Record<PourCommand, () => void>)
  const lastPress = useRef<{ at: Point; time: number }>(undefined)
  const pointPoint = (world: Point): Point => snapPoint(world, input.step, input.snap)

  /** A press with a pour tool armed: a left click is the tool's (a double click closes the pour), a right press cancels. */
  const toolPress = (event: Press, world: Point): boolean => {
    if (!tool.state || !input.camera || event.button === 1) return false
    if (event.button === 2) {
      tool.send({ type: "cancel" })
      return true
    }
    const at = { at: { x: world.x * input.camera.scale, y: world.y * input.camera.scale }, time: Date.now() }
    const double = isDoubleClick(lastPress.current, at)
    lastPress.current = double ? undefined : at
    tool.send({ type: "press", at: pointPoint(world), double })
    return true
  }

  const outlines = useMemo(() => {
    const shown = new Map<string, readonly Point[]>()
    if (sent) shown.set(sent.id, sent.outline)
    if (drag?.moved) shown.set(drag.id, draggedOutline(drag))
    return shown
  }, [sent, drag])
  const preview = pourPreview(tool.state, input.cursor && pointPoint(input.cursor))
  const scene: PourScene = {
    mode: input.mode,
    hidden: input.hidden,
    selected: new Set(input.selection.board),
    ...(hover === undefined ? {} : { hover }),
    activeLayer: input.activeLayer,
    outlines,
    ...(preview.length > 0 ? { preview } : {}),
  }
  const removal = useMemo(() => boardRemoval(circuit.model, locksOf(circuit)), [circuit])

  /** The hole or pour outline under the pointer, for the drawing and the cursor; true when there is one. */
  const hoverAt = (world: Point): boolean => {
    const { camera } = input
    const context = { selection: input.selection, armed: input.armed, filter: input.filter }
    const id = camera && canPick({ kind: "pour", id: "" }, context) ? (holeAt(design.pcb.holes, world, camera.scale, input.layers) ?? pourEdgeAt(design, world, camera.scale, input.layers, input.hidden)) : undefined
    setHover(id)
    return id !== undefined
  }

  /** Ends a corner drag: the moved outline is written as one edit and drawn until its build. */
  const release = (current: CornerDrag) => {
    put(undefined)
    if (!current.moved) return
    const change = pourCornerEdit(current.id, current.outline, current.index, current.to)
    // A corner that would leave no simple polygon is not written: the reason is told and the old outline stays.
    if ("message" in change) return input.actions.notify(change.message)
    setSent({ id: current.id, outline: draggedOutline(current) })
    void input.actions
      .edit([change.edit], change.summary)
      .catch(reported(input.actions))
      .then((ok) => ok || setSent(undefined))
  }

  return {
    state: tool.state,
    armed: tool.state !== null,
    /** Corners are clicked: the tool owns Enter, Backspace and Esc. */
    busy: tool.state !== null && tool.state.points.length > 0,
    disarm: tool.disarm,
    hint: pourHint(tool.state),
    diameter,
    setDiameter,
    toolPress,
    cornerPress: (event: Press, world: Point) => cornerPress(latest.current, event, world, put),
    pickPress: (event: Press, world: Point) => pickPress(latest.current, event, world),
    hoverAt,
    clearHover: () => setHover(undefined),
    hover,
    drag,
    dragRef,
    put,
    release,
    latest,
    scene,
    removal,
    cursor: drag ? "move" : tool.state ? "crosshair" : hover !== undefined ? "pointer" : undefined,
  }
}

type PourState = ReturnType<typeof usePours>

type Handlers = {
  onPointerMove(event: PointerEvent<Element>): void
  onPointerUp(event: PointerEvent<Element>): void
  onPointerCancel(): void
  onLostPointerCapture(): void
}

/** The canvas's pointer handlers with a pour corner drag taking the moves and the release while it runs. */
export function withPourDrag<H extends Handlers>(pours: PourState, handlers: H, setCursor: (world: Point) => void): H {
  const worldOf = (event: PointerEvent<Element>): Point | undefined => {
    const { input } = pours.latest.current
    return input.camera ? screenToWorld(input.camera, input.size, toLocal(input.canvas.current, input.size, event)) : undefined
  }
  return {
    ...handlers,
    onPointerMove: (event) => {
      const drag = pours.dragRef.current
      const world = drag && worldOf(event)
      if (!drag || !world) return handlers.onPointerMove(event)
      setCursor(world)
      if (event.buttons === 0) return void pours.put(undefined)
      const { input } = pours.latest.current
      const far = Math.hypot(world.x - drag.start.x, world.y - drag.start.y) * (input.camera?.scale ?? 1) >= DRAG_THRESHOLD_PX
      if (!drag.moved && !far) return
      // While the AI lock is closed a pour or hole does not follow the pointer.
      if (lockGate.refuses()) return
      pours.put({ ...drag, moved: true, to: snapPoint(world, input.step, input.snap) })
    },
    onPointerUp: (event) => {
      const drag = pours.dragRef.current
      if (drag) pours.release(drag)
      else handlers.onPointerUp(event)
    },
    onPointerCancel: () => {
      pours.put(undefined)
      handlers.onPointerCancel()
    },
    onLostPointerCapture: () => {
      pours.put(undefined)
      handlers.onLostPointerCapture()
    },
  }
}
