import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import { buildDesign } from "../src/engine/design.js"
import {
  DOUBLE_CLICK_MS,
  DOUBLE_CLICK_PX,
  drawHint,
  drawingEdit,
  drawStep,
  idleState,
  isDoubleClick,
  previewDrawing,
  toolPoint,
  type DrawEvent,
  type DrawState,
  type DrawTool,
} from "../studio/src/pcb/draw-tools.js"

const FILE = "main.circuit.tsx"
const SOURCE = `export default () => (
  <board width="40mm" height="30mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <schematicrect name="G2" x={1} y={2} width={3} height={1.5} />
  </board>
)`

const p = (x: number, y: number) => ({ x, y })
const press = (x: number, y: number, extra: { shift?: boolean; double?: boolean } = {}): DrawEvent => ({ type: "press", at: p(x, y), shift: extra.shift ?? false, double: extra.double ?? false })

/** Runs the events from the tool's idle state; the last step's state and every drawing written on the way. */
function run(tool: DrawTool, events: readonly DrawEvent[]) {
  let state: DrawState | null = idleState(tool)
  const written = []
  for (const event of events) {
    if (!state) throw new Error("the tool was put away")
    const step = drawStep(state, event)
    state = step.state
    if (step.drawing) written.push(step.drawing)
  }
  return { state, written }
}

describe("toolPoint", () => {
  test("snaps to the grid step while Snap is on, and rounds to 4 decimals", () => {
    expect(toolPoint(p(0.26, -0.14), 0.1, true)).toEqual(p(0.3, -0.1))
    expect(toolPoint(p(0.123456, 1.000049), 0.1, false)).toEqual(p(0.1235, 1))
  })
})

describe("isDoubleClick", () => {
  test("a second press close in time and place", () => {
    const first = { at: p(100, 100), time: 1000 }
    expect(isDoubleClick(first, { at: p(102, 101), time: 1000 + DOUBLE_CLICK_MS - 1 })).toBe(true)
    expect(isDoubleClick(first, { at: p(102, 101), time: 1000 + DOUBLE_CLICK_MS + 1 })).toBe(false)
    expect(isDoubleClick(first, { at: p(100 + DOUBLE_CLICK_PX + 1, 100), time: 1001 })).toBe(false)
    expect(isDoubleClick(undefined, { at: p(0, 0), time: 0 })).toBe(false)
  })
})

describe("the polyline", () => {
  test("click start, click corners, Enter writes the points", () => {
    const { state, written } = run("polyline", [press(0, 0), press(1, 0), press(1, 1), { type: "finish" }])
    expect(written).toEqual([{ tag: "schematicpath", props: { points: [p(0, 0), p(1, 0), p(1, 1)] } }])
    expect(state).toEqual(idleState("polyline"))
  })

  test("a double click finishes and its second click is not a corner", () => {
    const { written } = run("polyline", [press(0, 0), press(2, 1), press(2.0001, 1, { double: true })])
    expect(written).toEqual([{ tag: "schematicpath", props: { points: [p(0, 0), p(2, 1)] } }])
  })

  test("without Shift a leg runs at any angle; with Shift it is squared, and Space flips its bend", () => {
    expect(run("polyline", [press(0, 0), press(1, 2), { type: "finish" }]).written[0]?.props.points).toEqual([p(0, 0), p(1, 2)])
    expect(run("polyline", [press(0, 0), press(1, 2, { shift: true }), { type: "finish" }]).written[0]?.props.points).toEqual([p(0, 0), p(1, 0), p(1, 2)])
    const flipped = run("polyline", [press(0, 0), { type: "flip" }, press(1, 2, { shift: true }), { type: "finish" }])
    expect(flipped.written[0]?.props.points).toEqual([p(0, 0), p(0, 2), p(1, 2)])
  })

  test("Backspace removes the last corner; removing the start leaves the tool waiting", () => {
    const { state } = run("polyline", [press(0, 0), press(1, 0), press(1, 1), { type: "removeCorner" }])
    expect(state?.points).toEqual([p(0, 0), p(1, 0)])
    expect(run("polyline", [press(0, 0), { type: "removeCorner" }]).state).toEqual(idleState("polyline"))
  })

  test("a click on the last corner adds nothing; one point alone writes nothing", () => {
    expect(run("polyline", [press(0, 0), press(0, 0)]).state?.points).toEqual([p(0, 0)])
    const lone = run("polyline", [press(0, 0), { type: "finish" }])
    expect(lone.written).toEqual([])
    expect(lone.state).toEqual(idleState("polyline"))
  })

  test("Esc drops the line in progress and stays armed; Esc with nothing in progress puts the tool away", () => {
    expect(run("polyline", [press(0, 0), press(1, 0), { type: "cancel" }])).toEqual({ state: idleState("polyline"), written: [] })
    expect(run("polyline", [{ type: "cancel" }]).state).toBeNull()
  })

  test("the preview runs from the corners to the pointer, squared with Shift, dashed", () => {
    const state = run("polyline", [press(0, 0)]).state as DrawState
    expect(previewDrawing(state, p(1, 2), false)).toMatchObject({ kind: "path", points: [p(0, 0), p(1, 2)], lineStyle: "dashed" })
    expect(previewDrawing(state, p(1, 2), true)).toMatchObject({ kind: "path", points: [p(0, 0), p(1, 0), p(1, 2)] })
    expect(previewDrawing(idleState("polyline"), p(1, 2), false)).toBeUndefined()
  })
})

