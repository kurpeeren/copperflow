// The steps of a pointer gesture on either canvas, from press to release. press.ts decides what a press starts; these
// follow the pointer and finish the gesture: a pan, a drag of the selection (its parts, wires, labels and drawings), of a net label, of
// a part's name, value or designator (part-text.ts) or of a wire's segment or corner (wire-drag.ts), a selection box, or the armed Note box tool's box. gestureSession holds the gesture between
// events; use-canvas-gestures.ts draws it. Plain TypeScript with .js imports, so the tests can run it.
import type { NetLabel } from "../../../src/engine/schematic.js"
import type { Selection, SelectionChange } from "../selection.js"
import { boxMode, boxSelection, labelsInBox, partsInBox, wiresInBox } from "./box-select.js"
import { copperInBox, type CopperArea } from "./copper-hit.js"
import { drawingsInBox, type DrawingHit } from "./drawing-hit.js"
import { hitsAt, roundPosition, screenToWorld, snapPosition, type Box, type Camera, type PartBox, type Point, type Size } from "./geometry.js"
import type { PickLayers } from "./layers.js"
import type { PickFilter } from "./pick-filter.js"
import { anchorLookup, moveEach, type GroupEdit, type GroupEditActions } from "./group-edits.js"
import { VIEWS, ZERO, type Anchor, type SourceCircuit, type View } from "./positions.js"
import { areaCamera } from "./view-fit.js"
import { picks, type Pickable, type PickContext } from "./pick.js"
import { gestureStart, hasMoved, rightButtonHeld, stillRelease, type ArmedTool, type ContextTarget, type GestureStart, type Press, type StillRelease, type Under } from "./press.js"
import { endReshape, followReshape, gripOf, handleUnder, startReshape, type ReshapeGesture, type WireDrag } from "./wire-drag.js"
import { withMovedWires, type MovedWires, type WireFollow } from "./wire-follow.js"
import type { WireLine } from "./wire-hit.js"

export type { ReshapeGesture } from "./wire-drag.js"

export type Gesture =
  | { kind: "pan"; start: Point; camera: Camera; moved: boolean; still: StillRelease; target: ContextTarget }
  | {
      kind: "drag"
      /** The part pressed; its origin snaps to the grid and the rest move by the same offset. */
      part?: PartBox
      /** Or the selected wire or label pressed; then the offset itself is whole grid steps. */
      wire?: string
      label?: string
      /** Or the drawing pressed; its origin (`origin`) snaps to the grid, as a part's does. */
      drawing?: string
      origin?: Point
      /** Every part the drag moves, and those of them that may move. */
      names: readonly string[]
      movable: readonly string[]
      /** The selected wires the drag carries along (wire-follow.ts), the selected net labels and flags, and the selected drawings. */
      wires: readonly string[]
      labels: readonly string[]
      drawings: readonly string[]
      start: Point
      offset: Point
      moved: boolean
      /** Why the pressed part may not move; it stops the whole drag. */
      blocker: string | null
      still: StillRelease
    }
  | { kind: "label"; label: NetLabel; start: Point; at: Point; moved: boolean; blocker: string | null }
  /** A part's name, value or designator (by its text id): `from` is where its middle was, `at` where the drag puts it, on the grid. */
  | { kind: "text"; id: string; start: Point; from: Point; at: Point; moved: boolean; blocker: string | null }
  | ReshapeGesture
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
  /** What each label draws (label-drag.ts labelDrawnBox), which a selection box takes by its direction rule. */
  boxes?: readonly { id: string; box: Box }[]
}

/** What a gesture asks of the parts' names and values (schematic) or designators (PCB), by text id (use-part-texts.ts). */
export interface GestureTexts {
  /** The text under the point, if any. */
  at(world: Point): string | undefined
  /** Where the text's middle is drawn now, a move waiting for its build included. */
  position(id: string): Point | undefined
  /** Why the text may not move, or null. */
  blocker(id: string): string | null
  /** Writes the move of the text's middle to `at`. */
  commit(id: string, at: Point): void
}

/** What a gesture asks of the schematic's wires: the id of the one under a point (wire-hit.ts), if any, the lines a box looks at, and how to reshape them. */
export interface GestureWires {
  at(world: Point): string | undefined
  /** The wires as shown, which a selection box takes by its direction rule. */
  lines?: readonly WireLine[]
  /** Absent, a press on a wire only selects it. */
  drag?: WireDrag
}

