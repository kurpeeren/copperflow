import { afterEach, describe, expect, test, vi } from "vitest"
import type { NetLabel } from "../src/engine/schematic.js"
import {
  cancelsOnEscape,
  doubleClickAction,
  endGesture,
  followGesture,
  gestureLost,
  gestureSession,
  movePlan,
  startGesture,
  targetAt,
  type Gesture,
  type GestureInput,
  type GestureWires,
} from "../studio/src/pcb/gestures.js"
import { sendGroupEdit } from "../studio/src/pcb/group-edits.js"
import { moveBlocker } from "../studio/src/pcb/positions.js"
import { worldToScreen, type Camera, type PartBox, type Point } from "../studio/src/pcb/geometry.js"
import type { PickContext } from "../studio/src/pcb/pick.js"
import { ALL_PICKABLE, type PickFilter } from "../studio/src/pcb/pick-filter.js"
import type { ArmedTool, ContextTarget, Press } from "../studio/src/pcb/press.js"
import { Selection, type SelectionChange } from "../studio/src/selection.js"

const CAMERA: Camera = { cx: 0, cy: 0, scale: 10 }
const SIZE = { width: 200, height: 200 }
const partBox = (name: string, minX: number, maxX: number): PartBox => ({
  name,
  pcbComponentId: name,
  center: { x: (minX + maxX) / 2, y: 0 },
  box: { minX, minY: -1, maxX, maxY: 1 },
})
// R1 from x=0 to 2, R2 from 4 to 6, both from y=-1 to 1.
const BOXES = [partBox("R1", 0, 2), partBox("R2", 4, 6)]
const screen = (x: number, y = 0): Point => worldToScreen(CAMERA, SIZE, { x, y })
const PICK: PickContext = { selection: Selection.none, armed: null }
const press = (held: Partial<Press> = {}): Press => ({ button: 0, shiftKey: false, ctrlKey: false, metaKey: false, ...held })
// A wire along y = 3, above both parts and clear of the boxes the other tests draw: up from (-1, 5), across at y = 3, down to (7, 5).
const W_POINTS: readonly Point[] = [{ x: -1, y: 5 }, { x: -1, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 5 }]
const wireAt = (p: Point) => (Math.abs(p.y - 3) < 0.1 ? "wire:W" : undefined)

interface CanvasOptions {
  locked?: string[]
  armed?: ArmedTool
  snap?: boolean
  wire?: string
  /** Wires selected with the parts in `start`. */
  wires?: string[]
  /** Why wire W cannot be reshaped. */
  wireBlocker?: string
  filter?: PickFilter
  /** The wires come without their drag tools, as while the W tool is wiring. */
  noDrag?: boolean
  /** Labels selected with the parts in `start`. */
  labels?: string[]
}

// A ground flag at (9, 0), right of R2; it answers from x 8.5 to 9.5 and y -0.5 to 0.5.
const FLAG: NetLabel = { id: "label:net.GND:R2.pin2", net: "net.GND", text: "GND", at: { x: 9, y: 0 }, side: "right", style: "ground" }
const FLAG_BOX = { minX: 8.5, minY: -0.5, maxX: 9.5, maxY: 0.5 }
const flagAt = (p: Point) => (p.x >= FLAG_BOX.minX && p.x <= FLAG_BOX.maxX && p.y >= FLAG_BOX.minY && p.y <= FLAG_BOX.maxY ? FLAG : undefined)

