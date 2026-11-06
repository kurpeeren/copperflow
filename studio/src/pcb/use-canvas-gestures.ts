// Pan, drag and note-box gestures shared by the PCB and schematic canvases, and the move a drag writes.
import { useEffect, useMemo, useState, type PointerEvent, type RefObject } from "react"
import type { CircuitData } from "../api"
import type { NetLabel } from "../../../src/engine/schematic.js"
import type { Actions } from "../App"
import { toLocal, type Moving } from "./canvas-common"
import { hitTest, screenToWorld, snap, type Camera, type PartBox, type Point, type Size } from "./geometry"
import { movedTo, VIEWS, ZERO, type Anchor, type View } from "./positions"
import type { LabelTools } from "./use-label-drag"

export type Gesture =
  | { kind: "pan"; start: Point; camera: Camera }
  | { kind: "drag"; part: PartBox; start: Point; offset: Point; moved: boolean; blocker: string | null }
  | { kind: "label"; label: NetLabel; start: Point; at: Point; moved: boolean; blocker: string | null }
  | { kind: "box"; start: Point; current: Point }

export interface GestureInput {
  view: View
  camera: Camera | undefined
  setCamera(camera: Camera): void
  size: Size
  boxes: PartBox[]
  anchors: ReadonlyMap<string, Anchor>
  step: number
  /** When the build behind the shown design started (ms). */
  builtFrom: number
  circuit: CircuitData
  actions: Actions
  onSelect(name: string | null): void
  blockerFor(name: string): string | null
  /** The schematic's net labels and power symbols, when they can be dragged. */
  labels?: LabelTools
}

type Commit = (part: PartBox, offset: Point) => void

const DRAG_THRESHOLD_PX = 3
const BOX_MIN_PX = 6
const round = (value: number) => Math.round(value * 1000) / 1000

/** The pointer press starts a pan (middle or right button), a note box (Shift), a part drag or a pan. */
function startGesture(input: GestureInput, event: { button: number; shiftKey: boolean }, point: Point): Gesture | undefined {
  const { camera } = input
  if (!camera) return undefined
  if (event.button === 1 || event.button === 2) return { kind: "pan", start: point, camera }
  if (event.shiftKey) return { kind: "box", start: point, current: point }
  const world = screenToWorld(camera, input.size, point)
  const hit = hitTest(input.boxes, world)
  if (!hit) return pressLabel(input, world, point) ?? { kind: "pan", start: point, camera }
  input.onSelect(hit.name)
  return { kind: "drag", part: hit, start: point, offset: { x: 0, y: 0 }, moved: false, blocker: input.blockerFor(hit.name) }
}

/** A press on a net label or power symbol outside every part's box starts dragging it. */
function pressLabel(input: GestureInput, world: Point, point: Point): Gesture | undefined {
  const label = input.labels?.at(world)
  return label && { kind: "label", label, start: point, at: label.at, moved: false, blocker: input.labels?.blocker(label.id) ?? null }
}

/** The gesture after the pointer moved to `point`; a pan moves the camera instead. */
function followGesture(input: GestureInput, gesture: Gesture, point: Point, camera: Camera): Gesture | undefined {
  if (gesture.kind === "pan") {
    const dx = (point.x - gesture.start.x) / gesture.camera.scale
    const dy = (point.y - gesture.start.y) / gesture.camera.scale
    input.setCamera({ ...gesture.camera, cx: gesture.camera.cx - dx, cy: gesture.camera.cy + dy })
    return undefined
  }
  if (gesture.kind === "box") return { ...gesture, current: point }
  if (gesture.kind === "label") return followLabel(input, gesture, point, camera)
  if (!gesture.moved && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) <= DRAG_THRESHOLD_PX) return undefined
  // Snap the part's origin, where its position props put it, to the grid, not the distance moved.
  const origin = input.anchors.get(gesture.part.name)?.origin ?? gesture.part.center
  const world = screenToWorld(camera, input.size, point)
  const startWorld = screenToWorld(camera, input.size, gesture.start)
  const raw = { x: origin.x + world.x - startWorld.x, y: origin.y + world.y - startWorld.y }
  return { ...gesture, moved: true, offset: { x: round(snap(raw.x, input.step) - origin.x), y: round(snap(raw.y, input.step) - origin.y) } }
}

/** A label follows the pointer, its anchor snapped to the grid like a part's origin. */
function followLabel(input: GestureInput, gesture: Extract<Gesture, { kind: "label" }>, point: Point, camera: Camera): Gesture | undefined {
  if (!gesture.moved && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) <= DRAG_THRESHOLD_PX) return undefined
  const world = screenToWorld(camera, input.size, point)
  const startWorld = screenToWorld(camera, input.size, gesture.start)
  const { at } = gesture.label
  const snapped = (value: number) => round(snap(value, input.step))
  return { ...gesture, moved: true, at: { x: snapped(at.x + world.x - startWorld.x), y: snapped(at.y + world.y - startWorld.y) } }
}

