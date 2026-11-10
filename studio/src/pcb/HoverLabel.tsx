// The hover label on either canvas: a DOM element over the canvas, so its text is crisp and in the chrome's font,
// styled by theme tokens (hover-label.css). hover-rest.ts decides when it shows and hides, and hover-driver.ts drives
// it; this gives the driver the browser's clock and keyboard, and the canvas's tool, camera and design.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { Point } from "./geometry"
import { createHoverDriver, type HoverDriver, type HoverEnv, type HoverProbe } from "./hover-driver"
import { HOVER_IDLE, placeLabel, shownLabel, type RestState } from "./hover-rest"
import "./hover-label.css"

/** The browser's clock, timers and keyboard; a key is heard in the capture phase, before the canvas or a menu acts on it. */
const BROWSER: HoverEnv = {
  now: () => performance.now(),
  setTimer: (run, ms) => window.setTimeout(run, ms),
  clearTimer: (id) => window.clearTimeout(id as number),
  listenKeys: (run) => {
    window.addEventListener("keydown", run, true)
    return () => window.removeEventListener("keydown", run, true)
  },
}

export interface HoverLabelInput {
  /** View → Hover labels. */
  enabled: boolean
  /** A tool is drawing (a track, a wire, a shape): the status line already says what it meets. */
  busy: boolean
  /** What is under a point, and whether a point is still over a target, for the scene as drawn now. */
  probe: HoverProbe | undefined
  /** The camera and the design: when either changes, what is under the pointer is no longer known and the label hides. */
  camera: unknown
  design: unknown
}

type Label = Pick<HoverDriver, "move" | "leave" | "press" | "stale" | "over">

/** The label's state, and what the canvas tells it (hover-driver.ts); the driver lives as long as the canvas. */
export function useHoverLabel({ enabled, busy, probe, camera, design }: HoverLabelInput): { state: RestState } & Label {
  const [state, setState] = useState<RestState>(HOVER_IDLE)
  const probeRef = useRef(probe)
  probeRef.current = probe
  const driver = useRef<HoverDriver | undefined>(undefined)
  useEffect(() => {
    const made = createHoverDriver(BROWSER, setState, () => probeRef.current)
    driver.current = made
    return () => {
      made.dispose()
      driver.current = undefined
    }
  }, [])
  useEffect(() => driver.current?.quiet(!enabled || busy), [enabled, busy])
  useEffect(() => driver.current?.stale(), [camera, design])
  const label = useMemo<Label>(
    () => ({
      move: (world: Point, at: Point) => driver.current?.move(world, at),
      leave: () => driver.current?.leave(),
      press: () => driver.current?.press(),
      stale: () => driver.current?.stale(),
      over: (on: boolean) => driver.current?.over(on),
    }),
    [],
  )
  return { state, ...label }
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
