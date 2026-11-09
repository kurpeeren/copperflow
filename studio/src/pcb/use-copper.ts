// The PCB canvas's copper: the tracks and vias as shown (the design's, with the shapes of a drag or of an edit still
// waiting for its build in their place), the one under the pointer, a press that selects one and drags it (a track's
// segment or corner, a via), the arrow keys that move copper selected on its own, and Delete's part for copper. The
// logic is in copper-hit.ts, copper-gesture.ts and copper-edits.ts; this hook holds the state and sends the edits.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from "react"
import type { Design } from "../api"
import type { Actions } from "../App"
import type { EditOutcome } from "../use-actions"
import { Selection, togglesSelection, type SelectionChange } from "../selection"
import { keyAction, keyInput, nudgeDirection } from "./canvas-keys"
import { toLocal } from "./canvas-common"
import type { CopperScene } from "./copper-draw"
import { copperRemoval, moveCopper, NO_SHAPES, withShapes, type OnPad } from "./copper-edits"
import { addPending, dropPending, inFlight, markPending, pendingMoving, pendingShapes, settlePending, type PendingCopper } from "./copper-pending"
import { copperDragShapes, endCopperDrag, followCopperDrag, groupParts, startCopperDrag, startGroupDrag, type CopperChange, type CopperDrag } from "./copper-gesture"
import { copperAt } from "./copper-hit"
import { screenToWorld, type Camera, type Point, type Size } from "./geometry"
import { nameList, nudgeOffset } from "./group-edits"
import type { LayerVisibility } from "./layers"
import { padAt } from "./pcb-draw"
import type { PickFilter } from "./pick-filter"
import { DRAG_THRESHOLD_PX, type ArmedTool, type Press } from "./press"

/** What a drag of parts and copper together asks of the canvas's parts. */
export interface CopperParts {
  /** The part under a point when it is selected (a press there drags it with the selected copper), if any. */
  selectedAt(world: Point): string | undefined
  /** Where the part sits, which a drag pressed on it puts on the grid. */
  originOf(name: string): Point
  blockerFor(name: string): string | null
  /** Writes the parts' move to the circuit file, as one history entry. */
  move(names: readonly string[], offset: Point): Promise<EditOutcome>
}

export interface CopperInput {
  design: Design
  /** The shown build's start mark: an edit whose write mark is below it is in the design. */
  builtMark: number | undefined
  /** The parts a drag pressed on selected copper (or on a part selected with copper) moves too. */
  parts: CopperParts
  camera: Camera | undefined
  size: Size
  canvas: RefObject<HTMLCanvasElement | null>
  layers: LayerVisibility
  filter: PickFilter
  armed: ArmedTool
  selection: Selection
  onSelect(change: SelectionChange): void
  actions: Actions
  step: number
  snap: boolean
}

type Shown = ReturnType<typeof withShapes<Design["pcb"]["tracks"][number], Design["pcb"]["vias"][number]>>

/** A move to draw: the parts and how far. */
type PartsMove = { names: readonly string[]; offset: Point }

/** The copper edits (and group moves' parts) sent and not yet in the shown build (copper-pending.ts). */
function usePendingCopper(builtMark: number | undefined, actions: Actions) {
  const [list, setList] = useState<readonly PendingCopper[]>([])
  const counter = useRef(0)
  useEffect(() => setList((current) => settlePending(current, builtMark)), [builtMark])
  const shapes = useMemo(() => pendingShapes(list, builtMark), [list, builtMark])
  const moving = useMemo(() => pendingMoving(list, builtMark), [list, builtMark])
  const track = useCallback((entry: Omit<PendingCopper, "id" | "mark">, sent: Promise<EditOutcome>) => {
    counter.current += 1
    const id = counter.current
    setList((current) => addPending(current, id, entry))
    void sent.then((outcome) => setList((current) => (outcome.ok && outcome.mark !== undefined ? markPending(current, id, outcome.mark) : dropPending(current, id))))
  }, [])
  const send = useCallback((change: CopperChange) => track({ shapes: change.shapes }, actions.editLayout(change.edits, change.summary)), [track, actions])
  const sendParts = useCallback((parts: PartsMove, sent: Promise<EditOutcome>) => track({ shapes: NO_SHAPES, parts }, sent), [track])
  return { shapes, moving, send, sendParts, inFlight: inFlight(list) }
}

/** Whether a point is on a pad's copper on the track's layer (through pads are on every layer). */
function padTest(design: Design): OnPad {
  return (point, layer) => {
    const pad = padAt(design.pcb, point)
    return pad !== undefined && (pad.layers === "through" || pad.layers === layer)
  }
}

/** What the handlers read of the canvas on each event: the latest input, shown copper and senders. */
interface Latest {
  input: CopperInput
  shown: Shown
  onPad: OnPad
  send(change: CopperChange): void
  sendParts(parts: PartsMove, sent: Promise<EditOutcome>): void
  cancel(): boolean
  inFlight: boolean
}

