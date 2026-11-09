// The canvas gestures' state, shared by the PCB and schematic canvases: the gesture under way (gestures.ts says what
// each step does), the group move waiting for its build, the pointer handlers and the cursor.
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type PointerEvent, type RefObject } from "react"
import { toLocal, type Moving } from "./canvas-common"
import { screenToWorld, type Camera, type Point, type Size } from "./geometry"
import { endGesture, followGesture, startGesture, type Commit, type Gesture, type GestureInput } from "./gestures"
import { moveEach, sendGroupEdit } from "./group-edits"
import { ZERO } from "./positions"
import type { Press } from "./press"

export type { Gesture, GestureInput } from "./gestures"
export type { Press }

/** The last group move sent, kept drawn until a build that started after it was sent has finished. */
function usePendingMove(input: GestureInput): { pending: Moving | undefined; commit: Commit } {
  const { view, circuit, actions, anchors, boxes, blockerFor, builtFrom } = input
  const [pending, setPending] = useState<Moving & { sentAt: number }>()
  useEffect(() => setPending((current) => (current && current.sentAt > builtFrom ? current : undefined)), [builtFrom])
  const commit: Commit = (names, offset) => {
    if (offset.x === 0 && offset.y === 0) return
    const anchorOf = (name: string) => anchors.get(name) ?? { origin: boxes.find((box) => box.name === name)?.center ?? ZERO, group: ZERO }
    const plan = moveEach(circuit, names, view, anchorOf, offset, blockerFor)
    const sent = plan.edits.length > 0 ? { names: plan.parts, offset, sentAt: Date.now() } : undefined
    if (sent) setPending(sent)
    void sendGroupEdit(plan, actions).then((ok) => ok || setPending((current) => (current === sent ? undefined : current)))
  }
  const visible = useMemo(() => (pending && pending.sentAt > builtFrom ? pending : undefined), [pending, builtFrom])
  return { pending: visible, commit }
}

/** Esc while a net label is dragged drops the drag; captured and stopped, so it does not also clear the selection or stop wiring. */
function useEscapeCancelsLabel(kind: Gesture["kind"] | undefined, cancel: () => void): void {
  useEffect(() => {
    if (kind !== "label") return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      cancel()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [kind, cancel])
}

/** The canvas gestures: `moving` is the group being dragged, else the one whose move waits for its build. */
export function useCanvasGestures(input: GestureInput) {
  const [gesture, setGesture] = useState<Gesture>()
  const { pending, commit } = usePendingMove(input)
  const moving = useMemo(
    () => (gesture?.kind === "drag" && gesture.moved && !gesture.blocker ? { names: gesture.movable, offset: gesture.offset } : pending),
    [gesture, pending],
  )
  const cancel = useCallback(() => setGesture(undefined), [])
  useEscapeCancelsLabel(gesture?.kind, cancel)
  const press = (event: Press, point: Point) => {
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
  /** Ends the gesture; `at` is where the pointer was let go, in client pixels, for the context menu. */
  const release = (at: Point) => {
    setGesture(undefined)
    if (gesture && input.camera) endGesture(input, gesture, input.camera, commit, at)
  }
  return { gesture, moving, press, move, release }
}

/** The pointer: grabbing while panning, move or not-allowed while dragging, crosshair for a tool, else pointer or default. */
export function cursorFor(gesture: Gesture | undefined, crosshair: boolean, overPart: boolean): string {
  if (gesture?.kind === "pan" && (gesture.moved || gesture.still === "none")) return "grabbing"
  if (gesture?.kind === "drag" || gesture?.kind === "label") return gesture.blocker ? "not-allowed" : "move"
  if (crosshair || gesture?.kind === "note") return "crosshair"
  return overPart ? "pointer" : "default"
}

export interface PointerInput {
  camera: Camera | undefined
  size: Size
  /** The element whose box pointer positions are measured against. */
  element: RefObject<Element | null>
  gestures: { press(event: Press, point: Point): void; move(point: Point): boolean; release(at: Point): void }
  setCursor(world: Point): void
  /** Updates what is under the pointer while no gesture runs. */
  hover(world: Point): void
  /** The view's own tool sees a press first; true when it used it. */
  tool?(event: Press, world: Point): boolean
  /** A left double click, at a world point. */
  open?(world: Point): void
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
    onPointerUp: (event: PointerEvent<Element>) => input.gestures.release({ x: event.clientX, y: event.clientY }),
    // Only on the drawing itself: a double click in the label's name input selects a word there.
    onDoubleClick: (event: MouseEvent<Element>) => {
      if (!input.camera || event.button !== 0 || !(event.target instanceof HTMLCanvasElement)) return
      input.open?.(screenToWorld(input.camera, input.size, local(event)))
    },
  }
}