/** What a gesture asks of the schematic's drawings (drawing-hit.ts). */
export interface GestureDrawings {
  /** The drawing under the point, if any: on its line (over the parts) or inside its fill (under them). */
  at(world: Point): DrawingHit | undefined
  /** Each drawing's box, which a selection box takes by its direction rule. */
  boxes?: readonly { id: string; box: Box }[]
  /** Where the drawing's position puts it (its corner, centre or first point), which a drag snaps to the grid. */
  origin?(id: string): Point | undefined
  /** Why the drawing cannot move (locked, read-only, its position an expression), or null. */
  blocker?(id: string): string | null
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
  /** The schematic's wires, which a click selects. */
  wires?: GestureWires
  /** The schematic's drawings, which a click selects and a drag moves. */
  drawings?: GestureDrawings
  /** The parts' names and values (schematic) or designators (PCB), which a click selects and a drag moves. */
  texts?: GestureTexts
  /** The schematic's sheet, whose hand-drawn wires follow a moved part; the PCB has none. */
  follow?: WireFollow
  /** The PCB's layers, which decide what a click or a box may pick; the schematic has none. */
  layers?: PickLayers
  /** The PCB's shown tracks and vias with their boxes, which a selection box takes by its direction rule. */
  copper?: readonly CopperArea[]
  /** The PCB's track or via under a point, which a right click's menu is for (the left press on copper is the canvas's own). */
  copperAt?(world: Point): string | undefined
  /** The Filter tab: the kinds a click or a box may pick. */
  filter?: PickFilter
  /** The canvas tool that takes a left press while armed, and how to put it away. */
  tool: { armed: ArmedTool; disarm(): void }
  /** A right click that did not move: what it was on, and where on the screen (client pixels). */
  onContextMenu(target: ContextTarget, at: Point): void
}

/** Writes the move of `names`, the selected `wires`, `labels` and `drawings` by `offset`. */
export type Commit = (names: readonly string[], offset: Point, wires?: readonly string[], labels?: readonly string[], drawings?: readonly string[]) => void

/**
 * The edit that moves `names`, the selected `wires` and the selected `labels` by `offset`, and the shapes it gives the
 * wires and labels (drawn while the drag runs and until its build lands); a part with no anchor in this view moves from
 * the centre of its box. On the schematic the wires at the moved pins keep their first segments square, and the
 * selected wires and labels move with the parts, in the same edit list (wire-follow.ts).
 */
export function moveWithWires(
  input: GestureInput,
  names: readonly string[],
  offset: Point,
  wires: readonly string[] = [],
  labels: readonly string[] = [],
  drawings: readonly string[] = [],
): MovedWires {
  const plan = moveEach(input.circuit, names, input.view, anchorLookup(input.anchors, input.boxes), offset, input.blockerFor)
  return withMovedWires(plan, input.circuit, input.follow, { wires, labels, drawings, offset })
}

/** The edit of a move (moveWithWires) without the shapes. */
export function movePlan(input: GestureInput, names: readonly string[], offset: Point, wires: readonly string[] = [], labels: readonly string[] = [], drawings: readonly string[] = []): GroupEdit {
  return moveWithWires(input, names, offset, wires, labels, drawings).plan
}

/** What targetAt can find: everything pickable but the PCB's copper, which the PCB canvas picks first (copper-hit.ts). */
type SheetPickable = Exclude<Pickable, { kind: "track" | "via" | "pour" | "hole" }>

/** A box smaller than this on both sides, in CSS pixels, is a click. */
const BOX_MIN_PX = 6
const round = roundPosition

/**
 * What is at a world point and may be picked there (pick.ts): a net label, else a wire, else a drawing's line or text,
 * else the smallest part box, else a part's name, value or designator, else a filled drawing's inside, else nothing.
 * A label, wire or drawn line over a symbol is the thing picked there, not the symbol under it; a symbol over a filled
 * shape is, and so is a symbol's body over its own name.
 */
