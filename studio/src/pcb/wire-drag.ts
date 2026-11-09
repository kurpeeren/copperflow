// Dragging a schematic wire to reshape it, as a canvas gesture: what a press grabs (the selected wire's corner handle,
// else the segment under the pointer), the path the pointer's move gives (on the grid while Snap is on), and the
// gesture from press to release. wire-geometry.ts moves the points; the canvas writes the shape (use-wire-reshape.ts).
// Plain TypeScript with .js imports, so the tests can run it.
import { snapPosition, type Point } from "./geometry.js"
import { canPick, type PickContext } from "./pick.js"
import { dragCorner, dragSegment, tidy } from "./wire-geometry.js"
import { samePath } from "./wire-shape.js"
import { cornerAt, segmentAt, wireReachPx, type WireLine } from "./wire-hit.js"
import { WIRE_HANDLE_PX } from "./wire-overlay.js"

/** What a press holds of a wire: one of its segments (from point `index` to the next), or the corner at point `index`. */
export type WireGrip = { kind: "segment" | "corner"; index: number }

/** What a gesture asks of the schematic's wires to reshape them. */
export interface WireDrag {
  /** The wire's points as shown, first to last; undefined when the sheet has no such wire. */
  points(id: string): readonly Point[] | undefined
  /** Why the wire's shape cannot be saved, or null. */
  blocker(id: string): string | null
  /** Writes `path` as the wire's new shape. */
  commit(id: string, path: readonly Point[]): void
}

/** A wire being reshaped: what was grabbed, the wire's points at the press, and the path the pointer gives now. */
export interface ReshapeGesture {
  kind: "reshape"
  wire: string
  grip: WireGrip
  /** The points at the press; every move works from them and the pointer's whole move. */
  points: readonly Point[]
  path: readonly Point[]
  /** Where the press was, in CSS pixels. */
  start: Point
  moved: boolean
  /** Why the wire cannot be reshaped: it does not move, and the reason is told on the first move. */
  blocker: string | null
}

/** The grid a drag lands on: its step, and whether Snap is on. */
export interface DragGrid {
  step: number
  snap: boolean
}

/** How far from a corner's centre its square handle reaches each way, in sheet units, at this zoom. */
export const handleReach = (scale: number): number => WIRE_HANDLE_PX / 2 / scale

/** How far from a segment a press still grabs it, in sheet units: the reach that picks the wire. */
const segmentReach = (scale: number): number => wireReachPx(scale) / scale

/** The corner handle of the selected wire `selected` under `world`: the wire's id and the corner's index in its points. */
export function cornerHandleAt(drag: WireDrag | undefined, selected: string | undefined, world: Point, scale: number): { id: string; index: number } | undefined {
  const points = selected === undefined ? undefined : drag?.points(selected)
  const index = points ? cornerAt(points, world, handleReach(scale)) : undefined
  return selected === undefined || index === undefined ? undefined : { id: selected, index }
}

/**
 * The selected wire's corner handle under `world`, when a pick made with `context` may take a wire (pick.ts): not with
 * Wires off in the Filter tab, nor with the Note box or Fit area tool armed. Handles are drawn over everything, so they
 * come before what else is under the pointer.
 */
export function handleUnder(drag: WireDrag | undefined, context: PickContext, world: Point, scale: number): { id: string; index: number } | undefined {
  const id = context.selection.wire
  if (id === undefined || !canPick({ kind: "wire", id }, context)) return undefined
  return cornerHandleAt(drag, id, world, scale)
}

/** What a press at `world` grabs of a wire with `points`: the corner handle pressed (`corner`), else the segment under it. */
export function gripOf(points: readonly Point[], world: Point, scale: number, corner?: number): WireGrip | undefined {
  if (corner !== undefined) return { kind: "corner", index: corner }
  const index = segmentAt(points, world, segmentReach(scale))
  return index === undefined ? undefined : { kind: "segment", index }
}

/**
 * The path after the pointer moved by `moved` (sheet units) from the press. The grabbed point lands on the grid while
 * Snap is on (a segment on a grid line, a corner on a grid point), not just moves by a whole number of steps; with
 * Snap off it is only rounded to 4 decimals.
 */
export function draggedPath(points: readonly Point[], grip: WireGrip, moved: Point, grid: DragGrid): Point[] {
  const at = points[grip.index]
  if (!at) return tidy(points)
  const to = { x: snapPosition(at.x + moved.x, grid.step, grid.snap), y: snapPosition(at.y + moved.y, grid.step, grid.snap) }
  if (grip.kind === "corner") return dragCorner(points, grip.index, to)
  return dragSegment(points, grip.index, { x: to.x - at.x, y: to.y - at.y })
}

/** A reshape of wire `id` from a press at `start` (CSS pixels); undefined when the sheet has no such wire. */
export function startReshape(drag: WireDrag | undefined, id: string, grip: WireGrip, start: Point): ReshapeGesture | undefined {
  const points = drag?.points(id)
  if (!drag || !points) return undefined
  return { kind: "reshape", wire: id, grip, points, path: points, start, moved: false, blocker: drag.blocker(id) }
}

/** The reshape after the pointer moved past the drag threshold by `moved`; a blocked wire stays and tells why, once. */
export function followReshape(gesture: ReshapeGesture, moved: Point, grid: DragGrid, notify: (text: string) => void): ReshapeGesture {
  if (gesture.blocker) {
    if (!gesture.moved) notify(gesture.blocker)
    return { ...gesture, moved: true }
  }
  return { ...gesture, moved: true, path: draggedPath(gesture.points, gesture.grip, moved, grid) }
}

/** What a release says when the wire is no longer the one pressed. */
export const WIRE_CHANGED = "The wire changed while you dragged it; try again"

/**
 * Finishes a reshape: a moved, unblocked wire whose path changed is written; anything else writes nothing. A build
 * that landed during the drag can change the wire under its id (a wire Studio draws is named by its place among its
 * net's wires), so a wire whose shown points are no longer those pressed is not written, and the release says why.
 * Without drag tools (the W tool took over) the drag was dropped and nothing is said.
 */
export function endReshape(drag: WireDrag | undefined, done: ReshapeGesture, notify: (text: string) => void): void {
  if (!drag || !done.moved || done.blocker || samePath(done.path, tidy(done.points))) return
  const now = drag.points(done.wire)
  if (!now || !samePath(now, done.points)) return notify(WIRE_CHANGED)
  drag.commit(done.wire, done.path)
}

/** The shapes drawn in place of the wires' own: the wire being dragged (once it moved, unless blocked), then those sent and waiting for their build. */
export function liveShapes(dragged: ReshapeGesture | undefined, pending: readonly WireLine[]): readonly WireLine[] {
  if (!dragged?.moved || dragged.blocker) return pending
  return [{ id: dragged.wire, points: dragged.path }, ...pending.filter((shape) => shape.id !== dragged.wire)]
}

/** The wires with the shapes in `shapes` in place of their own (the first shape of a wire wins). */
export function withShapes<W extends WireLine>(wires: readonly W[], shapes: readonly WireLine[]): readonly W[] {
  if (shapes.length === 0) return wires
  return wires.map((wire) => {
    const shape = shapes.find((candidate) => candidate.id === wire.id)
    // Only the points change; the copy keeps the wire's own type for the drawing.
    return shape ? ({ ...wire, points: [...shape.points] } as W) : wire
  })
}
