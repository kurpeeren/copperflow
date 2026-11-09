import { afterEach, describe, expect, test, vi } from "vitest"
import type { NetLabel } from "../src/engine/schematic.js"
import { endGesture, followGesture, startGesture, targetAt, type Gesture, type GestureInput } from "../studio/src/pcb/gestures.js"
import { worldToScreen, type Camera, type PartBox, type Point } from "../studio/src/pcb/geometry.js"
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
const press = (held: Partial<Press> = {}): Press => ({ button: 0, shiftKey: false, ctrlKey: false, metaKey: false, ...held })

/** A canvas with R1 and R2: what the steps told it, and the selection they left. */
function canvas(start: readonly string[] = [], options: { locked?: string[]; armed?: ArmedTool } = {}) {
  const calls: string[] = []
  const state = { selection: Selection.none.add(start), camera: CAMERA }
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
    builtFrom: 0,
    circuit: { model: { parts: [], traces: [], skipped: [], imports: [] } },
    actions,
    selection: state.selection,
    onSelect: (change: SelectionChange) => void (state.selection = change(state.selection)),
    blockerFor: (name) => (options.locked?.includes(name) ? `${name} is locked` : null),
    tool: { armed: options.armed ?? null, disarm: () => void calls.push("disarm") },
    onContextMenu: (target, at) => void menus.push({ target, at }),
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
    expect(targetAt(BOXES, labels, { x: 1, y: 0 })).toEqual({ kind: "part", name: "R1" })
    expect(targetAt(BOXES, labels, { x: 9, y: 0 })).toEqual({ kind: "label", label })
    expect(targetAt(BOXES, labels, { x: 7, y: 0 })).toEqual({ kind: "canvas" })
  })

  test("the PCB has no labels, so there is only a part or the canvas", () => {
    expect(targetAt(BOXES, undefined, { x: 9, y: 0 })).toEqual({ kind: "canvas" })
  })
})