export function targetAt(
  boxes: readonly PartBox[],
  labels: Pick<GestureLabels, "at"> | undefined,
  world: Point,
  context: PickContext,
  wires?: Pick<GestureWires, "at">,
  drawings?: Pick<GestureDrawings, "at">,
  texts?: Pick<GestureTexts, "at">,
): ContextTarget {
  const label = labels?.at(world)
  const wire = wires?.at(world)
  const drawn = drawings?.at(world)
  const text = texts?.at(world)
  const drawing = (place: DrawingHit["place"]): SheetPickable[] => (drawn?.place === place ? [{ kind: "drawing", id: drawn.id }] : [])
  const candidates: SheetPickable[] = [
    ...(label ? [{ kind: "label" as const, label }] : []),
    ...(wire !== undefined ? [{ kind: "wire" as const, id: wire }] : []),
    ...drawing("line"),
    ...hitsAt(boxes, world).map((box): SheetPickable => ({ kind: "part", name: box.name })),
    ...(text !== undefined ? [{ kind: "text" as const, id: text }] : []),
    ...drawing("inside"),
  ]
  const [first] = picks(candidates, context)
  return first ?? { kind: "canvas" }
}

/** Whether a pickable text is what a press at `world` takes, so copper under it must not (on the PCB: texts, then copper, then pads and parts). */
export function textTakesPress(boxes: readonly PartBox[], world: Point, context: PickContext, texts: Pick<GestureTexts, "at"> | undefined): boolean {
  return targetAt(boxes, undefined, world, context, undefined, undefined, texts).kind === "text"
}

/** What a double click does: remove a corner, open Properties on a part, a wire or a drawing, rename a label's net, or nothing. */
export type DoubleClick =
  | { kind: "removeCorner"; id: string; index: number }
  | { kind: "properties"; target: Extract<ContextTarget, { kind: "part" | "wire" | "drawing" }> }
  | { kind: "rename"; label: NetLabel }
  | { kind: "none" }

export interface DoubleClickInput {
  /** A canvas tool is armed, or the W tool is wiring or drawing: the double click is the tool's. */
  busy: boolean
  /** The corner handle of the wire selected alone under the pointer (wire-drag.ts handleUnder). */
  handle: { id: string; index: number } | undefined
  /** What else is under the pointer (targetAt). */
  target: ContextTarget
  /** The wire selected alone before the double click's first press (gestureSession). */
  selectedBefore: string | undefined
}

/**
 * A double click on a corner handle removes that corner only when its wire was selected before the double click
 * began. On a wire the first click selected it opens Properties, as anywhere else on a wire or on a part: wires are
 * double-clicked to pick them. On a net label it renames the label's net.
 */
export function doubleClickAction({ busy, handle, target, selectedBefore }: DoubleClickInput): DoubleClick {
  if (busy) return { kind: "none" }
  if (handle) return handle.id === selectedBefore ? { kind: "removeCorner", ...handle } : { kind: "properties", target: { kind: "wire", id: handle.id } }
  if (target.kind === "part" || target.kind === "wire" || target.kind === "drawing") return { kind: "properties", target }
  return target.kind === "label" ? { kind: "rename", label: target.label } : { kind: "none" }
}

/** What a pick on this canvas is made with: its selection and its armed tool. */
const pickContext = (input: GestureInput): PickContext => ({ selection: input.selection, armed: input.tool.armed, layers: input.layers, filter: input.filter })

function underOf(target: ContextTarget, selection: Selection): Under {
  if (target.kind === "part") return selection.has(target.name) ? "selectedPart" : "part"
  if (target.kind === "wire") return selection.hasWire(target.id) && selection.total > 1 ? "selectedWire" : "wire"
  if (target.kind === "label") return selection.hasLabel(target.label.id) && selection.total > 1 ? "selectedLabel" : "label"
  if (target.kind === "drawing") return selection.hasDrawing(target.id) ? "selectedDrawing" : "drawing"
  return target.kind === "text" ? "text" : "empty"
}

/** What a press is on: a corner handle of the selected wire, drawn over everything, else what targetAt finds. */
function pressedAt(input: GestureInput, world: Point, camera: Camera): { target: ContextTarget; under: Under; corner?: number } {
  const handle = handleUnder(input.wires?.drag, pickContext(input), world, camera.scale)
  if (handle) return { target: { kind: "wire", id: handle.id }, under: "wireCorner", corner: handle.index }
  const target = targetAt(input.boxes, input.labels, world, pickContext(input), input.wires, input.drawings, input.texts)
  // A text is small and drawn over copper, so copper under it does not take the press; otherwise copper is above the parts.
  const copper = target.kind === "text" ? undefined : input.copperAt?.(world)
  // Only a right or middle press reaches here on copper; for those, "empty" is what the press does (pan or the menu).
  if (copper !== undefined) return { target: { kind: "copper", id: copper }, under: "empty" }
  return { target, under: underOf(target, input.selection) }
}

