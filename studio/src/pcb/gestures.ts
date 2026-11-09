// The steps of a pointer gesture on either canvas, from press to release. press.ts decides what a press starts; these
// follow the pointer and finish the gesture: a pan, a drag of the selection or of a net label, a selection box, or
// the armed Note box tool's box. gestureSession holds the gesture between events; use-canvas-gestures.ts draws it.
// Plain TypeScript with .js imports, so the tests can run it.
import type { NetLabel } from "../../../src/engine/schematic.js"
import type { Selection, SelectionChange } from "../selection.js"
import { boxMode, boxSelection, partsInBox } from "./box-select.js"
import { hitsAt, roundPosition, screenToWorld, snapPosition, type Camera, type PartBox, type Point, type Size } from "./geometry.js"
import type { PickLayers } from "./layers.js"
import type { PickFilter } from "./pick-filter.js"
import { anchorLookup, moveEach, type GroupEdit, type GroupEditActions } from "./group-edits.js"
import { VIEWS, ZERO, type Anchor, type SourceCircuit, type View } from "./positions.js"
import { areaCamera } from "./view-fit.js"
import { picks, type Pickable, type PickContext } from "./pick.js"
import { gestureStart, hasMoved, stillRelease, type ArmedTool, type ContextTarget, type GestureStart, type Press, type StillRelease, type Under } from "./press.js"

export type Gesture =
  | { kind: "pan"; start: Point; camera: Camera; moved: boolean; still: StillRelease; target: ContextTarget }
  | {
      kind: "drag"
      /** The part pressed; its origin snaps to the grid and the rest move by the same offset. */
      part: PartBox
      /** Every part the drag moves, and those of them that may move. */
      names: readonly string[]
      movable: readonly string[]
      start: Point
      offset: Point
      moved: boolean
      /** Why the pressed part may not move; it stops the whole drag. */
      blocker: string | null
      still: StillRelease
    }
  | { kind: "label"; label: NetLabel; start: Point; at: Point; moved: boolean; blocker: string | null }
  | { kind: "box"; start: Point; current: Point; adds: boolean; still: StillRelease }
  | { kind: "note"; start: Point; current: Point }
  | { kind: "zoom"; start: Point; current: Point }

/** What the gestures ask of Studio's actions: the edit of a move, the toast, and a note for the agent. */
export interface GestureActions extends GroupEditActions {
  mark(text: string, at?: { view: View; x: number; y: number }): Promise<boolean>
}

/** What a gesture asks of the schematic's net labels and power symbols (use-label-drag.ts). */
export interface GestureLabels {
  /** The label under the point, if any. */
  at(world: Point): NetLabel | undefined
  /** Why the label may not be dragged, or null. */
  blocker(id: string): string | null
  /** Writes the move to `drop`. */
  commit(label: NetLabel, drop: Point): void
}

export interface GestureInput {
  view: View
  camera: Camera | undefined
  setCamera(camera: Camera): void
  size: Size
  boxes: PartBox[]
  anchors: ReadonlyMap<string, Anchor>
  step: number
  /** Whether a drag lands on the grid (View → Snap); off, it lands where the pointer puts it, rounded to 4 decimals. Absent means on. */
  snap?: boolean
  /** When the build behind the shown design started (ms). */
  builtFrom: number
  circuit: SourceCircuit
  actions: GestureActions
  selection: Selection
  onSelect(change: SelectionChange): void
  blockerFor(name: string): string | null
  /** The schematic's net labels and power symbols, when they can be dragged. */
  labels?: GestureLabels
  /** The PCB's layers, which decide what a click or a box may pick; the schematic has none. */
  layers?: PickLayers
  /** The Filter tab: the kinds a click or a box may pick. */
  filter?: PickFilter
  /** The canvas tool that takes a left press while armed, and how to put it away. */
  tool: { armed: ArmedTool; disarm(): void }
  /** A right click that did not move: what it was on, and where on the screen (client pixels). */
  onContextMenu(target: ContextTarget, at: Point): void
}

/** Writes the move of `names` by `offset`. */
export type Commit = (names: readonly string[], offset: Point) => void

/** The edit that moves `names` by `offset`; a part with no anchor in this view moves from the centre of its box. */
export function movePlan(input: GestureInput, names: readonly string[], offset: Point): GroupEdit {
  return moveEach(input.circuit, names, input.view, anchorLookup(input.anchors, input.boxes), offset, input.blockerFor)
}

/** A box smaller than this on both sides, in CSS pixels, is a click. */
const BOX_MIN_PX = 6
const round = roundPosition

