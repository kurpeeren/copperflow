// Dragging the PCB's copper, from press to release: a track's segment or corner (copper-geometry.ts reshapes it), or a
// via (copper-edits.ts moves it with the ends of its tracks). The drag works from the shapes at the press and the
// pointer's whole move, gives the shapes to draw live, and at the release one layout edit list, so one history entry.
// Pure; plain TypeScript with .js imports, so the tests can run it.
import type { LayoutEdit } from "../../../src/core/layout-records.js"
import { roundPosition, snapPosition, type Point } from "./geometry.js"
import { copperGrip, type CopperGrip, type CopperHit } from "./copper-hit.js"
import { moveCopper, NO_SHAPES, reshapeEdit, type CopperRecords, type CopperShapesById, type OnPad } from "./copper-edits.js"
import { trackDragPath } from "./copper-geometry.js"
import type { DragGrid } from "./wire-drag.js"

export interface CopperDrag {
  kind: CopperHit["kind"]
  id: string
  /** A track's: what was grabbed, and its points at the press. */
  grip?: CopperGrip
  points?: readonly Point[]
  /** A via's centre at the press. */
  at?: Point
  /** Where the press was, in CSS pixels. */
  start: Point
  moved: boolean
  /** Why the copper cannot move; it is told on the first move. */
  blocker: string | null
  /** The track's path now, once it moved. */
  path?: Point[]
  /** How far the via has moved, once it moved. */
  offset: Point
}

/** The press: where in the world and on the screen, the zoom, whether the track was selected alone (its corners have handles), and its width. */
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
  return { ...base, kind: "track", grip, points: track.points, blocker: track.locked ? `${track.id} is locked` : null }
}

/** The drag after the pointer moved past the drag threshold by `moved` (mm); blocked copper stays and tells why, once. */
export function followCopperDrag(drag: CopperDrag, moved: Point, grid: DragGrid, notify: (text: string) => void): CopperDrag {
  if (drag.blocker) {
    if (!drag.moved) notify(drag.blocker)
    return { ...drag, moved: true }
  }
  if (drag.kind === "track" && drag.points && drag.grip) return { ...drag, moved: true, path: trackDragPath(drag.points, drag.grip, moved, grid) }
  const at = drag.at ?? ZERO
  const snapped = (value: number) => snapPosition(value, grid.step, grid.snap)
  return { ...drag, moved: true, offset: { x: roundPosition(snapped(at.x + moved.x) - at.x), y: roundPosition(snapped(at.y + moved.y) - at.y) } }
}

/** The shapes the drag gives now, drawn in place of the copper's own. */
export function copperDragShapes(drag: CopperDrag, records: CopperRecords, onPad: OnPad): CopperShapesById {
  if (!drag.moved || drag.blocker) return NO_SHAPES
  if (drag.kind === "track") return drag.path ? { tracks: new Map([[drag.id, drag.path]]), vias: new Map() } : NO_SHAPES
  return moveCopper(records, [drag.id], drag.offset, onPad).shapes
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
  const move = moveCopper(records, [drag.id], drag.offset, onPad)
  if (move.edits.length === 0) return move.skipped.length > 0 ? { message: move.skipped.join("; ") } : undefined
  const to = move.shapes.vias.get(drag.id) ?? ZERO
  return { edits: move.edits, summary: `Move via ${drag.id} to (${to.x}, ${to.y})`, shapes: move.shapes }
}
