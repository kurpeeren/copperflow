// The PCB canvas's copper: the tracks and vias as shown (the design's, with the shapes of a drag or of an edit still
// waiting for its build in their place), the one under the pointer, a press that selects one and drags it (a track's
// segment or corner, a via), the arrow keys that move copper selected on its own, and Delete's part for copper. The
// logic is in copper-hit.ts, copper-gesture.ts and copper-edits.ts; this hook holds the state and sends the edits.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from "react"
import type { Design } from "../api"
import type { Actions } from "../App"
import { Selection, togglesSelection, type SelectionChange } from "../selection"
import { keyAction, keyInput, nudgeDirection } from "./canvas-keys"
import { toLocal } from "./canvas-common"
import type { CopperScene } from "./copper-draw"
import { copperRemoval, mergeShapes, moveCopper, NO_SHAPES, withShapes, type CopperShapesById, type OnPad } from "./copper-edits"
import { copperDragShapes, endCopperDrag, followCopperDrag, startCopperDrag, type CopperChange, type CopperDrag } from "./copper-gesture"
import { copperAt } from "./copper-hit"
import { screenToWorld, type Camera, type Point, type Size } from "./geometry"
import { nameList, nudgeOffset } from "./group-edits"
import type { LayerVisibility } from "./layers"
import { padAt } from "./pcb-draw"
import type { PickFilter } from "./pick-filter"
import { DRAG_THRESHOLD_PX, type ArmedTool, type Press } from "./press"

export interface CopperInput {
  design: Design
  /** When the build behind the shown design started (ms). */
  builtFrom: number
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

/** The shapes of the last copper edits sent, drawn until a build that started after them lands; a failed edit drops them. */
function usePendingCopper(builtFrom: number, actions: Actions) {
  const [pending, setPending] = useState<{ shapes: CopperShapesById; sentAt: number }>()
  useEffect(() => setPending((current) => (current && current.sentAt > builtFrom ? current : undefined)), [builtFrom])
  const shapes = pending && pending.sentAt > builtFrom ? pending.shapes : NO_SHAPES
  const send = useCallback(
    (change: CopperChange) => {
      const sentAt = Date.now()
      setPending((current) => ({ shapes: mergeShapes(current && current.sentAt > builtFrom ? current.shapes : NO_SHAPES, change.shapes), sentAt }))
      void actions.editLayout(change.edits, change.summary).then((outcome) => outcome.ok || setPending((current) => (current?.sentAt === sentAt ? undefined : current)))
    },
    [builtFrom, actions],
  )
  return { shapes, send }
}

/** Whether a point is on a pad's copper on the track's layer (through pads are on every layer). */
function padTest(design: Design): OnPad {
  return (point, layer) => {
    const pad = padAt(design.pcb, point)
    return pad !== undefined && (pad.layers === "through" || pad.layers === layer)
  }
}

/** The arrow keys move copper selected on its own; Esc drops a copper drag. Both are taken before the part keys see them. */
function useCopperKeys(latest: RefObject<{ input: CopperInput; shown: Shown; onPad: OnPad; send(change: CopperChange): void; cancel(): boolean }>): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { input, shown, onPad, send, cancel } = latest.current
      if (event.key === "Escape" && cancel()) return event.stopPropagation()
      const { copper, total } = input.selection
      if (copper.length === 0 || total !== copper.length) return
      const hit = keyAction(keyInput(event), { view: "pcb" })
      const direction = hit && nudgeDirection(hit.action)
      if (!hit || !direction) return
      event.preventDefault()
      event.stopPropagation()
      const delta = nudgeOffset(direction, input.step, hit.steps ?? 1, input.snap)
      const move = moveCopper(shown, copper, delta, onPad)
      if (move.skipped.length > 0) input.actions.notify(`Not moved: ${move.skipped.join("; ")}`)
      if (move.edits.length > 0) send({ edits: move.edits, summary: `Move ${nameList(copper)} by (${delta.x}, ${delta.y})`, shapes: move.shapes })
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [latest])
}

/** A press on copper: Shift or Ctrl toggles it; else it is selected alone and its drag begins. */
function pressCopper(input: CopperInput, shown: Shown, world: Point, event: Press): CopperDrag | "toggled" | undefined {
  const { camera } = input
  if (!camera || event.button !== 0 || input.armed === "note" || input.armed === "zoom") return undefined
  const context = { selection: input.selection, armed: input.armed, filter: input.filter }
  const hit = copperAt(shown, world, camera.scale, input.layers, context)
  if (!hit) return undefined
  if (togglesSelection(event)) {
    input.onSelect((current) => current.toggleCopper(hit.id))
    return "toggled"
  }
  const sole = input.selection.soleCopper === hit.id
  input.onSelect((current) => current.onlyCopper(hit.id))
  const width = shown.tracks.find((track) => track.id === hit.id)?.width ?? 0
  return startCopperDrag(hit, shown, { world, point: world, scale: camera.scale, sole, width }) ?? "toggled"
}

/** Delete's part for copper: the selected tracks and vias that may go, in one change; the locked ones are named. */
function removeCopper(input: CopperInput, shown: Shown, ids: readonly string[]): void {
  const { edits, removed, skipped } = copperRemoval(shown, ids)
  if (skipped.length > 0) input.actions.notify(`Not removed: ${skipped.join("; ")}`)
  if (edits.length === 0) return
  void input.actions.editLayout(edits, `Remove ${nameList(removed)}`).then((outcome) => outcome.ok && input.onSelect((current) => current.withoutCopper(removed)))
}

export function useCopper(input: CopperInput) {
  const { design, builtFrom, actions, selection } = input
  const pending = usePendingCopper(builtFrom, actions)
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
  const latest = useRef({ input, shown, onPad, send: pending.send, cancel })
  latest.current = { input, shown, onPad, send: pending.send, cancel }
  useCopperKeys(latest)
  const live = useMemo(() => (drag ? withShapes(shown, copperDragShapes(drag, shown, onPad)) : shown), [drag, shown, onPad])
  const scene: CopperScene = { tracks: live.tracks, vias: live.vias, selected: new Set(selection.copper), ...(hover === undefined ? {} : { hover }) }
  // Stable, so the part keys do not listen again on every render.
  const keys = useMemo(() => ({ remove: (ids: readonly string[]) => removeCopper(latest.current.input, latest.current.shown, ids) }), [])
  return { scene, shown, drag, hover, setHover, put, dragRef, latest, keys }
}

type CopperState = ReturnType<typeof useCopper>

/** The copper under `world` for the hover; true when there is some, so the part and pad under it are not hovered. */
export function hoverCopper(copper: CopperState, world: Point): boolean {
  const { input, shown } = copper.latest.current
  const hit = input.camera && copperAt(shown, world, input.camera.scale, input.layers, { selection: Selection.none, armed: input.armed, filter: input.filter })
  copper.setHover(hit ? hit.id : undefined)
  return Boolean(hit)
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

/** Ends a copper drag: its change is sent, or why it could not be is told. */
function releaseCopper(copper: CopperState, drag: CopperDrag): void {
  copper.put(undefined)
  const { input, shown, onPad, send } = copper.latest.current
  const end = endCopperDrag(drag, shown, onPad)
  if (!end) return
  if ("message" in end) input.actions.notify(end.message)
  else send(end)
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