/** A canvas with R1 and R2: what the steps told it, and the selection they left. */
function canvas(start: readonly string[] = [], options: CanvasOptions = {}) {
  const calls: string[] = []
  const state = {
    selection: options.wire ? Selection.none.onlyWire(options.wire) : Selection.none.add(start).addWires(options.wires ?? []).addLabels(options.labels ?? []),
    camera: CAMERA,
    /** Wire W's points as shown; a build can change them, or take the wire away. */
    wirePoints: W_POINTS as readonly Point[] | undefined,
    /** The drag tools go while the W tool is wiring. */
    noDrag: options.noDrag ?? false,
  }
  const commits: { names: readonly string[]; offset: Point; wires?: readonly string[]; labels?: readonly string[] }[] = []
  const commit = (names: readonly string[], offset: Point, wires: readonly string[] = [], labels: readonly string[] = []) =>
    void commits.push({ names, offset, ...(wires.length > 0 ? { wires } : {}), ...(labels.length > 0 ? { labels } : {}) })
  const labelMoves: { id: string; at: Point }[] = []
  const shapes: { id: string; path: readonly Point[] }[] = []
  const drag: GestureWires["drag"] = {
    points: (id) => (id === "wire:W" ? state.wirePoints : undefined),
    blocker: () => options.wireBlocker ?? null,
    commit: (id, path) => void shapes.push({ id, path }),
  }
  const lines = [{ id: "wire:W", points: W_POINTS }]
  const wires = (): GestureWires => (state.noDrag ? { at: wireAt, lines } : { at: wireAt, lines, drag })
  const menus: { target: ContextTarget; at: Point }[] = []
  const actions = {
    notify: (text: string) => void calls.push(`notify ${text}`),
    mark: async (text: string, at?: unknown) => (calls.push(`mark ${text} ${JSON.stringify(at)}`), true),
  } as unknown as GestureInput["actions"]
  const input = (): GestureInput => ({
    view: "pcb",
    camera: CAMERA,
    setCamera: (camera) => void (state.camera = camera),
    size: SIZE,
    boxes: BOXES,
    anchors: new Map(),
    step: 0.5,
    ...(options.snap === undefined ? {} : { snap: options.snap }),
    builtFrom: 0,
    circuit: { model: { parts: [], traces: [], drawings: [], skipped: [], imports: [] } },
    actions,
    selection: state.selection,
    onSelect: (change: SelectionChange) => void (state.selection = change(state.selection)),
    blockerFor: (name) => (options.locked?.includes(name) ? `${name} is locked` : null),
    tool: { armed: options.armed ?? null, disarm: () => void calls.push("disarm") },
    onContextMenu: (target, at) => void menus.push({ target, at }),
    wires: wires(),
    labels: { at: flagAt, blocker: () => null, commit: (label, at) => void labelMoves.push({ id: label.id, at }), boxes: [{ id: FLAG.id, box: FLAG_BOX }] },
    ...(options.filter ? { filter: options.filter } : {}),
  })
  /** Presses at `from`, moves through `path` and lets go at the last point, as the hook does. */
  const gesture = (held: Partial<Press>, from: Point, ...path: Point[]) => {
    let current: Gesture | undefined = startGesture(input(), press(held), from)
    const started = current
    for (const point of path) current = (current && followGesture(input(), current, point, CAMERA)) ?? current
    if (current) endGesture(input(), current, CAMERA, commit, { x: 640, y: 480 })
    return started
  }
  const session = () => gestureSession(() => ({ input: input(), commit }), () => undefined)
  return { state, calls, commits, shapes, menus, labelMoves, gesture, session, input }
}

afterEach(() => vi.unstubAllGlobals())

describe("dragging parts", () => {
  test("a press on a part not selected selects it alone and drags only it", () => {
    const c = canvas(["R2"])
    c.gesture({}, screen(1), screen(2))
    expect(c.state.selection.names).toEqual(["R1"])
    expect(c.commits).toEqual([{ names: ["R1"], offset: { x: 1, y: 0 } }])
  })

  test("a drag on a selected part moves the whole selection by one snapped offset, in one commit", () => {
    const c = canvas(["R1", "R2"])
    c.gesture({}, screen(1), screen(1.4), screen(2.1))
    expect(c.state.selection.names).toEqual(["R1", "R2"])
    expect(c.commits).toEqual([{ names: ["R1", "R2"], offset: { x: 1, y: 0 } }])
  })

  test("a release without moving on a member of the selection selects that part alone", () => {
    const c = canvas(["R1", "R2"])
    c.gesture({}, screen(1), screen(1.1))
    expect(c.state.selection.names).toEqual(["R1"])
    expect(c.commits).toEqual([])
  })

  test("Shift or Ctrl on a selected part takes it out and moves nothing", () => {
    const c = canvas(["R1", "R2"])
    expect(c.gesture({ ctrlKey: true }, screen(1), screen(3))).toBeUndefined()
    expect(c.state.selection.names).toEqual(["R2"])
    expect(c.commits).toEqual([])
  })

  test("a locked part pressed blocks the move with today's message", () => {
    const c = canvas(["R1", "R2"], { locked: ["R1"] })
    c.gesture({}, screen(1), screen(3))
    expect(c.commits).toEqual([])
    expect(c.calls).toEqual(["notify R1 is locked"])
  })

  test("a locked part elsewhere in the selection does not stop the drag; the move leaves it out", () => {
    const c = canvas(["R1", "R2"], { locked: ["R2"] })
    const started = c.gesture({}, screen(1), screen(3))
    expect(started).toMatchObject({ kind: "drag", names: ["R1", "R2"], movable: ["R1"], blocker: null })
    expect(c.commits).toEqual([{ names: ["R1", "R2"], offset: { x: 2, y: 0 } }])
  })
})

describe("a wire", () => {
  test("a click on a wire selects it alone, drops the parts and moves nothing", () => {
    const c = canvas(["R1", "R2"])
    expect(c.gesture({}, screen(1, 3), screen(1, 3))).toMatchObject({ kind: "reshape", wire: "wire:W" })
    expect(c.state.selection.wires).toEqual(["wire:W"])
    expect(c.state.selection.names).toEqual([])
    expect(c.commits).toEqual([])
    expect(c.shapes).toEqual([])
  })

  test("a click on a part, or on empty canvas, drops the selected wire", () => {
    const onPart = canvas([], { wire: "wire:W" })
    onPart.gesture({}, screen(1), screen(1))
    expect(onPart.state.selection).toMatchObject({ names: ["R1"], wires: [] })
    const onEmpty = canvas([], { wire: "wire:W" })
    onEmpty.gesture({}, screen(3), screen(3))
    expect(onEmpty.state.selection).toBe(Selection.none)
  })

  test("a still right click on a wire opens the menu on that wire", () => {
    const c = canvas()
    c.gesture({ button: 2 }, screen(5, 3), screen(5, 3))
    expect(c.menus).toEqual([{ target: { kind: "wire", id: "wire:W" }, at: { x: 640, y: 480 } }])
  })
})

