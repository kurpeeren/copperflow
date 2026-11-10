// When the hover label shows: after the pointer rests 250 ms, on what is under it then (hover-label.ts hoverTarget,
// asked once, when the rest is over), 12 px right-below the pointer; it follows the pointer while the pointer stays over
// that target (hover-label.ts stillOver, which asks that one thing alone). It hides when the pointer leaves the target
// or the canvas, on any key, a press, the wheel, a change of camera or design, and while a tool is drawing. A key or a
// press keeps it hidden on that target until the pointer leaves it. Pure transitions, so the tests run them without a
// DOM or a clock; hover-driver.ts drives them.
import type { Point } from "./geometry.js"
import type { HoverTarget } from "./hover-label.js"

/** How long the pointer rests before the label of what is under it shows, in ms. */
export const REST_MS = 250
/** How far right and below the pointer the label's corner sits, in CSS pixels. */
export const LABEL_OFFSET_PX = 12

export type RestState =
  | { phase: "idle" }
  /** The pointer is resting at `at` (canvas pixels) since `since`; nothing is picked yet. */
  | { phase: "waiting"; at: Point; since: number }
  | { phase: "shown"; target: HoverTarget; at: Point }
  /** Hidden by a key or a press, until the pointer leaves the target. */
  | { phase: "dismissed"; target: HoverTarget }

/** `at` is the pointer in the canvas's CSS pixels; `now` in ms. */
export type RestEvent =
  /** `still`: the pointer is still over the shown or dismissed target (stillOver); ignored otherwise. */
  | { kind: "move"; at: Point; now: number; still: boolean }
  /** The rest timer fired; `target` is what is under the pointer now (hoverTarget), picked only for this tick. */
  | { kind: "tick"; now: number; target: HoverTarget | undefined }
  | { kind: "leave" }
  | { kind: "key" }
  | { kind: "press" }
  /** The wheel turned, the camera moved or the design changed: what is under the pointer is no longer known. */
  | { kind: "stale" }
  /** A tool is drawing, or View → Hover labels is off. */
  | { kind: "busy" }

export const HOVER_IDLE: RestState = { phase: "idle" }

function moved(state: RestState, at: Point, now: number, still: boolean): RestState {
  if (state.phase === "shown" && still) return { ...state, at }
  if (state.phase === "dismissed" && still) return state
  return { phase: "waiting", at, since: now }
}

/** The state after `event`. */
export function restStep(state: RestState, event: RestEvent): RestState {
  switch (event.kind) {
    case "move":
      return moved(state, event.at, event.now, event.still)
    case "tick":
      if (state.phase !== "waiting" || event.now - state.since < REST_MS) return state
      return event.target ? { phase: "shown", target: event.target, at: state.at } : HOVER_IDLE
    case "key":
    case "press":
      return state.phase === "shown" || state.phase === "dismissed" ? { phase: "dismissed", target: state.target } : HOVER_IDLE
    case "leave":
    case "stale":
    case "busy":
      return HOVER_IDLE
  }
}

/** How long until the rest is over, in ms; undefined when the pointer is not resting. */
export function restDue(state: RestState, now: number): number | undefined {
  return state.phase === "waiting" ? Math.max(0, state.since + REST_MS - now) : undefined
}

/** Whether a move needs the still-over check: only while a target is shown or dismissed. */
export const watchesTarget = (state: RestState): state is Extract<RestState, { target: HoverTarget }> => state.phase === "shown" || state.phase === "dismissed"

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
