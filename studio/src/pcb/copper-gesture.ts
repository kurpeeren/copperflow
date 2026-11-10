// Dragging the PCB's copper, from press to release: a track's segment or corner (copper-geometry.ts reshapes it), or a
// via (copper-edits.ts moves it with the ends of its tracks). The drag works from the shapes at the press and the
// pointer's whole move, gives the shapes to draw live, and at the release one layout edit list, so one history entry.
// A press on the segment selected alone (a double click picked it) drags it as any segment, and keeps it selected.
// Pure; plain TypeScript with .js imports, so the tests can run it.
import type { LayoutEdit } from "../../../src/core/layout-records.js"
import { roundPosition, snapPosition, type Point } from "./geometry.js"
import { copperGrip, type CopperGrip, type CopperHit } from "./copper-hit.js"
import { moveCopper, NO_SHAPES, reshapeEdit, type CopperRecords, type CopperShapesById, type OnPad } from "./copper-edits.js"
import { trackDragPath } from "./copper-geometry.js"
import { nameList } from "./group-edits.js"
import type { DragGrid } from "./wire-drag.js"
import { nearestSegment } from "./wire-hit.js"
import type { SelectionChange, TrackSegment } from "../selection.js"

export interface CopperDrag {
  /** A track's reshape, a via's move, or the selection's parts and copper moved together ("group"). */
  kind: CopperHit["kind"] | "group"
  /** The track or via pressed; for a group, the copper pressed, or empty when a part was pressed. */
  id: string
  /** For a group pressed on a part: that part, which a release that did not move selects alone. */
  part?: string
  /** A track's: what was grabbed, and its points at the press. */
  grip?: CopperGrip
  points?: readonly Point[]
  /** A track's: where on it the press was (mm), and the pointer's move from there once it moved. */
  world?: Point
  last?: Point
  /** A track's: the index of the selected segment the press grabbed, which stays selected. */
  segment?: number
  /** A via's centre at the press. */
  at?: Point
  /** Where the press was, in world units (mm); the drag threshold is measured from it at the camera's scale. */
  start: Point
  moved: boolean
  /** Why the copper cannot move; it is told on the first move. */
  blocker: string | null
  /** The track's path now, once it moved. */
  path?: Point[]
  /** How far the via, or the group, has moved, once it moved. */
  offset: Point
  /** A group's parts and copper, and the pressed part's origin (snapped to the grid) when a part was pressed. */
  names?: readonly string[]
  copper?: readonly string[]
  origin?: Point
}

/** The press: where in the world (and `point`, the same, kept for the threshold), the zoom, whether the track was selected alone (its corners have handles), and its width. */
export interface CopperPress {
  world: Point
  point: Point
  scale: number
  sole: boolean
  width: number
}

/** A change ready to send: its edits, the history's summary, and the shapes drawn until its build lands. */
export interface CopperChange {
  edits: LayoutEdit[]
  summary: string
  shapes: CopperShapesById
}

const ZERO: Point = { x: 0, y: 0 }

/** The drag a press on `hit` starts; undefined when the copper is gone or the press grabs none of the track. */
export function startCopperDrag(hit: CopperHit, records: CopperRecords, press: CopperPress): CopperDrag | undefined {
  const base = { id: hit.id, start: press.point, moved: false, offset: ZERO }
  if (hit.kind === "via") {
    const via = records.vias.find((one) => one.id === hit.id)
    return via && { ...base, kind: "via", at: via.at, blocker: via.locked ? `${via.id} is locked` : null }
  }
  const track = records.tracks.find((one) => one.id === hit.id)
  const grip = track && copperGrip(track.points, press.world, press.scale, press.sole, press.width)
  if (!track || !grip) return undefined
  return { ...base, kind: "track", grip, points: track.points, world: press.world, blocker: track.locked ? `${track.id} is locked` : null }
}

/** The drag keeping `selected` when it is the segment of this track the press grabbed; else the drag as it was. */
export function keepSegment(drag: CopperDrag, selected: TrackSegment | undefined): CopperDrag {
  const grabbed = drag.kind === "track" && drag.grip?.kind === "segment" && selected?.id === drag.id && selected.index === drag.grip.index
  return grabbed ? { ...drag, segment: selected.index } : drag
}

/**
 * What a release does to a selected segment the drag grabbed: a still click selects the whole track; a move keeps the
 * dragged segment selected, at its index in the new path (the one nearest the pointer). Undefined for any other drag.
 */