describe("parts and wires in one selection", () => {
  test("Shift or Ctrl on a wire adds it to the parts selected, and again takes it out; nothing moves", () => {
    const c = canvas(["R1"])
    expect(c.gesture({ shiftKey: true }, screen(1, 3), screen(1, 3.6))).toBeUndefined()
    expect(c.state.selection).toMatchObject({ names: ["R1"], wires: ["wire:W"] })
    c.gesture({ ctrlKey: true }, screen(1, 3), screen(1, 3))
    expect(c.state.selection).toMatchObject({ names: ["R1"], wires: [] })
    expect(c.commits).toEqual([])
    expect(c.shapes).toEqual([])
  })

  test("a drag on a selected part carries the selected wires along, in one commit", () => {
    const c = canvas(["R1", "R2"], { wires: ["wire:W"] })
    expect(c.gesture({}, screen(1), screen(1.4), screen(2.1))).toMatchObject({ kind: "drag", names: ["R1", "R2"], wires: ["wire:W"] })
    expect(c.commits).toEqual([{ names: ["R1", "R2"], offset: { x: 1, y: 0 }, wires: ["wire:W"] }])
  })

  test("a drag on a selected wire moves the whole selection by whole grid steps, and reshapes nothing", () => {
    const c = canvas(["R1"], { wires: ["wire:W"] })
    expect(c.gesture({}, screen(1, 3), screen(1, 3.2), screen(2.1, 3.6))).toMatchObject({ kind: "drag", wire: "wire:W", blocker: null })
    expect(c.commits).toEqual([{ names: ["R1"], offset: { x: 1, y: 0.5 }, wires: ["wire:W"] }])
    expect(c.state.selection).toMatchObject({ names: ["R1"], wires: ["wire:W"] })
    expect(c.shapes).toEqual([])
  })

  test("with two wires selected, a drag on one moves both", () => {
    const c = canvas([], { wires: ["wire:W", "wire:V"] })
    c.gesture({}, screen(1, 3), screen(1, 4))
    expect(c.commits).toEqual([{ names: [], offset: { x: 0, y: 1 }, wires: ["wire:W", "wire:V"] }])
  })

  test("a still click on a wire of the selection selects that wire alone", () => {
    const c = canvas(["R1"], { wires: ["wire:W"] })
    c.gesture({}, screen(1, 3), screen(1, 3))
    expect(c.state.selection).toMatchObject({ names: [], wires: ["wire:W"] })
    expect(c.commits).toEqual([])
  })

  test("a wire selected with parts has no corner handles: a press on its corner moves the group", () => {
    const c = canvas(["R1"], { wires: ["wire:W"] })
    expect(c.gesture({}, screen(7, 3), screen(7.6, 3))).toMatchObject({ kind: "drag", wire: "wire:W" })
    expect(c.shapes).toEqual([])
  })
})

describe("net labels and flags in the selection", () => {
  test("a plain press on a label selects it alone and drags it alone", () => {
    const c = canvas(["R1"])
    expect(c.gesture({}, screen(9), screen(9.6), screen(10))).toMatchObject({ kind: "label" })
    expect(c.state.selection).toMatchObject({ names: [], wires: [], labels: [FLAG.id] })
    expect(c.labelMoves).toEqual([{ id: FLAG.id, at: { x: 10, y: 0 } }])
    expect(c.commits).toEqual([])
  })

  test("Shift or Ctrl on a label adds it to the selection, and again takes it out", () => {
    const c = canvas(["R1"])
    expect(c.gesture({ shiftKey: true }, screen(9), screen(9))).toBeUndefined()
    expect(c.state.selection).toMatchObject({ names: ["R1"], labels: [FLAG.id] })
    c.gesture({ ctrlKey: true }, screen(9), screen(9))
    expect(c.state.selection).toMatchObject({ names: ["R1"], labels: [] })
    expect(c.labelMoves).toEqual([])
  })

  test("a drag on a selected part takes the selected labels along, in one commit", () => {
    const c = canvas(["R1"], { labels: [FLAG.id] })
    c.gesture({}, screen(1), screen(1.4), screen(2.1))
    expect(c.commits).toEqual([{ names: ["R1"], offset: { x: 1, y: 0 }, labels: [FLAG.id] }])
  })

  test("a drag on a label selected with other things moves the whole selection; a still click selects the label alone", () => {
    const c = canvas(["R1"], { wires: ["wire:W"], labels: [FLAG.id] })
    expect(c.gesture({}, screen(9), screen(9, 0.4), screen(9, 1))).toMatchObject({ kind: "drag", label: FLAG.id })
    expect(c.commits).toEqual([{ names: ["R1"], offset: { x: 0, y: 1 }, wires: ["wire:W"], labels: [FLAG.id] }])
    expect(c.labelMoves).toEqual([])
    c.gesture({}, screen(9), screen(9))
    expect(c.state.selection).toMatchObject({ names: [], wires: [], labels: [FLAG.id] })
  })

  test("a box takes the labels by the direction rule, and none while the Filter's labels row is off", () => {
    const inside = canvas()
    inside.gesture({}, screen(-2, 2), screen(10, -2))
    expect(inside.state.selection).toMatchObject({ names: ["R1", "R2"], labels: [FLAG.id] })
    const touching = canvas()
    touching.gesture({}, screen(10, 2), screen(9, -2))
    expect(touching.state.selection).toMatchObject({ names: [], labels: [FLAG.id] })
    const off = canvas([], { filter: { ...ALL_PICKABLE, labels: false } })
    off.gesture({}, screen(-2, 2), screen(10, -2))
    expect(off.state.selection).toMatchObject({ names: ["R1", "R2"], labels: [] })
  })
})