/** A drop writes the move, a still pan clears the selection, and a note box asks for the note. */
function endGesture(input: GestureInput, done: Gesture, camera: Camera, commit: Commit): void {
  if (done.kind === "label") {
    if (!done.moved) return
    return done.blocker ? input.actions.notify(done.blocker) : input.labels?.commit(done.label, done.at)
  }
  if (done.kind === "drag") {
    if (!done.moved) return
    if (done.blocker) return input.actions.notify(done.blocker)
    return commit(done.part, done.offset)
  }
  if (done.kind === "pan") {
    if (Math.hypot(done.camera.cx - camera.cx, done.camera.cy - camera.cy) * camera.scale < DRAG_THRESHOLD_PX) input.onSelect(null)
    return
  }
  const a = screenToWorld(camera, input.size, done.start)
  const b = screenToWorld(camera, input.size, done.current)
  if (Math.abs(a.x - b.x) * camera.scale < BOX_MIN_PX && Math.abs(a.y - b.y) * camera.scale < BOX_MIN_PX) return
  const text = window.prompt(VIEWS[input.view].notePrompt)
  if (text) void input.actions.mark(text, { view: input.view, x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) })
}

/** The last move sent, kept drawn until a build that started after it was sent has finished. */
function usePendingMove(input: GestureInput): { pending: Moving | undefined; commit: Commit } {
  const { view, circuit, actions, anchors, builtFrom } = input
  const [pending, setPending] = useState<Moving & { sentAt: number }>()
  useEffect(() => setPending((current) => (current && current.sentAt > builtFrom ? current : undefined)), [builtFrom])
  const commit: Commit = (part, offset) => {
    if (offset.x === 0 && offset.y === 0) return
    const [keyX, keyY] = VIEWS[view].position
    const [x, y] = movedTo(circuit, part.name, view, anchors.get(part.name) ?? { origin: part.center, group: ZERO }, offset)
    const sent = { name: part.name, offset, sentAt: Date.now() }
    setPending(sent)
    void actions
      .edit([{ kind: "setProps", part: part.name, props: { [keyX]: x, [keyY]: y } }], `move ${part.name}${VIEWS[view].where} to (${x}, ${y})`)
      .then((ok) => ok || setPending((current) => (current === sent ? undefined : current)))
  }
  const visible = useMemo(() => (pending && pending.sentAt > builtFrom ? pending : undefined), [pending, builtFrom])
  return { pending: visible, commit }
}

/** The canvas gestures: `moving` is the part being dragged, else the one whose move waits for its build. */
export function useCanvasGestures(input: GestureInput) {
  const [gesture, setGesture] = useState<Gesture>()
  const { pending, commit } = usePendingMove(input)
  const moving = useMemo(
    () => (gesture?.kind === "drag" && gesture.moved && !gesture.blocker ? { name: gesture.part.name, offset: gesture.offset } : pending),
    [gesture, pending],
  )
  useEffect(() => {
    if (gesture?.kind !== "label") return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setGesture(undefined)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [gesture?.kind])
  const press = (event: { button: number; shiftKey: boolean }, point: Point) => {
    const next = startGesture(input, event, point)
    if (next) setGesture(next)
  }
  /** Follows the pointer; false when no gesture is running, so the canvas can update its hover instead. */
  const move = (point: Point): boolean => {
    if (!gesture || !input.camera) return false
    const next = followGesture(input, gesture, point, input.camera)
    if (next) setGesture(next)
    return true
  }
  const release = () => {
    setGesture(undefined)
    if (gesture && input.camera) endGesture(input, gesture, input.camera, commit)
  }
  return { gesture, moving, press, move, release }
}

/** The pointer: grabbing while panning, move or not-allowed while dragging, else crosshair, pointer or default. */
export function cursorFor(gesture: Gesture | undefined, crosshair: boolean, overPart: boolean): string {
  if (gesture?.kind === "pan") return "grabbing"
  if (gesture?.kind === "drag" || gesture?.kind === "label") return gesture.blocker ? "not-allowed" : "move"
  if (crosshair) return "crosshair"
  return overPart ? "pointer" : "default"
}

type Press = { button: number; shiftKey: boolean }

export interface PointerInput {
  camera: Camera | undefined
  size: Size
  /** The element whose box pointer positions are measured against. */
  element: RefObject<Element | null>
  gestures: { press(event: Press, point: Point): void; move(point: Point): boolean; release(): void }
  setCursor(world: Point): void
  /** Updates what is under the pointer while no gesture runs. */
  hover(world: Point): void
  /** The view's own tool sees a press first; true when it used it. */
  tool?(event: Press, world: Point): boolean
}

/** Pointer handlers: a press goes to the view's tool, else starts a gesture; a move follows the gesture, else updates the hover. */
export function pointerHandlers(input: PointerInput) {
  const local = (event: { clientX: number; clientY: number }) => toLocal(input.element.current, input.size, event)
  return {
    onPointerDown: (event: PointerEvent<Element>) => {
      if (!input.camera) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const point = local(event)
      if (!input.tool?.(event, screenToWorld(input.camera, input.size, point))) input.gestures.press(event, point)
    },
    onPointerMove: (event: PointerEvent<Element>) => {
      if (!input.camera) return
      const point = local(event)
      const world = screenToWorld(input.camera, input.size, point)
      input.setCursor(world)
      if (!input.gestures.move(point)) input.hover(world)
    },
    onPointerUp: () => input.gestures.release(),
  }
}
