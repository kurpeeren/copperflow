import { afterEach, describe, expect, test, vi } from "vitest"
import type { NetLabel } from "../src/engine/schematic.js"
import { endGesture, followGesture, gestureSession, movePlan, startGesture, targetAt, type Gesture, type GestureInput } from "../studio/src/pcb/gestures.js"
import { sendGroupEdit } from "../studio/src/pcb/group-edits.js"
import { moveBlocker } from "../studio/src/pcb/positions.js"
import { worldToScreen, type Camera, type PartBox, type Point } from "../studio/src/pcb/geometry.js"
import type { PickContext } from "../studio/src/pcb/pick.js"
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
// A wire along y = 3, above both parts and clear of the boxes the other tests draw.
const WIRES = { at: (p: Point) => (Math.abs(p.y - 3) < 0.1 ? "wire:W" : undefined) }

/** A canvas with R1 and R2: what the steps told it, and the selection they left. */
function canvas(start: readonly string[] = [], options: { locked?: string[]; armed?: ArmedTool; snap?: boolean; wire?: string } = {}) {
  const calls: string[] = []
  const state = { selection: options.wire ? Selection.none.onlyWire(options.wire) : Selection.none.add(start), camera: CAMERA }
  const commits: { names: readonly string[]; offset: Point }[] = []
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
    circuit: { model: { parts: [], traces: [], skipped: [], imports: [] } },
    actions,
    selection: state.selection,
    onSelect: (change: SelectionChange) => void (state.selection = change(state.selection)),
    blockerFor: (name) => (options.locked?.includes(name) ? `${name} is locked` : null),
    tool: { armed: options.armed ?? null, disarm: () => void calls.push("disarm") },
    onContextMenu: (target, at) => void menus.push({ target, at }),
    wires: WIRES,
  })
  /** Presses at `from`, moves through `path` and lets go at the last point, as the hook does. */
  const gesture = (held: Partial<Press>, from: Point, ...path: Point[]) => {
    let current: Gesture | undefined = startGesture(input(), press(held), from)
    const started = current
    for (const point of path) current = (current && followGesture(input(), current, point, CAMERA)) ?? current
    if (current) endGesture(input(), current, CAMERA, (names, offset) => void commits.push({ names, offset }), { x: 640, y: 480 })
    return started
  }
  return { state, calls, commits, menus, gesture }
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
    expect(c.gesture({}, screen(1, 3), screen(3, 3))).toBeUndefined()
    expect(c.state.selection.wire).toBe("wire:W")
    expect(c.state.selection.names).toEqual([])
    expect(c.commits).toEqual([])
  })

  test("a click on a part, or on empty canvas, drops the selected wire", () => {
    const onPart = canvas([], { wire: "wire:W" })
    onPart.gesture({}, screen(1), screen(1))
    expect(onPart.state.selection).toMatchObject({ names: ["R1"], wire: undefined })
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

  test("a part, else a net label, else the empty canvas", () => {
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