describe("the selection box over wires", () => {
  test("left to right takes the wires wholly inside, with the parts inside", () => {
    const c = canvas()
    c.gesture({}, screen(-2, 6), screen(8, -2))
    expect(c.state.selection).toMatchObject({ names: ["R1", "R2"], wires: ["wire:W"] })
    const partly = canvas(["R1"])
    partly.gesture({}, screen(-2, 6), screen(5, 2))
    expect(partly.state.selection).toBe(Selection.none)
  })

  test("right to left takes the wires it touches", () => {
    const c = canvas()
    c.gesture({}, screen(8, 4), screen(5, 2))
    expect(c.state.selection).toMatchObject({ names: [], wires: ["wire:W"] })
  })

  test("with Shift or Ctrl the box adds its wires; with Wires off in the Filter it takes none", () => {
    const adds = canvas(["R1"])
    adds.gesture({ shiftKey: true }, screen(8, 4), screen(5, 2))
    expect(adds.state.selection).toMatchObject({ names: ["R1"], wires: ["wire:W"] })
    const off = canvas([], { filter: { ...ALL_PICKABLE, wires: false } })
    off.gesture({}, screen(-2, 6), screen(8, -2))
    expect(off.state.selection).toMatchObject({ names: ["R1", "R2"], wires: [] })
  })
})

