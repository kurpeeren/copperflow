// The hover label on either canvas: a DOM element over the canvas, so its text is crisp and in the chrome's font,
// styled by theme tokens (hover-label.css). hover-rest.ts decides when it shows and hides; this drives it with the
// clock, the keyboard, the pointer's presses and leaves, and the tool that is drawing.
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react"
import type { Point } from "./geometry"
import type { HoverTarget } from "./hover-label"
import { HOVER_IDLE, placeLabel, restDue, restStep, shownLabel, type RestState } from "./hover-rest"
import "./hover-label.css"

/** A timer may fire a moment early; waiting this much longer makes sure its tick finds the rest over. */
const TIMER_SLACK_MS = 1

const now = (): number => performance.now()

export interface HoverLabelInput {
  /** View → Hover labels. */
  enabled: boolean
  /** A tool is drawing (a track, a wire, a shape): the status line already says what it meets. */
  busy: boolean
}

/** The label's state, and what the canvas tells it: the target under the pointer (`at` in canvas pixels), a leave, a press. */
export function useHoverLabel({ enabled, busy }: HoverLabelInput) {
  const [state, dispatch] = useReducer(restStep, HOVER_IDLE)
  const quiet = useRef(!enabled || busy)
  quiet.current = !enabled || busy
  useEffect(() => {
    if (!enabled || busy) dispatch({ kind: "busy" })
  }, [enabled, busy])
  useEffect(() => {
    const due = restDue(state, now())
    if (due === undefined) return
    const id = window.setTimeout(() => dispatch({ kind: "tick", now: now() }), due + TIMER_SLACK_MS)
    return () => window.clearTimeout(id)
  }, [state])
  useEffect(() => {
    // Any key hides it, before the canvas or a menu acts on the key.
    const onKey = () => dispatch({ kind: "key" })
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])
  const move = useCallback((target: HoverTarget | undefined, at: Point) => {
    if (!quiet.current) dispatch({ kind: "move", target, at, now: now() })
  }, [])
  const leave = useCallback(() => dispatch({ kind: "leave" }), [])
  const press = useCallback(() => dispatch({ kind: "press" }), [])
  return { state, move, leave, press }
}

/** The canvas's pointer handlers with a press that hides the label before the canvas acts on it. */
export function hidingOnPress<H extends { onPointerDown: (...args: never[]) => void }>(handlers: H, press: () => void): H {
  const down = handlers.onPointerDown
  const onPointerDown = (...args: Parameters<H["onPointerDown"]>) => {
    press()
    down(...args)
  }
  return { ...handlers, onPointerDown }
}

/** The label itself, where hover-rest.ts puts it (kept inside the canvas once its size is known); nothing while it is hidden. */
export function HoverLabel({ state }: { state: RestState }) {
  const shown = shownLabel(state)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    const area = element?.parentElement
    if (!element || !area || !shown) return
    const placed = placeLabel(shown, { width: element.offsetWidth, height: element.offsetHeight }, { width: area.clientWidth, height: area.clientHeight })
    element.style.left = `${placed.left}px`
    element.style.top = `${placed.top}px`
  })
  if (!shown) return null
  return (
    <div ref={ref} className="hover-label" role="tooltip" style={{ left: shown.left, top: shown.top }}>
      {shown.text}
    </div>
  )
}