describe("the rectangle", () => {
  test("press-drag by two corners writes the lower-left corner, width and height", () => {
    const { written, state } = run("rectangle", [press(3, 2), { type: "release", at: p(1, 4) }])
    expect(written).toEqual([{ tag: "schematicrect", props: { x: 1, y: 2, width: 2, height: 2 } }])
    expect(state).toEqual(idleState("rectangle"))
  })

  test("click-click: the release on the first corner waits for the second click", () => {
    const first = run("rectangle", [press(0, 0), { type: "release", at: p(0, 0) }])
    expect(first.written).toEqual([])
    expect(first.state).toMatchObject({ points: [p(0, 0)], dragging: false })
    const done = run("rectangle", [press(0, 0), { type: "release", at: p(0, 0) }, press(2, 1), { type: "release", at: p(2, 1) }])
    expect(done.written).toEqual([{ tag: "schematicrect", props: { x: 0, y: 0, width: 2, height: 1 } }])
  })

  test("a flat rectangle is not written; the tool keeps waiting", () => {
    const { written, state } = run("rectangle", [press(0, 0), { type: "release", at: p(0, 0) }, press(2, 0)])
    expect(written).toEqual([])
    expect(state?.points).toEqual([p(0, 0)])
  })

  test("the preview is the rectangle to the pointer; Esc drops it", () => {
    const state = run("rectangle", [press(0, 0)]).state as DrawState
    expect(previewDrawing(state, p(-1, 2), false)).toMatchObject({ kind: "rect", x: -1, y: 0, width: 1, height: 2, lineStyle: "dashed" })
    expect(drawStep(state, { type: "cancel" }).state).toEqual(idleState("rectangle"))
  })
})

describe("the circle", () => {
  test("centre, then a click that sets the radius", () => {
    const { written } = run("circle", [press(1, 1), press(4, 5)])
    expect(written).toEqual([{ tag: "schematiccircle", props: { x: 1, y: 1, radius: 5 } }])
  })

  test("a radius of 0 is not written, and the preview follows the pointer", () => {
    const state = run("circle", [press(1, 1), press(1, 1)]).state as DrawState
    expect(state.points).toEqual([p(1, 1)])
    expect(previewDrawing(state, p(1, 3), false)).toMatchObject({ kind: "circle", x: 1, y: 1, radius: 2 })
  })
})