describe("reshaping a wire", () => {
  // The step is 0.5 here; at 10 px a unit a corner handle reaches 0.3 each way.
  test("a drag on a wire moves the segment under the press onto the grid, selects the wire and writes the new shape once", () => {
    const c = canvas(["R1"])
    expect(c.gesture({}, screen(1, 3), screen(1, 3.2), screen(1, 3.53))).toMatchObject({ kind: "reshape", grip: { kind: "segment", index: 1 } })
    expect(c.state.selection.wires).toEqual(["wire:W"])
    expect(c.shapes).toEqual([{ id: "wire:W", path: [{ x: -1, y: 5 }, { x: -1, y: 3.5 }, { x: 7, y: 3.5 }, { x: 7, y: 5 }] }])
    expect(c.commits).toEqual([])
  })

  test("with Snap off the segment lands where the pointer let go, rounded", () => {
    const c = canvas([], { snap: false })
    c.gesture({}, screen(1, 3), screen(1, 3.53))
    expect(c.shapes).toEqual([{ id: "wire:W", path: [{ x: -1, y: 5 }, { x: -1, y: 3.53 }, { x: 7, y: 3.53 }, { x: 7, y: 5 }] }])
  })

  test("a drag on a corner handle of the selected wire moves that corner to a grid point", () => {
    const c = canvas([], { wire: "wire:W" })
    expect(c.gesture({}, screen(7.2, 3.1), screen(7.8, 3.15))).toMatchObject({ kind: "reshape", grip: { kind: "corner", index: 2 } })
    expect(c.shapes).toEqual([{ id: "wire:W", path: [{ x: -1, y: 5 }, { x: -1, y: 3 }, { x: 7.5, y: 3 }, { x: 7.5, y: 5 }, { x: 7, y: 5 }] }])
    expect(c.state.selection.wires).toEqual(["wire:W"])
  })

  test("a press on that corner of a wire not selected drags the segment there instead", () => {
    const c = canvas()
    expect(c.gesture({}, screen(6.9, 3), screen(6.9, 3.6))).toMatchObject({ kind: "reshape", grip: { kind: "segment", index: 1 } })
  })

  test("a drag along a segment's own direction writes nothing", () => {
    const c = canvas()
    c.gesture({}, screen(1, 3), screen(3, 3))
    expect(c.shapes).toEqual([])
  })

  test("a blocked wire does not move: its reason is told once, on the first move, and nothing is written", () => {
    const c = canvas([], { wireBlocker: "R1 is locked" })
    c.gesture({}, screen(1, 3), screen(1, 3.1), screen(1, 3.6), screen(1, 4))
    expect(c.calls).toEqual(["notify R1 is locked"])
    expect(c.shapes).toEqual([])
    expect(c.state.selection.wires).toEqual(["wire:W"])
  })

  test("a still click on a blocked wire tells nothing", () => {
    const c = canvas([], { wireBlocker: "R1 is locked" })
    c.gesture({}, screen(1, 3), screen(1, 3))
    expect(c.calls).toEqual([])
  })

  test("with a Place tool armed a press on a wire only selects it", () => {
    const c = canvas([], { armed: "place" })
    expect(c.gesture({}, screen(1, 3), screen(1, 4))).toBeUndefined()
    expect(c.state.selection.wires).toEqual(["wire:W"])
    expect(c.shapes).toEqual([])
  })

  test("without drag tools (the W tool is wiring) a press on a wire or its handle only selects it", () => {
    const c = canvas([], { wire: "wire:W", noDrag: true })
    expect(c.gesture({}, screen(1, 3), screen(1, 4))).toBeUndefined()
    expect(c.gesture({}, screen(7, 3), screen(7.8, 3))).toBeUndefined()
    expect(c.state.selection.wires).toEqual(["wire:W"])
    expect(c.shapes).toEqual([])
  })

  test("with Wires off in the Filter, the selected wire's handle grabs nothing", () => {
    const c = canvas([], { wire: "wire:W", filter: { ...ALL_PICKABLE, wires: false } })
    expect(c.gesture({}, screen(7, 3), screen(7.8, 3))).toMatchObject({ kind: "box" })
    expect(c.shapes).toEqual([])
  })

  test("cancelling the drag (Esc) writes nothing and keeps the wire selected", () => {
    const c = canvas()
    const session = c.session()
    session.press(press(), screen(1, 3))
    session.move(screen(1, 3.6), 1)
    session.cancel()
    session.release(screen(1, 3.6))
    expect(c.shapes).toEqual([])
    expect(c.state.selection.wires).toEqual(["wire:W"])
  })

  test("a right press during the drag cancels it; letting both buttons go writes nothing and opens no menu", () => {
    const c = canvas()
    const session = c.session()
    session.press(press(), screen(1, 3))
    session.move(screen(1, 3.6), 1)
    expect(session.move(screen(1, 3.6), 3)).toBe(false)
    session.move(screen(1, 3.6), 2)
    session.release(screen(1, 3.6))
    expect(c.shapes).toEqual([])
    expect(c.menus).toEqual([])
  })

  test("a build that changes the wire during the drag: the release writes nothing and says why, once", () => {
    const c = canvas()
    const session = c.session()
    session.press(press(), screen(1, 3))
    session.move(screen(1, 3.6), 1)
    c.state.wirePoints = [{ x: -1, y: 5 }, { x: -1, y: 2 }, { x: 7, y: 2 }, { x: 7, y: 5 }]
    session.move(screen(1, 3.7), 1)
    session.release(screen(1, 3.7))
    expect(c.shapes).toEqual([])
    expect(c.calls).toEqual(["notify The wire changed while you dragged it; try again"])
  })

  test("a wire gone from the sheet during the drag is not written either", () => {
    const c = canvas()
    const session = c.session()
    session.press(press(), screen(1, 3))
    session.move(screen(1, 3.6), 1)
    c.state.wirePoints = undefined
    session.release(screen(1, 3.6))
    expect(c.shapes).toEqual([])
    expect(c.calls).toEqual(["notify The wire changed while you dragged it; try again"])
  })

  test("W pressed during the drag takes the drag tools away: the drag is dropped, so the wire goes back, and nothing is written", () => {
    const c = canvas()
    const session = c.session()
    session.press(press(), screen(1, 3))
    session.move(screen(1, 3.6), 1)
    const dragged = startGesture(c.input(), press(), screen(1, 3))
    c.state.noDrag = true
    if (!dragged) throw new Error("no gesture")
    expect(gestureLost(dragged, c.input().wires)).toBe(true)
    expect(session.move(screen(1, 3.7), 1)).toBe(false)
    session.release(screen(1, 3.7))
    expect(c.shapes).toEqual([])
    expect(c.calls).toEqual([])
  })

  test("only a reshape is lost with the drag tools; other gestures and a reshape that keeps them go on", () => {
    const c = canvas()
    const reshape = startGesture(c.input(), press(), screen(1, 3))
    const part = startGesture(c.input(), press(), screen(1))
    if (!reshape || !part) throw new Error("no gesture")
    expect(gestureLost(reshape, c.input().wires)).toBe(false)
    expect(gestureLost(part, { at: wireAt })).toBe(false)
  })

  test("a right press while parts are dragged does not cancel the part drag", () => {
    const c = canvas()
    const session = c.session()
    session.press(press(), screen(1))
    session.move(screen(2), 1)
    expect(session.move(screen(2), 3)).toBe(true)
    session.release(screen(2))
    expect(c.commits).toEqual([{ names: ["R1"], offset: { x: 1, y: 0 } }])
  })
})