const WIRE_STARTS: ReadonlySet<GestureStart> = new Set(["wire", "wireSegment", "wireCorner"])

/** A press on a wire selects it alone; unless a Place tool is armed, it also grabs the corner handle or the segment pressed. */
function pressWire(input: GestureInput, id: string, start: GestureStart, at: { world: Point; point: Point; corner?: number }, camera: Camera): Gesture | undefined {
  input.onSelect((current) => current.onlyWire(id))
  if (start === "wire") return undefined
  const drag = input.wires?.drag
  const points = drag?.points(id)
  const grip = points && gripOf(points, at.world, camera.scale, start === "wireCorner" ? at.corner : undefined)
  return grip && startReshape(drag, id, grip, at.point)
}

/** The gesture a press starts, as press.ts decides; a toggle changes the selection and starts nothing. */
export function startGesture(input: GestureInput, event: Press, point: Point): Gesture | undefined {
  const { camera } = input
  if (!camera) return undefined
  const world = screenToWorld(camera, input.size, point)
  const { target, under, corner } = pressedAt(input, world, camera)
  const start = gestureStart(event, under, input.tool.armed)
  const still = stillRelease(start, input.tool.armed)
  if (start === "pan" || start === "rightPress") return { kind: "pan", start: point, camera, moved: false, still, target }
  if (start === "note" || start === "zoom") return { kind: start, start: point, current: point }
  if (start === "box" || start === "addBox") return { kind: "box", start: point, current: point, adds: start === "addBox", still }
  if (target.kind === "label") return pressOnLabel(input, target.label, start, point, still)
  if (target.kind === "wire") return pressOnWire(input, target.id, start, { world, point, still, ...(corner === undefined ? {} : { corner }) }, camera)
  if (target.kind === "drawing") return pressOnDrawing(input, target.id, start, point, still)
  if (target.kind === "text") return pressOnText(input, target.id, start, point)
  const part = target.kind === "part" ? input.boxes.find((box) => box.name === target.name) : undefined
  if (!part) return undefined
  if (start === "toggle") {
    input.onSelect((current) => current.toggle(part.name))
    return undefined
  }
  return start === "move" || start === "moveGroup" ? startDrag(input, { part }, start, point, still) : undefined
}

/** A press on a label: Shift or Ctrl toggles it, one selected with other things drags the selection, else it is selected alone and dragged alone. */
function pressOnLabel(input: GestureInput, label: NetLabel, start: GestureStart, point: Point, still: StillRelease): Gesture | undefined {
  if (start === "toggle") {
    input.onSelect((current) => current.toggleLabel(label.id))
    return undefined
  }
  if (start === "moveGroup") return startDrag(input, { label: label.id }, start, point, still)
  if (start !== "label") return undefined
  input.onSelect((current) => current.onlyLabel(label.id))
  return { kind: "label", label, start: point, at: label.at, moved: false, blocker: input.labels?.blocker(label.id) ?? null }
}

/** A press on a part's name, value or designator: Shift or Ctrl toggles it, else it is selected alone and dragged alone. */
function pressOnText(input: GestureInput, id: string, start: GestureStart, point: Point): Gesture | undefined {
  if (start === "toggle") {
    input.onSelect((current) => current.toggleText(id))
    return undefined
  }
  const from = input.texts?.position(id)
  if (start !== "text" || !from) return undefined
  input.onSelect((current) => current.onlyText(id))
  return { kind: "text", id, start: point, from, at: from, moved: false, blocker: input.texts?.blocker(id) ?? null }
}

/** A press on a drawing: Shift or Ctrl toggles it, else it is dragged, alone (selected first) or with the selection it is in. */
function pressOnDrawing(input: GestureInput, id: string, start: GestureStart, point: Point, still: StillRelease): Gesture | undefined {
  if (start === "toggle") {
    input.onSelect((current) => current.toggleDrawing(id))
    return undefined
  }
  return start === "move" || start === "moveGroup" ? startDrag(input, { drawing: id }, start, point, still) : undefined
}

/** A press on a wire: Shift or Ctrl toggles it, one selected with other things drags the selection, else it is selected (and reshaped). */
function pressOnWire(input: GestureInput, id: string, start: GestureStart, at: { world: Point; point: Point; still: StillRelease; corner?: number }, camera: Camera): Gesture | undefined {
  if (start === "toggle") {
    input.onSelect((current) => current.toggleWire(id))
    return undefined
  }
  if (start === "moveGroup") return startDrag(input, { wire: id }, start, at.point, at.still)
  return WIRE_STARTS.has(start) ? pressWire(input, id, start, at, camera) : undefined
}