/** What is at a world point and may be picked there (pick.ts): the smallest part box, else a net label, else nothing. */
export function targetAt(boxes: readonly PartBox[], labels: GestureLabels | undefined, world: Point, context: PickContext): ContextTarget {
  const parts = hitsAt(boxes, world).map((box): Pickable => ({ kind: "part", name: box.name }))
  const label = labels?.at(world)
  const [first] = picks(label ? [...parts, { kind: "label", label }] : parts, context)
  return first ?? { kind: "canvas" }
}

/** What a pick on this canvas is made with: its selection and its armed tool. */
const pickContext = (input: GestureInput): PickContext => ({ selection: input.selection, armed: input.tool.armed, layers: input.layers, filter: input.filter })

function underOf(target: ContextTarget, selection: Selection): Under {
  if (target.kind === "part") return selection.has(target.name) ? "selectedPart" : "part"
  return target.kind === "label" ? "label" : "empty"
}

/** The gesture a press starts, as press.ts decides; a toggle changes the selection and starts nothing. */
export function startGesture(input: GestureInput, event: Press, point: Point): Gesture | undefined {
  const { camera } = input
  if (!camera) return undefined
  const world = screenToWorld(camera, input.size, point)
  const target = targetAt(input.boxes, input.labels, world, pickContext(input))
  const start = gestureStart(event, underOf(target, input.selection), input.tool.armed)
  const still = stillRelease(start, input.tool.armed)
  if (start === "pan" || start === "rightPress") return { kind: "pan", start: point, camera, moved: false, still, target }
  if (start === "note" || start === "zoom") return { kind: start, start: point, current: point }
  if (start === "box" || start === "addBox") return { kind: "box", start: point, current: point, adds: start === "addBox", still }
  if (target.kind === "label" && start === "label") {
    return { kind: "label", label: target.label, start: point, at: target.label.at, moved: false, blocker: input.labels?.blocker(target.label.id) ?? null }
  }
  const part = target.kind === "part" ? input.boxes.find((box) => box.name === target.name) : undefined
  if (!part) return undefined
  if (start === "toggle") {
    input.onSelect((current) => current.toggle(part.name))
    return undefined
  }
  return start === "move" || start === "moveGroup" ? startDrag(input, part, start, point, still) : undefined
}

/** A drag of the pressed part alone (selected first) or of the whole selection, the parts this view draws. */
function startDrag(input: GestureInput, part: PartBox, start: GestureStart, point: Point, still: StillRelease): Gesture {
  const group = start === "moveGroup"
  if (!group) input.onSelect((current) => current.only(part.name))
  const drawn = new Set(input.boxes.map((box) => box.name))
  const names = group ? input.selection.names.filter((name) => drawn.has(name)) : [part.name]
  const movable = names.filter((name) => input.blockerFor(name) === null)
  return { kind: "drag", part, names, movable, start: point, offset: ZERO, moved: false, blocker: input.blockerFor(part.name), still }
}

/** The gesture after the pointer moved to `point`; undefined when it stays the same. A pan moves the camera. */
export function followGesture(input: GestureInput, gesture: Gesture, point: Point, camera: Camera): Gesture | undefined {
  if (gesture.kind === "pan") {
    const dx = (point.x - gesture.start.x) / gesture.camera.scale
    const dy = (point.y - gesture.start.y) / gesture.camera.scale
    input.setCamera({ ...gesture.camera, cx: gesture.camera.cx - dx, cy: gesture.camera.cy + dy })
    return !gesture.moved && hasMoved(gesture.start, point) ? { ...gesture, moved: true } : undefined
  }
  if (gesture.kind === "box" || gesture.kind === "note" || gesture.kind === "zoom") return { ...gesture, current: point }
  if (!gesture.moved && !hasMoved(gesture.start, point)) return undefined
  const world = screenToWorld(camera, input.size, point)
  const startWorld = screenToWorld(camera, input.size, gesture.start)
  const moved = { x: world.x - startWorld.x, y: world.y - startWorld.y }
  const snapped = (value: number) => snapPosition(value, input.step, input.snap !== false)
  if (gesture.kind === "label") {
    const { at } = gesture.label
    return { ...gesture, moved: true, at: { x: snapped(at.x + moved.x), y: snapped(at.y + moved.y) } }
  }
  // Snap the pressed part's origin, where its position props put it, to the grid, not the distance moved.
  const origin = input.anchors.get(gesture.part.name)?.origin ?? gesture.part.center
  return { ...gesture, moved: true, offset: { x: round(snapped(origin.x + moved.x) - origin.x), y: round(snapped(origin.y + moved.y) - origin.y) } }
}