describe("the arc", () => {
  test("centre, start (radius and start angle), end (end angle), counter-clockwise degrees", () => {
    const { written } = run("arc", [press(0, 0), press(2, 0), press(0, 3)])
    expect(written).toEqual([{ tag: "schematicarc", props: { x: 0, y: 0, radius: 2, startAngle: 0, endAngle: 90 } }])
  })

  test("angles below the x axis are given from 0 to 360", () => {
    const { written } = run("arc", [press(0, 0), press(0, -1), press(-1, 0)])
    expect(written[0]?.props).toEqual({ x: 0, y: 0, radius: 1, startAngle: 270, endAngle: 180 })
  })

  test("Backspace steps back a click; the preview shows the radius, then the arc", () => {
    const centred = run("arc", [press(0, 0)]).state as DrawState
    expect(previewDrawing(centred, p(1, 0), false)).toMatchObject({ kind: "path", points: [p(0, 0), p(1, 0)] })
    const started = drawStep(centred, press(1, 0)).state as DrawState
    expect(previewDrawing(started, p(0, 5), false)).toMatchObject({ kind: "arc", radius: 1, startAngle: 0, endAngle: 90 })
    expect(drawStep(started, { type: "removeCorner" }).state).toEqual(centred)
  })
})

describe("the text", () => {
  test("a click opens the field at the point; Enter writes the text, size 0.1, anchored left", () => {
    const { written, state } = run("text", [press(1, 2), { type: "text", text: "Power stage" }])
    expect(written).toEqual([{ tag: "schematictext", props: { x: 1, y: 2, text: "Power stage", fontSize: 0.1, anchor: "left" } }])
    expect(state).toEqual(idleState("text"))
  })

  test("an empty text writes nothing; Esc closes the field; a second click moves it", () => {
    expect(run("text", [press(1, 2), { type: "text", text: "  " }])).toEqual({ state: idleState("text"), written: [] })
    expect(run("text", [press(1, 2), { type: "cancel" }]).state).toEqual(idleState("text"))
    expect(run("text", [press(1, 2), press(3, 3)]).state?.points).toEqual([p(3, 3)])
  })
})

describe("drawingEdit", () => {
  test("names the drawing G<n> after the highest G number", () => {
    const model = analyzeCircuit(SOURCE)
    const edit = drawingEdit({ tag: "schematicpath", props: { points: [p(0, 0), p(1, 0)] } }, model)
    expect(edit).toEqual({ kind: "addDrawing", tag: "schematicpath", name: "G3", props: { points: [p(0, 0), p(1, 0)] } })
  })

  test("skips the names of drawings sent and not yet built", () => {
    const model = analyzeCircuit(SOURCE)
    expect(drawingEdit({ tag: "schematiccircle", props: { x: 0, y: 0, radius: 1 } }, model, ["G3", "G4"]).name).toBe("G5")
    expect(drawingEdit({ tag: "schematiccircle", props: { x: 0, y: 0, radius: 1 } }, model, ["G1"]).name).toBe("G3")
  })

  test("every tool's edit goes through the core and comes back from the engine as drawn", () => {
    const model = analyzeCircuit(SOURCE)
    const drawings = [
      run("polyline", [press(0, 0), press(1, 0), { type: "finish" }]),
      run("rectangle", [press(0, 0), { type: "release", at: p(1, 1) }]),
      run("circle", [press(0, 0), press(0, 1)]),
      run("arc", [press(0, 0), press(1, 0), press(0, 1)]),
      run("text", [press(0, 0), { type: "text", text: "Hi" }]),
    ].map((r) => r.written[0])
    for (const drawing of drawings) {
      if (!drawing) throw new Error("nothing written")
      const edit = drawingEdit(drawing, model)
      const design = buildDesign({ [FILE]: applyEdits(SOURCE, [edit], new Set()) }, FILE)
      const made = design.schematic.drawings.find((d) => d.id === "G3")
      expect([drawing.tag, made && { ...made, ...drawing.props }]).toEqual([drawing.tag, made])
    }
  })
})

describe("drawHint", () => {
  test("says what the next click does", () => {
    expect(drawHint(idleState("polyline"))).toBe("Click to start a polyline, Enter to finish. Esc or a right click stops.")
    expect(drawHint(run("polyline", [press(0, 0)]).state)).toMatch(/^Click for each corner/)
    expect(drawHint(run("arc", [press(0, 0), press(1, 0)]).state)).toMatch(/^Click where the arc ends/)
    expect(drawHint(null)).toBeUndefined()
  })
})