describe("what a double click does", () => {
  const label: NetLabel = { id: "label:net.GND:R2.pin2", net: "net.GND", text: "GND", at: { x: 9, y: 0 }, side: "right", style: "ground" }
  const handle = { id: "wire:W", index: 2 }
  const wire = { kind: "wire", id: "wire:W" } as const
  const rows: [string, Parameters<typeof doubleClickAction>[0], ReturnType<typeof doubleClickAction>][] = [
    ["on a corner handle of a wire selected before it began: removes that corner", { busy: false, handle, target: wire, selectedBefore: "wire:W" }, { kind: "removeCorner", id: "wire:W", index: 2 }],
    ["on a corner handle of a wire the first click selected: Properties on that wire", { busy: false, handle, target: wire, selectedBefore: undefined }, { kind: "properties", target: wire }],
    ["on a handle while another wire was selected before: Properties", { busy: false, handle, target: wire, selectedBefore: "wire:other" }, { kind: "properties", target: wire }],
    ["elsewhere on a wire: Properties on its Wire section", { busy: false, handle: undefined, target: wire, selectedBefore: "wire:W" }, { kind: "properties", target: wire }],
    ["on a part: Properties", { busy: false, handle: undefined, target: { kind: "part", name: "R1" }, selectedBefore: undefined }, { kind: "properties", target: { kind: "part", name: "R1" } }],
    ["on a net label: renames its net", { busy: false, handle: undefined, target: { kind: "label", label }, selectedBefore: undefined }, { kind: "rename", label }],
    ["on empty canvas: nothing", { busy: false, handle: undefined, target: { kind: "canvas" }, selectedBefore: undefined }, { kind: "none" }],
    ["with a tool armed or wiring: nothing, even on a handle", { busy: true, handle, target: wire, selectedBefore: "wire:W" }, { kind: "none" }],
  ]
  test.each(rows)("%s", (_, input, expected) => {
    expect(doubleClickAction(input)).toEqual(expected)
  })

  test("the session remembers which wire was selected before the double click's first press", () => {
    const fresh = canvas()
    const session = fresh.session()
    expect(session.wireBeforeDoubleClick()).toBeUndefined()
    for (let click = 0; click < 2; click++) {
      session.press(press(), screen(7, 3))
      session.release(screen(7, 3))
    }
    expect(fresh.state.selection.wires).toEqual(["wire:W"])
    expect(session.wireBeforeDoubleClick()).toBeUndefined()
    const selected = canvas([], { wire: "wire:W" })
    const again = selected.session()
    for (let click = 0; click < 2; click++) {
      again.press(press(), screen(7, 3))
      again.release(screen(7, 3))
    }
    expect(again.wireBeforeDoubleClick()).toBe("wire:W")
  })
})

describe("Esc during a gesture", () => {
  test("drops a net label's drag and a wire's reshape, and leaves the others to Esc's own work", () => {
    expect(cancelsOnEscape("label")).toBe(true)
    expect(cancelsOnEscape("reshape")).toBe(true)
    for (const kind of ["drag", "box", "pan", "note", "zoom"] as const) expect(cancelsOnEscape(kind)).toBe(false)
    expect(cancelsOnEscape(undefined)).toBe(false)
  })
})

describe("the selection box", () => {
  test("left to right takes the parts wholly inside", () => {
    const c = canvas(["R2"])
    c.gesture({}, screen(-1, 2), screen(5, -2))
    expect(c.state.selection.names).toEqual(["R1"])
  })

  test("right to left takes every part it touches", () => {
    const c = canvas()
    c.gesture({}, screen(5, 2), screen(-1, -2))
    expect(c.state.selection.names).toEqual(["R1", "R2"])
  })

  test("with Shift or Ctrl the box adds to the selection", () => {
    const c = canvas(["R2"])
    c.gesture({ shiftKey: true }, screen(-1, 2), screen(3, -2))
    expect(c.state.selection.names).toEqual(["R2", "R1"])
  })

  test("a click on empty canvas clears the selection, and does not pan", () => {
    const c = canvas(["R1"])
    c.gesture({}, screen(8), screen(8.1))
    expect(c.state.selection).toBe(Selection.none)
    expect(c.state.camera).toBe(CAMERA)
  })
})

describe("the right and middle buttons", () => {
  test("a right drag pans and opens no menu", () => {
    const c = canvas()
    c.gesture({ button: 2 }, screen(8), screen(9))
    expect(c.state.camera.cx).toBeCloseTo(-1)
    expect(c.menus).toEqual([])
  })

  test("a right press released within 3 px opens the context menu on what it was over, at the pointer", () => {
    const c = canvas()
    c.gesture({ button: 2 }, screen(1), { x: screen(1).x + 2, y: screen(1).y })
    c.gesture({ button: 2 }, screen(8))
    expect(c.menus).toEqual([
      { target: { kind: "part", name: "R1" }, at: { x: 640, y: 480 } },
      { target: { kind: "canvas" }, at: { x: 640, y: 480 } },
    ])
  })

  test("a still right press puts an armed tool away instead", () => {
    const c = canvas([], { armed: "note" })
    c.gesture({ button: 2 }, screen(8))
    expect(c.menus).toEqual([])
    expect(c.calls).toEqual(["disarm"])
  })

  test("a middle drag pans; a still middle click changes nothing", () => {
    const c = canvas(["R1"])
    c.gesture({ button: 1 }, screen(8))
    expect(c.state.selection.names).toEqual(["R1"])
    c.gesture({ button: 1 }, screen(8), screen(9))
    expect(c.state.camera.cx).toBeCloseTo(-1)
  })
})