/** The arrow keys move copper selected on its own; Esc drops a copper drag. Both are taken before the part keys see them. */
function useCopperKeys(latest: RefObject<Latest>): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { input, shown, onPad, send, cancel, inFlight: busy } = latest.current
      if (event.key === "Escape" && cancel()) return event.stopPropagation()
      const { copper, total } = input.selection
      if (copper.length === 0 || total !== copper.length) return
      const hit = keyAction(keyInput(event), { view: "pcb" })
      const direction = hit && nudgeDirection(hit.action)
      if (!hit || !direction) return
      event.preventDefault()
      event.stopPropagation()
      // A held arrow's repeats wait for the edit in flight, so holding it does not write an entry per repeat.
      if (event.repeat && busy) return
      const delta = nudgeOffset(direction, input.step, hit.steps ?? 1, input.snap)
      const move = moveCopper(shown, copper, delta, onPad)
      if (move.skipped.length > 0) input.actions.notify(`Not moved: ${move.skipped.join("; ")}`)
      if (move.edits.length > 0) send({ edits: move.edits, summary: `Move ${nameList(copper)} by (${delta.x}, ${delta.y})`, shapes: move.shapes })
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [latest])
}

/**
 * A press on copper: Shift or Ctrl toggles it; on copper selected with other things the whole selection is dragged
 * (parts and copper by one offset); else it is selected alone and its drag begins. A plain press on a part selected
 * with copper drags the whole selection too.
 */
function pressCopper(input: CopperInput, shown: Shown, world: Point, event: Press): CopperDrag | "toggled" | undefined {
  const { camera, selection } = input
  if (!camera || event.button !== 0 || input.armed === "note" || input.armed === "zoom") return undefined
  const hit = copperAt(shown, world, camera.scale, input.layers, { selection, armed: input.armed, filter: input.filter })
  if (!hit) return pressPartWithCopper(input, world, event)
  if (togglesSelection(event)) {
    input.onSelect((current) => current.toggleCopper(hit.id))
    return "toggled"
  }
  if (selection.hasCopper(hit.id) && selection.total > 1) return startGroupDrag({ id: hit.id, names: selection.names, copper: selection.copper, start: world })
  const sole = selection.soleCopper === hit.id
  input.onSelect((current) => current.onlyCopper(hit.id))
  const width = shown.tracks.find((track) => track.id === hit.id)?.width ?? 0
  return startCopperDrag(hit, shown, { world, point: world, scale: camera.scale, sole, width }) ?? "toggled"
}

/** A plain press on a part selected with copper: the group's drag, from the part's origin; a locked part is left to the canvas, which says why. */
function pressPartWithCopper(input: CopperInput, world: Point, event: Press): CopperDrag | undefined {
  const { selection, parts } = input
  if (selection.copper.length === 0 || togglesSelection(event)) return undefined
  const part = parts.selectedAt(world)
  if (part === undefined || parts.blockerFor(part) !== null) return undefined
  return startGroupDrag({ part, names: selection.names, copper: selection.copper, start: world, origin: parts.originOf(part) })
}

/** Delete's part for copper: the selected tracks and vias that may go, in one change; the locked ones are named. */
function removeCopper(input: CopperInput, shown: Shown, ids: readonly string[]): void {
  const { edits, removed, skipped } = copperRemoval(shown, ids)
  if (skipped.length > 0) input.actions.notify(`Not removed: ${skipped.join("; ")}`)
  if (edits.length === 0) return
  void input.actions.editLayout(edits, `Remove ${nameList(removed)}`).then((outcome) => outcome.ok && input.onSelect((current) => current.withoutCopper(removed)))
}

export function useCopper(input: CopperInput) {
  const { design, builtMark, actions, selection } = input
  const pending = usePendingCopper(builtMark, actions)
  const shown = useMemo(() => withShapes(design.pcb, pending.shapes), [design, pending.shapes])
  const onPad = useMemo(() => padTest(design), [design])
  const [drag, setDrag] = useState<CopperDrag>()
  const [hover, setHover] = useState<string>()
  const dragRef = useRef<CopperDrag | undefined>(undefined)
  const put = (next: CopperDrag | undefined) => {
    dragRef.current = next
    setDrag(next)
  }
  /** Esc during a drag drops it; true when there was one. */
  const cancel = () => {
    if (!dragRef.current) return false
    put(undefined)
    return true
  }
  const now: Latest = { input, shown, onPad, send: pending.send, sendParts: pending.sendParts, cancel, inFlight: pending.inFlight }
  const latest = useRef(now)
  latest.current = now
  useCopperKeys(latest)
  const live = useMemo(() => (drag ? withShapes(shown, copperDragShapes(drag, shown, onPad)) : shown), [drag, shown, onPad])
  const scene: CopperScene = { tracks: live.tracks, vias: live.vias, selected: new Set(selection.copper), ...(hover === undefined ? {} : { hover }) }
  // Stable, so the part keys do not listen again on every render.
  const keys = useMemo(() => ({ remove: (ids: readonly string[]) => removeCopper(latest.current.input, latest.current.shown, ids) }), [])
  const moving = useMemo(() => dragMoving(drag, input.parts) ?? pending.moving, [drag, input.parts, pending.moving])
  return { scene, shown, drag, hover, setHover, put, dragRef, latest, keys, moving }
}