type Pressed = { part: PartBox } | { wire: string } | { label: string } | { drawing: string }
type Dragged = Pick<Extract<Gesture, { kind: "drag" }>, "names" | "wires" | "labels" | "drawings">

const NOTHING_DRAGGED: Dragged = { names: [], wires: [], labels: [], drawings: [] }

/** What a drag moves: the whole selection (its parts those this view draws), or the pressed part or drawing alone, selected first. */
function dragged(input: GestureInput, pressed: Pressed, group: boolean): Dragged {
  if (group) {
    const drawn = new Set(input.boxes.map((box) => box.name))
    const { names, wires, labels, drawings } = input.selection
    return { names: names.filter((name) => drawn.has(name)), wires, labels, drawings }
  }
  if ("part" in pressed) {
    const { name } = pressed.part
    input.onSelect((current) => current.only(name))
    return { ...NOTHING_DRAGGED, names: [name] }
  }
  if (!("drawing" in pressed)) return NOTHING_DRAGGED
  const { drawing } = pressed
  input.onSelect((current) => current.onlyDrawing(drawing))
  return { ...NOTHING_DRAGGED, drawings: [drawing] }
}

/**
 * A drag of the pressed part or drawing alone (selected first), or of the whole selection: the parts this view draws,
 * the selected wires, labels and drawings. A press on a part that cannot move stops the drag; a press on anything
 * else stops nothing.
 */
function startDrag(input: GestureInput, pressed: Pressed, start: GestureStart, point: Point, still: StillRelease): Gesture {
  const moves = dragged(input, pressed, start === "moveGroup")
  const movable = moves.names.filter((name) => input.blockerFor(name) === null)
  const blocker = "part" in pressed ? input.blockerFor(pressed.part.name) : "drawing" in pressed ? (input.drawings?.blocker?.(pressed.drawing) ?? null) : null
  const origin = "drawing" in pressed ? input.drawings?.origin?.(pressed.drawing) : undefined
  return { kind: "drag", ...pressed, ...(origin ? { origin } : {}), ...moves, movable, start: point, offset: ZERO, moved: false, blocker, still }
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
  if (gesture.kind === "reshape") return followReshape(gesture, moved, { step: input.step, snap: input.snap !== false }, (text) => input.actions.notify(text))
  // A drawing that cannot move says why as soon as the drag starts, as a wire's reshape does, and then stays put.
  if (gesture.kind === "drag" && gesture.drawing !== undefined && gesture.blocker) {
    if (!gesture.moved) input.actions.notify(gesture.blocker)
    return gesture.moved ? undefined : { ...gesture, moved: true }
  }
  const snapped = (value: number) => snapPosition(value, input.step, input.snap !== false)
  if (gesture.kind === "label") {
    const { at } = gesture.label
    return { ...gesture, moved: true, at: { x: snapped(at.x + moved.x), y: snapped(at.y + moved.y) } }
  }
  if (gesture.kind === "text") return { ...gesture, moved: true, at: { x: snapped(gesture.from.x + moved.x), y: snapped(gesture.from.y + moved.y) } }
  // Snap the pressed part's or drawing's origin, where its position props put it, to the grid, not the distance moved;
  // a press on a wire or a label moves by whole grid steps.
  const { part } = gesture
  const origin = part ? (input.anchors.get(part.name)?.origin ?? part.center) : (gesture.origin ?? ZERO)
  return { ...gesture, moved: true, offset: { x: round(snapped(origin.x + moved.x) - origin.x), y: round(snapped(origin.y + moved.y) - origin.y) } }
}

/** Finishes a gesture: a drop writes the move, a box selects, a still click selects or opens the menu, a note box asks for the note. */
export function endGesture(input: GestureInput, done: Gesture, camera: Camera, commit: Commit, at: Point): void {
  if (done.kind === "label") {
    if (!done.moved) return
    return done.blocker ? input.actions.notify(done.blocker) : input.labels?.commit(done.label, done.at)
  }
  if (done.kind === "text") {
    if (!done.moved) return
    return done.blocker ? input.actions.notify(done.blocker) : input.texts?.commit(done.id, done.at)
  }
  if (done.kind === "drag") return endDrag(input, done, commit)
  if (done.kind === "reshape") return endReshape(input.wires?.drag, done, (text) => input.actions.notify(text))
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
    if (done.still === "selectAlone") input.onSelect(aloneAfter(done))
    return
  }
  if (done.blocker) return done.drawing === undefined ? input.actions.notify(done.blocker) : undefined
  commit(done.names, done.offset, done.wires, done.labels, done.drawings)
}