/** Finishes a gesture: a drop writes the move, a box selects, a still click selects or opens the menu, a note box asks for the note. */
export function endGesture(input: GestureInput, done: Gesture, camera: Camera, commit: Commit, at: Point): void {
  if (done.kind === "label") {
    if (!done.moved) return
    return done.blocker ? input.actions.notify(done.blocker) : input.labels?.commit(done.label, done.at)
  }
  if (done.kind === "drag") return endDrag(input, done, commit)
  if (done.kind === "pan") {
    if (done.moved) return
    if (done.still === "menu") input.onContextMenu(done.target, at)
    if (done.still === "disarm") input.tool.disarm()
    return
  }
  if (done.kind === "box") return endBox(input, done, camera)
  if (done.kind === "zoom") return endZoom(input, done, camera)
  endNote(input, done, camera)
}

function endDrag(input: GestureInput, done: Extract<Gesture, { kind: "drag" }>, commit: Commit): void {
  if (!done.moved) {
    if (done.still === "selectAlone") input.onSelect((current) => current.only(done.part.name))
    return
  }
  if (done.blocker) return input.actions.notify(done.blocker)
  commit(done.names, done.offset)
}

/** The box's corners in world units, or undefined when it is too small to be more than a click. */
function worldBox(input: GestureInput, done: { start: Point; current: Point }, camera: Camera): [Point, Point] | undefined {
  const tiny = Math.abs(done.start.x - done.current.x) < BOX_MIN_PX && Math.abs(done.start.y - done.current.y) < BOX_MIN_PX
  return tiny ? undefined : [screenToWorld(camera, input.size, done.start), screenToWorld(camera, input.size, done.current)]
}

function endBox(input: GestureInput, done: Extract<Gesture, { kind: "box" }>, camera: Camera): void {
  const corners = worldBox(input, done, camera)
  if (!corners) {
    if (done.still === "clear") input.onSelect((current) => current.clear())
    return
  }
  const names = partsInBox(input.boxes, corners[0], corners[1], boxMode(done.start, done.current))
  input.onSelect(boxSelection(names, done.adds, input.tool.armed, input.layers, input.filter))
}

/** A drawn Fit area box puts the camera on it and puts the tool away; a click keeps the tool armed. */
function endZoom(input: GestureInput, done: Extract<Gesture, { kind: "zoom" }>, camera: Camera): void {
  const corners = worldBox(input, done, camera)
  if (!corners) return
  input.tool.disarm()
  input.setCamera(areaCamera(corners[0], corners[1], input.size))
}

/** A drawn note box asks for the note, places it at the box's centre, and puts the tool away; a click keeps it armed. */
function endNote(input: GestureInput, done: Extract<Gesture, { kind: "note" }>, camera: Camera): void {
  const corners = worldBox(input, done, camera)
  if (!corners) return
  const [a, b] = corners
  input.tool.disarm()
  const text = window.prompt(VIEWS[input.view].notePrompt)
  if (text) void input.actions.mark(text, { view: input.view, x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) })
}

/**
 * The gesture under way, held here from press to release rather than read back from what React last drew: a pointer
 * can send its moves and its release before React has drawn a single move (Chrome does, for a quick drag or for events
 * sent by a script), and the release must still see the moved gesture. `read` gives the latest canvas input and
 * commit; `show` hands each new gesture to React to draw.
 */
export function gestureSession(read: () => { input: GestureInput; commit: Commit }, show: (gesture: Gesture | undefined) => void) {
  let current: Gesture | undefined
  const set = (next: Gesture | undefined) => {
    current = next
    show(next)
  }
  return {
    press(event: Press, point: Point): void {
      const next = startGesture(read().input, event, point)
      if (next) set(next)
    },
    /**
     * Follows the pointer; false when no gesture is running, so the canvas can update its hover instead. A move with
     * no button held (`buttons` 0) means the release was lost, say to a dialog: the gesture ends without finishing.
     */
    move(point: Point, buttons?: number): boolean {
      const { input } = read()
      if (!current || !input.camera) return false
      if (buttons === 0) {
        set(undefined)
        return false
      }
      const next = followGesture(input, current, point, input.camera)
      if (next) set(next)
      return true
    },
    /** Ends the gesture; `at` is where the pointer was let go, in client pixels, for the context menu. */
    release(at: Point): void {
      const done = current
      set(undefined)
      const { input, commit } = read()
      if (done && input.camera) endGesture(input, done, input.camera, commit, at)
    },
    /** Drops the gesture without finishing it: Esc while a label is dragged, or the browser took the pointer away. A release after it does nothing. */
    cancel(): void {
      set(undefined)
    },
  }
}