/** The parts a group drag moves now, those that may move, drawn moved. */
function dragMoving(drag: CopperDrag | undefined, parts: CopperParts): PartsMove | undefined {
  const moved = drag && groupParts(drag)
  return moved && { names: moved.names.filter((name) => parts.blockerFor(name) === null), offset: moved.offset }
}

type CopperState = ReturnType<typeof useCopper>

/** The id of the shown, pickable track or via under `world`, if any. */
export function copperIdAt(copper: CopperState, world: Point): string | undefined {
  const { input, shown } = copper.latest.current
  const hit = input.camera && copperAt(shown, world, input.camera.scale, input.layers, { selection: Selection.none, armed: input.armed, filter: input.filter })
  return hit ? hit.id : undefined
}

/** The copper under `world` for the hover; true when there is some, so the part and pad under it are not hovered. */
export function hoverCopper(copper: CopperState, world: Point): boolean {
  const id = copperIdAt(copper, world)
  copper.setHover(id)
  return id !== undefined
}

/** The press hook for pointerHandlers' `tool`: true when the press was on copper. */
export function copperPress(copper: CopperState): (event: Press, world: Point) => boolean {
  return (event, world) => {
    const { input, shown } = copper.latest.current
    const started = pressCopper(input, shown, world, event)
    if (started && started !== "toggled") copper.put(started)
    return started !== undefined
  }
}

/** Follows the pointer during a copper drag, past the drag threshold. */
function followCopper(copper: CopperState, drag: CopperDrag, world: Point): void {
  const { input } = copper.latest.current
  const moved = { x: world.x - drag.start.x, y: world.y - drag.start.y }
  if (!drag.moved && Math.hypot(moved.x, moved.y) * (input.camera?.scale ?? 1) < DRAG_THRESHOLD_PX) return
  copper.put(followCopperDrag(drag, moved, { step: input.step, snap: input.snap }, (text) => input.actions.notify(text)))
}

/** Ends a copper drag: its change is sent (and a group's parts move, one entry per file), or why it could not be is told. */
function releaseCopper(copper: CopperState, drag: CopperDrag): void {
  copper.put(undefined)
  const { input, shown, onPad, send, sendParts } = copper.latest.current
  if (drag.kind === "group" && !drag.moved) return input.onSelect(aloneAfter(drag))
  const parts = groupParts(drag)
  if (parts) sendParts(parts, input.parts.move(parts.names, parts.offset))
  const end = endCopperDrag(drag, shown, onPad)
  if (!end) return
  if ("message" in end) input.actions.notify(end.message)
  else send(end)
}

/** A still click on one thing of a group selects it alone, as on a part or a wire. */
function aloneAfter(drag: CopperDrag): SelectionChange {
  return (current) => (drag.part !== undefined ? current.only(drag.part) : drag.id ? current.onlyCopper(drag.id) : current)
}

type Handlers = {
  onPointerMove(event: PointerEvent<Element>): void
  onPointerUp(event: PointerEvent<Element>): void
  onPointerCancel(): void
  onLostPointerCapture(): void
}

/** The canvas's pointer handlers with a copper drag taking the moves and the release while it runs. */
export function withCopperDrag<H extends Handlers>(copper: CopperState, handlers: H, setCursor: (world: Point) => void): H {
  const worldOf = (event: PointerEvent<Element>): Point | undefined => {
    const { input } = copper.latest.current
    return input.camera ? screenToWorld(input.camera, input.size, toLocal(input.canvas.current, input.size, event)) : undefined
  }
  return {
    ...handlers,
    onPointerMove: (event) => {
      const drag = copper.dragRef.current
      const world = drag && worldOf(event)
      if (!drag || !world) return handlers.onPointerMove(event)
      setCursor(world)
      if (event.buttons === 0) return void copper.put(undefined)
      followCopper(copper, drag, world)
    },
    onPointerUp: (event) => {
      const drag = copper.dragRef.current
      if (drag) releaseCopper(copper, drag)
      else handlers.onPointerUp(event)
    },
    onPointerCancel: () => {
      copper.put(undefined)
      handlers.onPointerCancel()
    },
    onLostPointerCapture: () => {
      copper.put(undefined)
      handlers.onLostPointerCapture()
    },
  }
}

/** The cursor over copper: move (or not-allowed) while dragging it, pointer over it; undefined elsewhere. */
export function copperCursor(copper: CopperState): string | undefined {
  if (copper.drag) return copper.drag.blocker ? "not-allowed" : "move"
  return copper.hover === undefined ? undefined : "pointer"
}
