// Drives the hover label's transitions (hover-rest.ts) with a clock, a timer and the keyboard, which come in as an
// environment so the tests run it without a DOM. A move picks nothing: the pick (hover-label.ts hoverTarget) runs once,
// when the rest timer fires; while a label shows, a move asks only whether the pointer is still over that one target
// (stillOver). HoverLabel.tsx wires it to React and the canvases.
import type { Point } from "./geometry.js"
import type { HoverTarget } from "./hover-label.js"
import { HOVER_IDLE, restDue, restStep, watchesTarget, type RestEvent, type RestState } from "./hover-rest.js"

/** A timer may fire a moment early; waiting this much longer makes sure its tick finds the rest over. */
const TIMER_SLACK_MS = 1

/** The clock, a one-shot timer and the keyboard. */
export interface HoverEnv {
  now(): number
  setTimer(run: () => void, ms: number): unknown
  clearTimer(id: unknown): void
  /** Calls `run` on every key pressed (before the canvas or a menu acts on it); returns how to stop. */
  listenKeys(run: () => void): () => void
}

/** The canvas's questions: what is under a world point, and whether a point is still over a target. */
export interface HoverProbe {
  pick(world: Point): HoverTarget | undefined
  still(target: HoverTarget, world: Point): boolean
}

export interface HoverDriver {
  /** The pointer moved to `world` (`at` in canvas pixels). */
  move(world: Point, at: Point): void
  leave(): void
  press(): void
  /** The wheel turned, or the camera or the design changed. */
  stale(): void
  /** A tool is drawing, or the labels are off: hidden, and moves are ignored. */
  quiet(on: boolean): void
  /** Whether the pointer is over the canvas itself, not an overlay on it: off it, the label hides and moves are ignored. */
  over(on: boolean): void
  /** Stops the timer and the key listener. */
  dispose(): void
}

/** A driver that reports each new state to `show`; `probe` gives the canvas's current questions. */
export function createHoverDriver(env: HoverEnv, show: (state: RestState) => void, probe: () => HoverProbe | undefined): HoverDriver {
  let state: RestState = HOVER_IDLE
  let world: Point | undefined
  let timer: unknown
  let silent = false
  let offCanvas = false
  const clear = () => {
    if (timer !== undefined) env.clearTimer(timer)
    timer = undefined
  }
  const schedule = () => {
    clear()
    const due = restDue(state, env.now())
    if (due !== undefined) timer = env.setTimer(fire, due + TIMER_SLACK_MS)
  }
  const step = (event: RestEvent) => {
    const next = restStep(state, event)
    if (next !== state) {
      state = next
      show(state)
    }
    schedule()
  }
  function fire() {
    timer = undefined
    step({ kind: "tick", now: env.now(), target: world && probe()?.pick(world) })
  }
  const stopKeys = env.listenKeys(() => step({ kind: "key" }))
  return {
    move(to, at) {
      if (silent || offCanvas) return
      world = to
      const current = probe()
      const still = watchesTarget(state) && current !== undefined && current.still(state.target, to)
      step({ kind: "move", at, now: env.now(), still })
    },
    leave: () => step({ kind: "leave" }),
    press: () => step({ kind: "press" }),
    stale: () => step({ kind: "stale" }),
    quiet(on) {
      silent = on
      if (on) step({ kind: "busy" })
    },
    over(on) {
      if (!on && !offCanvas) step({ kind: "leave" })
      offCanvas = !on
    },
    dispose() {
      clear()
      stopKeys()
    },
  }
}

/** The canvas's pointer handlers, reporting to the driver: a press hides the label, so does the wheel, and a move over an overlay (its target is not `canvas`) is not a move over the canvas. */
export function withHoverLabel<H extends { onPointerDown: (...args: never[]) => void; onPointerMove: (...args: never[]) => void }>(
  handlers: H,
  label: Pick<HoverDriver, "press" | "stale" | "over">,
  canvas?: { current: unknown },
): H & { onWheel(): void } {
  const { onPointerDown: down, onPointerMove: move } = handlers
  const onPointerDown = (...args: Parameters<H["onPointerDown"]>) => {
    label.press()
    down(...args)
  }
  const onPointerMove = (...args: Parameters<H["onPointerMove"]>) => {
    const event = args[0] as { target?: unknown } | undefined
    if (canvas) label.over(event?.target === canvas.current)
    move(...args)
  }
  return { ...handlers, onPointerDown, onPointerMove, onWheel: () => label.stale() }
}
