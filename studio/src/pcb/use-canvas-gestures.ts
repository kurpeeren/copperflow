// The canvas gestures' state, shared by the PCB and schematic canvases: the gesture under way (gestures.ts says what
// each step does), the group move waiting for its build, the pointer handlers and the cursor.
import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from "react"
import { toLocal, type Moving } from "./canvas-common"
import { screenToWorld, type Camera, type Point, type Size } from "./geometry"
import { cancelsOnEscape, gestureLost, gestureSession, moveWithWires, type Commit, type Gesture, type GestureInput } from "./gestures"
import { sendGroupEdit } from "./group-edits"
import { opensOnDoubleClick, type Press } from "./press"

export type { Gesture, GestureInput } from "./gestures"
export type { Press }

/**
 * The last group move sent (its parts and the selected wires it carries), its parts and the wires' new shapes kept
 * drawn until a build that started after it was sent has finished.
 */
function usePendingMove(input: GestureInput): { pending: Moving | undefined; commit: Commit } {
  const { actions, builtFrom } = input
  const [pending, setPending] = useState<Moving & { sentAt: number }>()
  useEffect(() => setPending((current) => (current && current.sentAt > builtFrom ? current : undefined)), [builtFrom])
  const commit: Commit = (names, offset, wires = []) => {
    if (offset.x === 0 && offset.y === 0) return
    const { plan, lines } = moveWithWires(input, names, offset, wires)
    const sent = plan.edits.length > 0 ? { names: plan.parts, offset, wires: lines, sentAt: Date.now() } : undefined
    if (sent) setPending(sent)
    void sendGroupEdit(plan, actions).then((ok) => ok || setPending((current) => (current === sent ? undefined : current)))
  }
  const visible = useMemo(() => (pending && pending.sentAt > builtFrom ? pending : undefined), [pending, builtFrom])
  return { pending: visible, commit }
}

/** Esc while a net label or a wire is dragged drops the drag (cancelsOnEscape); captured and stopped, so it does not also clear the selection or stop wiring. */
function useEscapeCancelsDrag(kind: Gesture["kind"] | undefined, cancel: () => void): void {
  useEffect(() => {
    if (!cancelsOnEscape(kind)) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      cancel()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [kind, cancel])
}

/** The group being dragged, with the shapes the drag gives the wires (the same edits a drop would write), live. */
function useDragged(input: GestureInput, gesture: Gesture | undefined): Moving | undefined {
  const dragged = gesture?.kind === "drag" && gesture.moved && !gesture.blocker ? gesture : undefined
  const { follow, circuit } = input
  // Worked out again as the drag's offset changes, or a build changes the sheet or the source; the rest of the input
  // does not change the shapes during a drag.
  return useMemo(() => {
    if (!dragged) return undefined
    const wires = follow ? moveWithWires(input, dragged.names, dragged.offset, dragged.wires).lines : []
    return { names: dragged.movable, offset: dragged.offset, wires }
  }, [dragged, follow, circuit])
}

/**
 * The canvas gestures: one session holds the gesture from press to release (gestureSession), and `gesture` is what
 * React draws of it; `moving` is the group being dragged, else the one whose move waits for its build (`pending`),
 * with the wires' new shapes on the schematic.
 */
export function useCanvasGestures(input: GestureInput) {
  const [gesture, setGesture] = useState<Gesture>()
  const { pending, commit } = usePendingMove(input)
  // The session reads the latest canvas input and commit through this ref; it is set on every render.
  const latest = useRef({ input, commit })
  latest.current = { input, commit }
  const [session] = useState(() => gestureSession(() => latest.current, setGesture))
  const dragged = useDragged(input, gesture)
  const moving = dragged ?? pending
  useEscapeCancelsDrag(gesture?.kind, session.cancel)
  // Pressing W during a wire's drag takes its drag tools away: the drag is dropped at once, so the wire goes back.
  useEffect(() => {
    if (gesture && gestureLost(gesture, input.wires)) session.cancel()
  }, [gesture, input.wires, session])
  const { press, move, release, cancel, wireBeforeDoubleClick } = session
  return { gesture, moving, pending, press, move, release, cancel, wireBeforeDoubleClick }
}

/** The pointer: grabbing while panning, move or not-allowed while dragging, crosshair for a tool, else pointer or default. */
export function cursorFor(gesture: Gesture | undefined, crosshair: boolean, overPart: boolean): string {
  if (gesture?.kind === "pan" && (gesture.moved || gesture.still === "none")) return "grabbing"
  if (gesture?.kind === "drag" || gesture?.kind === "label" || gesture?.kind === "reshape") return gesture.blocker ? "not-allowed" : "move"
  if (crosshair || gesture?.kind === "note" || gesture?.kind === "zoom") return "crosshair"
  return overPart ? "pointer" : "default"
}

export interface PointerInput {
  camera: Camera | undefined
  size: Size
  /** The element whose box pointer positions are measured against. */
  element: RefObject<Element | null>
  gestures: { press(event: Press, point: Point): void; move(point: Point, buttons?: number): boolean; release(at: Point): void; cancel(): void }
  setCursor(world: Point): void
  /** Updates what is under the pointer while no gesture runs. */
  hover(world: Point): void
  /** The view's own tool sees a press first; true when it used it. */
  tool?(event: Press, world: Point): boolean
  /** A left double click, at a world point. */
  open?(world: Point): void
}

/**
 * Pointer handlers: a press goes to the view's tool, else starts a gesture; a move follows the gesture, else updates
 * the hover. When the browser cancels the pointer or takes its capture away, the gesture ends without being finished.
 */
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
      if (!input.gestures.move(point, event.buttons)) input.hover(world)
    },
    onPointerUp: (event: PointerEvent<Element>) => input.gestures.release({ x: event.clientX, y: event.clientY }),
    // After a release the gesture is already over, so the capture's loss that follows it does nothing.
    onPointerCancel: () => input.gestures.cancel(),
    onLostPointerCapture: () => input.gestures.cancel(),
    onDoubleClick: (event: MouseEvent<Element>) => {
      if (input.camera && opensOnDoubleClick(event)) input.open?.(screenToWorld(input.camera, input.size, local(event)))
    },
  }
}