export function segmentAfterDrag(drag: CopperDrag): SelectionChange | undefined {
  if (drag.kind !== "track" || drag.segment === undefined) return undefined
  const { id } = drag
  if (!drag.moved) return (current) => current.onlyCopper(id)
  if (!drag.path || !drag.world || !drag.last) return undefined
  const index = nearestSegment(drag.path, { x: drag.world.x + drag.last.x, y: drag.world.y + drag.last.y })?.index
  return index === undefined ? undefined : (current) => current.onlySegment(id, index)
}

/**
 * A drag of the selection's parts and copper together, from a press on selected copper or on a selected part
 * (`origin`, its position, which then lands on the grid; from copper the offset is whole grid steps).
 */
export function startGroupDrag(group: { id?: string; part?: string; names: readonly string[]; copper: readonly string[]; start: Point; origin?: Point }): CopperDrag {
  const { id = "", part, names, copper, start, origin } = group
  return { kind: "group", id, start, moved: false, blocker: null, offset: ZERO, names, copper, ...(part === undefined ? {} : { part }), ...(origin ? { origin } : {}) }
}

/** The offset that puts `at` moved by `moved` on the grid. */
function snappedOffset(at: Point, moved: Point, grid: DragGrid): Point {
  const snapped = (value: number) => snapPosition(value, grid.step, grid.snap)
  return { x: roundPosition(snapped(at.x + moved.x) - at.x), y: roundPosition(snapped(at.y + moved.y) - at.y) }
}

/** The drag after the pointer moved past the drag threshold by `moved` (mm); blocked copper stays and tells why, once. */
export function followCopperDrag(drag: CopperDrag, moved: Point, grid: DragGrid, notify: (text: string) => void): CopperDrag {
  if (drag.blocker) {
    if (!drag.moved) notify(drag.blocker)
    return { ...drag, moved: true }
  }
  if (drag.kind === "track" && drag.points && drag.grip) return { ...drag, moved: true, last: moved, path: trackDragPath(drag.points, drag.grip, moved, grid) }
  return { ...drag, moved: true, offset: snappedOffset(drag.at ?? drag.origin ?? ZERO, moved, grid) }
}

/** The ids the drag moves as a whole: the via, or the group's copper. */
const movedCopper = (drag: CopperDrag): readonly string[] => (drag.kind === "group" ? (drag.copper ?? []) : [drag.id])

/** The shapes the drag gives now, drawn in place of the copper's own. */
export function copperDragShapes(drag: CopperDrag, records: CopperRecords, onPad: OnPad): CopperShapesById {
  if (!drag.moved || drag.blocker) return NO_SHAPES
  if (drag.kind === "track") return drag.path ? { tracks: new Map([[drag.id, drag.path]]), vias: new Map() } : NO_SHAPES
  return moveCopper(records, movedCopper(drag), drag.offset, onPad).shapes
}

/** A moved group's parts and offset, which go to the circuit file in their own change; undefined otherwise. */
export function groupParts(drag: CopperDrag): { names: readonly string[]; offset: Point } | undefined {
  const moved = drag.offset.x !== 0 || drag.offset.y !== 0
  return drag.kind === "group" && drag.moved && moved && (drag.names?.length ?? 0) > 0 ? { names: drag.names ?? [], offset: drag.offset } : undefined
}

/** The change a release writes, why nothing could be written, or undefined when there is nothing to write. */
export function endCopperDrag(drag: CopperDrag, records: CopperRecords, onPad: OnPad): CopperChange | { message: string } | undefined {
  if (!drag.moved || drag.blocker) return undefined
  if (drag.kind === "track") {
    const track = records.tracks.find((one) => one.id === drag.id)
    const edit = track && drag.path ? reshapeEdit(track, drag.path) : undefined
    if (!edit || "message" in edit) return edit
    return { edits: [edit], summary: `Reshape track ${drag.id}`, shapes: copperDragShapes(drag, records, onPad) }
  }
  const ids = movedCopper(drag)
  const move = moveCopper(records, ids, drag.offset, onPad)
  if (move.edits.length === 0) return move.skipped.length > 0 ? { message: move.skipped.join("; ") } : undefined
  const to = move.shapes.vias.get(drag.id) ?? ZERO
  const summary = drag.kind === "group" ? `Move ${nameList(ids)} by (${drag.offset.x}, ${drag.offset.y})` : `Move via ${drag.id} to (${to.x}, ${to.y})`
  return { edits: move.edits, summary, shapes: move.shapes }
}