describe("the Note box tool", () => {
  test("a drag draws the box, asks for the note, places it at the box's centre and puts the tool away", () => {
    vi.stubGlobal("window", { prompt: () => "route ground here" })
    const c = canvas(["R1"], { armed: "note" })
    expect(c.gesture({}, screen(0, 2), screen(4, -2))).toMatchObject({ kind: "note" })
    expect(c.calls).toEqual(["disarm", 'mark route ground here {"view":"pcb","x":2,"y":0}'])
    expect(c.state.selection.names).toEqual(["R1"])
  })

  test("a click keeps the tool armed and asks nothing", () => {
    const c = canvas([], { armed: "note" })
    c.gesture({}, screen(8))
    expect(c.calls).toEqual([])
  })

  test("without the tool, Shift-drag selects instead of drawing a note box", () => {
    const c = canvas()
    expect(c.gesture({ shiftKey: true }, screen(-1, 2), screen(3, -2))).toMatchObject({ kind: "box", adds: true })
    expect(c.state.selection.names).toEqual(["R1"])
  })
})

describe("what a right click or a double click is on", () => {
  const label: NetLabel = { id: "label:net.GND:R2.pin2", net: "net.GND", text: "GND", at: { x: 9, y: 0 }, side: "right", style: "ground" }
  const labels = { at: (p: Point) => (p.x > 8 ? label : undefined), blocker: () => null, commit: () => undefined }

  test("a net label, else a part, else the empty canvas", () => {
    expect(targetAt(BOXES, labels, { x: 1, y: 0 }, PICK)).toEqual({ kind: "part", name: "R1" })
    expect(targetAt(BOXES, labels, { x: 9, y: 0 }, PICK)).toEqual({ kind: "label", label })
    expect(targetAt(BOXES, labels, { x: 7, y: 0 }, PICK)).toEqual({ kind: "canvas" })
  })

  test("the PCB has no labels, so there is only a part or the canvas", () => {
    expect(targetAt(BOXES, undefined, { x: 9, y: 0 }, PICK)).toEqual({ kind: "canvas" })
  })
})

describe("a group drag as the browser sends it", () => {
  // Nine parts in a row, 2 mm apart, each with its position written in the code, as in the check project.
  const NAMES = ["J1", "R1", "R2", "C1", "U1", "C2", "R3", "LED1", "J2"]
  const row = NAMES.map((name, i) => partBox(name, i * 3, i * 3 + 2))
  const prop = (literal: number) => ({ literal, source: `{${literal}}`, editable: true })
  const source = {
    model: {
      parts: NAMES.map((name, i) => ({ name, tag: "resistor", line: 1, props: { pcbX: prop(i * 3 + 1), pcbY: prop(0) }, editable: true, start: 0, end: 0 })),
      traces: [],
      drawings: [],
      skipped: [],
      imports: [],
    },
  }

  /**
   * A canvas held the way the hook holds it: one session for every event, which React draws later, so the press,
   * the moves and the release can all arrive before it draws once (the way Chrome sent them).
   */
  function nineParts() {
    const state = { selection: Selection.none.all(NAMES), drawn: 0 }
    const edits: string[] = []
    const actions = {
      edit: async (list: unknown[], summary: string) => (edits.push(`${list.length}: ${summary}`), true),
      notify: (text: string) => void edits.push(`notify ${text}`),
      mark: async () => true,
    }
    const input: GestureInput = {
      view: "pcb",
      camera: CAMERA,
      setCamera: () => undefined,
      size: SIZE,
      boxes: row,
      anchors: new Map(),
      step: 0.5,
      builtFrom: 0,
      circuit: source,
      actions,
      selection: state.selection,
      onSelect: (change: SelectionChange) => void (state.selection = change(state.selection)),
      blockerFor: (name) => moveBlocker(source, new Set(), name, "pcb"),
      tool: { armed: null, disarm: () => undefined },
      onContextMenu: () => undefined,
    }
    const commit = (names: readonly string[], offset: Point) => void sendGroupEdit(movePlan(input, names, offset), actions)
    const session = gestureSession(() => ({ input, commit }), () => void (state.drawn += 1))
    return { state, edits, session }
  }

  test("press on C1, eight moves of 5 px, release: all nine move in one edit and stay selected", async () => {
    const { state, edits, session } = nineParts()
    const c1 = screen(10)
    session.press(press(), c1)
    for (let step = 1; step <= 8; step++) session.move({ x: c1.x + 5 * step, y: c1.y })
    session.release({ x: c1.x + 40, y: c1.y })
    await Promise.resolve()
    expect(edits).toEqual(["9: move J1, R1, R2 and 6 more by (4, 0)"])
    expect(state.selection.names).toEqual(NAMES)
  })

  test("a drag the browser cancels writes nothing, and a release after it does nothing", async () => {
    const { state, edits, session } = nineParts()
    const c1 = screen(10)
    session.press(press(), c1)
    session.move({ x: c1.x + 20, y: c1.y }, 1)
    session.cancel()
    session.release({ x: c1.x + 20, y: c1.y })
    await Promise.resolve()
    expect(edits).toEqual([])
    expect(state.selection.names).toEqual(NAMES)
  })

  test("a move with no button held means the release was lost: the drag ends unwritten and the pointer hovers again", async () => {
    const { edits, session } = nineParts()
    const c1 = screen(10)
    session.press(press(), c1)
    expect(session.move({ x: c1.x + 20, y: c1.y }, 1)).toBe(true)
    expect(session.move({ x: c1.x + 30, y: c1.y }, 0)).toBe(false)
    expect(session.move({ x: c1.x + 40, y: c1.y }, 0)).toBe(false)
    session.release({ x: c1.x + 40, y: c1.y })
    await Promise.resolve()
    expect(edits).toEqual([])
  })

  test("a release without moving still selects the pressed part alone", () => {
    const { state, edits, session } = nineParts()
    session.press(press(), screen(10))
    session.move({ x: screen(10).x + 1, y: screen(10).y })
    session.release(screen(10))
    expect(edits).toEqual([])
    expect(state.selection.names).toEqual(["C1"])
  })
})

