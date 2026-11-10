// When the hover label shows: after the pointer rests 250 ms on the same target (hover-label.ts), 12 px right-below
// the pointer, following it while the target stays; it hides when the pointer leaves the target or the canvas, on any
// key, on a press, and while a tool is drawing. A key or a press keeps it hidden on that target until the pointer
// reaches another. Pure transitions, so the tests run them without a DOM or a clock; HoverLabel.tsx drives them.
import type { Point } from "./geometry.js"
import type { HoverTarget } from "./hover-label.js"

/** How long the pointer rests on a target before its label shows, in ms. */
export const REST_MS = 250
/** How far right and below the pointer the label's corner sits, in CSS pixels. */
export const LABEL_OFFSET_PX = 12

export type RestState =
  | { phase: "idle" }
  | { phase: "waiting"; target: HoverTarget; at: Point; since: number }
  | { phase: "shown"; target: HoverTarget; at: Point }
  /** Hidden by a key or a press, until the pointer reaches another target. */
  | { phase: "dismissed"; target: HoverTarget }

/** `at` is the pointer in the canvas's CSS pixels; `now` in ms. */
export type RestEvent =
  | { kind: "move"; target: HoverTarget | undefined; at: Point; now: number }
  | { kind: "tick"; now: number }
  | { kind: "leave" }
  | { kind: "key" }
  | { kind: "press" }
  /** A tool is drawing, or View → Hover labels is off. */
  | { kind: "busy" }

export const HOVER_IDLE: RestState = { phase: "idle" }

const same = (a: HoverTarget, b: HoverTarget): boolean => a.kind === b.kind && a.id === b.id

function moved(state: RestState, target: HoverTarget | undefined, at: Point, now: number): RestState {
  if (!target) return HOVER_IDLE
  if (state.phase === "idle" || !same(state.target, target)) return { phase: "waiting", target, at, since: now }
  if (state.phase === "dismissed") return state
  return { ...state, target, at }
}

/** The state after `event`. */
export function restStep(state: RestState, event: RestEvent): RestState {
  switch (event.kind) {
    case "move":
      return moved(state, event.target, event.at, event.now)
    case "tick":
      return state.phase === "waiting" && event.now - state.since >= REST_MS ? { phase: "shown", target: state.target, at: state.at } : state
    case "key":
    case "press":
      return state.phase === "idle" ? state : { phase: "dismissed", target: state.target }
    case "leave":
    case "busy":
      return HOVER_IDLE
  }
}

/** How long until a waiting label shows, in ms; undefined when nothing waits. */
export function restDue(state: RestState, now: number): number | undefined {
  return state.phase === "waiting" ? Math.max(0, state.since + REST_MS - now) : undefined
}

/** The label to draw, with its corner in the canvas's CSS pixels; undefined while hidden. */
export function shownLabel(state: RestState): { text: string; left: number; top: number } | undefined {
  if (state.phase !== "shown") return undefined
  return { text: state.target.text, left: state.at.x + LABEL_OFFSET_PX, top: state.at.y + LABEL_OFFSET_PX }
}

/**
 * Where the label's corner goes for a label of `label` size in a canvas of `area` size: right-below the pointer, or
 * left of it (above it) when it would run past the right (bottom) edge, and never past the top left corner.
 */
export function placeLabel(corner: { left: number; top: number }, label: { width: number; height: number }, area: { width: number; height: number }): { left: number; top: number } {
  const flip = (start: number, size: number, room: number) => (start + size > room ? Math.max(0, start - 2 * LABEL_OFFSET_PX - size) : start)
  return { left: flip(corner.left, label.width, area.width), top: flip(corner.top, label.height, area.height) }
}