/** What a still click on one thing of the selection leaves: that part, wire, label or drawing alone. */
function aloneAfter({ part, wire, label, drawing }: Extract<Gesture, { kind: "drag" }>): SelectionChange {
  return (current) => {
    if (part) return current.only(part.name)
    if (wire !== undefined) return current.onlyWire(wire)
    if (drawing !== undefined) return current.onlyDrawing(drawing)
    return label !== undefined ? current.onlyLabel(label) : current
  }
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
  const mode = boxMode(done.start, done.current)
  const found = {
    parts: partsInBox(input.boxes, corners[0], corners[1], mode),
    wires: wiresInBox(input.wires?.lines ?? [], corners[0], corners[1], mode),
    labels: labelsInBox(input.labels?.boxes ?? [], corners[0], corners[1], mode),
    drawings: drawingsInBox(input.drawings?.boxes ?? [], corners[0], corners[1], mode),
    copper: copperInBox(input.copper ?? [], corners[0], corners[1], mode),
  }
  input.onSelect(boxSelection(found, done.adds, input.tool.armed, input.layers, input.filter))
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

/** A reshape whose wires lost their drag tools (the W tool started wiring) cannot go on: it is dropped, and the wire goes back. */
export function gestureLost(gesture: Gesture, wires: GestureWires | undefined): boolean {
  return gesture.kind === "reshape" && !wires?.drag
}

/** The drags Esc drops: a net label's, a part's text's and a wire's reshape. Any other gesture leaves Esc to its own work. */
export const ESC_CANCELS: ReadonlySet<Gesture["kind"]> = new Set(["label", "text", "reshape"])

export const cancelsOnEscape = (kind: Gesture["kind"] | undefined): boolean => kind !== undefined && ESC_CANCELS.has(kind)

/**
 * Whether a move ends the gesture without finishing it: no button held (the release was lost), the right button
 * during a reshape, or a reshape that lost its drag tools.
 */
function endsUnfinished(gesture: Gesture, buttons: number | undefined, wires: GestureWires | undefined): boolean {
  if (gestureLost(gesture, wires)) return true
  return buttons !== undefined && (buttons === 0 || (gesture.kind === "reshape" && rightButtonHeld(buttons)))
}

/**
 * The gesture under way, held here from press to release rather than read back from what React last drew: a pointer
 * can send its moves and its release before React has drawn a single move (Chrome does, for a quick drag or for events
 * sent by a script), and the release must still see the moved gesture. `read` gives the latest canvas input and
 * commit; `show` hands each new gesture to React to draw.
 */
export function gestureSession(read: () => { input: GestureInput; commit: Commit }, show: (gesture: Gesture | undefined) => void) {
  let current: Gesture | undefined
  /** The wire selected alone before each of the last two presses, the two of a double click. */
  let wiresBefore: (string | undefined)[] = []
  const set = (next: Gesture | undefined) => {
    current = next
    show(next)
  }
  return {
    press(event: Press, point: Point): void {
      const { input } = read()
      wiresBefore = [...wiresBefore, input.selection.soleWire].slice(-2)
      const next = startGesture(input, event, point)
      if (next) set(next)
    },
    /** The wire selected before the first press of the double click just made, if any. */
    wireBeforeDoubleClick: (): string | undefined => (wiresBefore.length === 2 ? wiresBefore[0] : undefined),
    /**
     * Follows the pointer; false when no gesture is running, so the canvas can update its hover instead. A move with
     * no button held (`buttons` 0) means the release was lost, say to a dialog: the gesture ends without finishing.
     * So does a wire's reshape when the right button joins the left, or when the W tool took its drag tools away
     * (cancelled, nothing written).
     */
    move(point: Point, buttons?: number): boolean {
      const { input } = read()
      if (!current || !input.camera) return false
      if (endsUnfinished(current, buttons, input.wires)) {
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
    /** Drops the gesture without finishing it: Esc while a label or a wire is dragged, or the browser took the pointer away. A release after it does nothing. */
    cancel(): void {
      set(undefined)
    },
  }
}