describe("the Fit area tool", () => {
  test("a drag draws a box the selection box looks like, fits the camera to it and puts the tool away", () => {
    const c = canvas(["R1"], { armed: "zoom" })
    // The box from (0, 2) to (4, -2) in world units, 40 by 40 px on a 200 by 200 view.
    expect(c.gesture({}, screen(0, 2), screen(4, -2))).toMatchObject({ kind: "zoom" })
    expect(c.calls).toEqual(["disarm"])
    expect(c.state.camera).toEqual({ cx: 2, cy: 0, scale: 50 })
    expect(c.state.selection.names).toEqual(["R1"])
  })

  test("the box fits the same from any corner to its opposite", () => {
    const forward = canvas([], { armed: "zoom" })
    forward.gesture({}, screen(0, 2), screen(4, -2))
    const backward = canvas([], { armed: "zoom" })
    backward.gesture({}, screen(4, -2), screen(0, 2))
    expect(backward.state.camera).toEqual(forward.state.camera)
  })

  test("a click keeps the tool armed and leaves the camera where it was", () => {
    const c = canvas([], { armed: "zoom" })
    c.gesture({}, screen(8))
    expect(c.calls).toEqual([])
    expect(c.state.camera).toEqual(CAMERA)
  })

  test("a left press on a part draws the box too: nothing is picked or dragged while the tool is armed", () => {
    const c = canvas([], { armed: "zoom" })
    expect(c.gesture({}, screen(1), screen(5, 1))).toMatchObject({ kind: "zoom" })
    expect(c.state.selection.names).toEqual([])
    expect(c.commits).toEqual([])
  })

  test("a right click puts the tool away without moving the camera", () => {
    const c = canvas([], { armed: "zoom" })
    c.gesture({ button: 2 }, screen(8))
    expect(c.calls).toEqual(["disarm"])
    expect(c.state.camera).toEqual(CAMERA)
  })

  test("the middle button still pans", () => {
    const c = canvas([], { armed: "zoom" })
    expect(c.gesture({ button: 1 }, screen(8), screen(9))).toMatchObject({ kind: "pan" })
  })
})

describe("snap while dragging", () => {
  // R1 sits with its centre at x=1; the grid step is 0.5. A drag of 0.3 lands on the grid, or where the pointer is.
  const dragBy = (c: ReturnType<typeof canvas>, dx: number) => c.gesture({}, screen(1), screen(1 + dx))

  test("on (and by default), the pressed part's origin goes to the grid", () => {
    for (const options of [{}, { snap: true }]) {
      const c = canvas([], options)
      dragBy(c, 0.3)
      expect(c.commits).toEqual([{ names: ["R1"], offset: { x: 0.5, y: 0 } }])
    }
  })

  test("off, the part moves exactly with the pointer, rounded to four decimals", () => {
    const c = canvas([], { snap: false })
    dragBy(c, 0.3)
    expect(c.commits).toEqual([{ names: ["R1"], offset: { x: 0.3, y: 0 } }])
    const fine = canvas([], { snap: false })
    dragBy(fine, 0.654321)
    expect(fine.commits[0]?.offset.x).toBe(0.6543)
  })

  test("off, a group still moves by one offset, so it keeps its shape", () => {
    const c = canvas(["R1", "R2"], { snap: false })
    dragBy(c, 0.3)
    expect(c.commits).toEqual([{ names: ["R1", "R2"], offset: { x: 0.3, y: 0 } }])
  })
})
