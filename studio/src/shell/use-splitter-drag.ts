// A splitter's pointer drag: the pointer is captured, its moves are taken once per animation frame, the panel is sized
// live (no render of the workspace per move), and the size is chosen on release. A cancelled drag puts the panel back.
import { useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from "react"
import { animationFrames, frameThrottle } from "./frame-throttle"
import { dragSize, type PanelEdge } from "./panel-sizes"
import type { PanelSplitter } from "./use-panel-sizes"

interface Drag {
  pointerId: number
  /** The pointer's position along the splitter's axis when the drag began. */
  from: number
  /** The panel's size when the drag began, and the size the drag has reached. */
  startSize: number
  size: number
}

type Input = PanelSplitter & { edge: PanelEdge }

const along = (edge: PanelEdge, event: PointerEvent) => (edge === "bottom" ? event.clientY : event.clientX)

/** The drag's moves, taken once per frame: the size reached is put on the panel and reported through `show`. */
function useDragFrames(latest: RefObject<Input>, drag: RefObject<Drag | null>, show: (size: number) => void) {
  const throttle = useMemo(
    () =>
      frameThrottle(animationFrames(), (pointer: number) => {
        const now = drag.current
        if (!now) return
        const { edge, limits, onLive } = latest.current
        now.size = dragSize(edge, now.startSize, pointer - now.from, limits)
        onLive(now.size)
        show(now.size)
      }),
    [],
  )
  useEffect(
    () => () => {
      throttle.cancel()
      // The panel collapsed mid-drag (its key, say): the size reached so far stands, so the row's live size and the
      // remembered one agree when it opens again.
      const now = drag.current
      drag.current = null
      if (now && now.size !== now.startSize) latest.current.onCommit(now.size)
    },
    [throttle],
  )
  return throttle
}

export function useSplitterDrag(input: Input) {
  const latest = useRef(input)
  latest.current = input
  const drag = useRef<Drag | null>(null)
  // The size the drag has reached, for the separator's aria-valuenow; null while not dragging.
  const [dragged, setDragged] = useState<number | null>(null)
  const throttle = useDragFrames(latest, drag, setDragged)
  const end = (event: PointerEvent, keep: boolean) => {
    const now = drag.current
    if (!now || now.pointerId !== event.pointerId) return
    if (keep) throttle.flush()
    else throttle.cancel()
    drag.current = null
    setDragged(null)
    if (!keep) latest.current.onLive(now.startSize)
    else if (now.size !== now.startSize) latest.current.onCommit(now.size)
  }
  const handlers = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0 || drag.current) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const { size, edge } = latest.current
      drag.current = { pointerId: event.pointerId, from: along(edge, event), startSize: size, size }
      setDragged(size)
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if (drag.current?.pointerId === event.pointerId) throttle.push(along(latest.current.edge, event))
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => end(event, true),
    // Capture lost without a release (the element went away): the size reached so far stands.
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => end(event, true),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => end(event, false),
  }
  return { dragging: dragged !== null, value: dragged ?? input.size, handlers }
}
