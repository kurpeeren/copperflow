import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import { busMembers } from "../src/engine/drawing-kinds.js"
import { buildDesign } from "../src/engine/design.js"
import { busNameProblem, membersText, newDrawingId, nextBusName } from "../studio/src/pcb/bus-tool.js"
import { drawHint, drawingEdit, drawStep, drawSummary, idleState, keepsFocus, previewDrawing, sentDrawing, type DrawEvent, type DrawState } from "../studio/src/pcb/draw-tools.js"

const FILE = "main.circuit.tsx"
const SOURCE = `export default () => (
  <board width="40mm" height="30mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <bus name="BUS1" points={[{ x: 0, y: 6 }, { x: 4, y: 6 }]} />
    <bus name="D[0:7]" points={[{ x: 0, y: 8 }, { x: 4, y: 8 }]} />
    <schematicrect name="G1" x={1} y={2} width={3} height={1.5} />
  </board>
)`
const model = analyzeCircuit(SOURCE)

const p = (x: number, y: number) => ({ x, y })
const press = (x: number, y: number, extra: { shift?: boolean; double?: boolean } = {}): DrawEvent => ({ type: "press", at: p(x, y), shift: extra.shift ?? false, double: extra.double ?? false })

function run(events: readonly DrawEvent[]) {
  let state: DrawState | null = idleState("bus")
  const written = []
  for (const event of events) {
    if (!state) throw new Error("the tool was put away")
    const step = drawStep(state, event)
    state = step.state
    if (step.drawing) written.push(step.drawing)
  }
  return { state, written }
}

describe("the member list from a bus name (the engine's busMembers)", () => {
  test("a rising range, a falling range and a plain name", () => {
    expect(busMembers("D[0:7]")).toEqual(["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"])
    expect(busMembers("A[3:0]")).toEqual(["A3", "A2", "A1", "A0"])
    expect(busMembers("CLK")).toEqual(["CLK"])
    expect(busMembers("D[0:7")).toBeUndefined()
  })

  test("membersText: the first and last member and the count", () => {
    expect(membersText(["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"])).toBe("D0 … D7, 8 members")
    expect(membersText(["A1", "A0"])).toBe("A1, A0, 2 members")
    expect(membersText(["CLK"])).toBe("CLK, 1 member")
  })
})

describe("the bus name", () => {
  test("the next free BUS<n>, after the names sent but not built", () => {
    expect(nextBusName(model)).toBe("BUS2")
    expect(nextBusName(model, ["BUS2"])).toBe("BUS3")
    expect(nextBusName(analyzeCircuit(`export default () => (<board width="10mm" height="10mm" />)`))).toBe("BUS1")
  })

  test("validated like the engine: a range, a falling range, a plain name; another bus's name is one more piece", () => {
    expect(busNameProblem(model, "A[3:0]")).toBeUndefined()
    expect(busNameProblem(model, "CLK")).toBeUndefined()
    expect(busNameProblem(model, "D[0:7]")).toBeUndefined()
    expect(busNameProblem(model, "  ")).toBe("Name the bus, such as D[0:7] or CLK")
    expect(busNameProblem(model, "D[0:7")).toBe('"D[0:7" is not a valid bus name; use a net name such as "CLK" or a range such as "D[0:7]"')
    expect(busNameProblem(model, "R1")).toBe("A part named R1 already exists")
    expect(busNameProblem(model, "G1")).toBe("A drawing named G1 already exists")
  })

  test("a renamed bus may keep its own name", () => {
    expect(busNameProblem(model, "BUS1", "BUS1")).toBeUndefined()
  })

  test("the id a new drawing will get: its name, or name~n for one more piece of a bus", () => {
    expect(newDrawingId(model, "A[3:0]")).toBe("A[3:0]")
    expect(newDrawingId(model, "D[0:7]")).toBe("D[0:7]~2")
  })
})

describe("the bus tool", () => {
  test("draws like a polyline, then asks for the name at Enter; nothing is written yet", () => {
    const { state, written } = run([press(0, 0), press(2, 0), { type: "finish" }])
    expect(written).toEqual([])
    expect(state).toMatchObject({ tool: "bus", points: [p(0, 0), p(2, 0)], naming: true })
  })

  test("a double click finishes too; Shift squares a leg and Space flips its bend", () => {
    expect(run([press(0, 0), press(2, 1, { shift: true }), press(2, 1, { double: true })]).state).toMatchObject({ points: [p(0, 0), p(2, 0), p(2, 1)], naming: true })
    expect(run([press(0, 0), { type: "flip" }, press(2, 1, { shift: true }), { type: "finish" }]).state).toMatchObject({ points: [p(0, 0), p(0, 1), p(2, 1)] })
  })

  test("the name writes the bus with its points; the tool waits for the next one", () => {
    const { state, written } = run([press(0, 0), press(2, 0), { type: "finish" }, { type: "text", text: " D[0:3] " }])
    expect(written).toEqual([{ tag: "bus", name: "D[0:3]", props: { points: [p(0, 0), p(2, 0)] } }])
    expect(state).toEqual(idleState("bus"))
  })

  test("a name the engine refuses writes nothing and keeps the field open", () => {
    const { state, written } = run([press(0, 0), press(2, 0), { type: "finish" }, { type: "text", text: "D[0:" }])
    expect(written).toEqual([])
    expect(state).toMatchObject({ naming: true })
  })

  test("Esc while naming drops the bus; presses, Backspace and Space while naming change nothing", () => {
    expect(run([press(0, 0), press(2, 0), { type: "finish" }, { type: "cancel" }]).state).toEqual(idleState("bus"))
    const naming = run([press(0, 0), press(2, 0), { type: "finish" }]).state
    const after = run([press(0, 0), press(2, 0), { type: "finish" }, press(5, 5), { type: "removeCorner" }, { type: "flip" }]).state
    expect(after).toEqual(naming)
  })

  test("a press while the name field is open keeps the focus in the field", () => {
    expect(keepsFocus(run([press(0, 0), press(2, 0), { type: "finish" }]).state, 0)).toBe(true)
    expect(keepsFocus(run([press(0, 0)]).state, 0)).toBe(false)
  })

  test("a lone point is not a bus; Backspace removes a corner", () => {
    expect(run([press(0, 0), { type: "finish" }]).state).toEqual(idleState("bus"))
    expect(run([press(0, 0), press(1, 0), { type: "removeCorner" }]).state).toMatchObject({ points: [p(0, 0)] })
  })

  test("the preview is the bus to the pointer, then the whole bus while it is named", () => {
    const drawing = run([press(0, 0)]).state as DrawState
    expect(previewDrawing(drawing, p(1, 0), false)).toMatchObject({ kind: "bus", points: [p(0, 0), p(1, 0)] })
    const naming = run([press(0, 0), press(2, 0), { type: "finish" }]).state as DrawState
    expect(previewDrawing(naming, p(9, 9), false)).toMatchObject({ kind: "bus", points: [p(0, 0), p(2, 0)] })
  })

  test("the hint names each step", () => {
    expect(drawHint(idleState("bus"))).toBe("Click to start a bus, Enter to finish, then name it. Esc or a right click stops.")
    expect(drawHint(run([press(0, 0), press(2, 0), { type: "finish" }]).state)).toBe("Name the bus, such as D[0:7] or CLK; Enter writes it, Esc cancels.")
  })
})

describe("the bus edit", () => {
  const bus = { tag: "bus" as const, name: "A[3:0]", props: { points: [p(0, 10), p(3, 10)] } }

  test("addDrawing with the typed name, built by the engine with its members", () => {
    const edit = drawingEdit(bus, model)
    expect(edit).toEqual({ kind: "addDrawing", tag: "bus", name: "A[3:0]", props: { points: [p(0, 10), p(3, 10)] } })
    const design = buildDesign({ [FILE]: applyEdits(SOURCE, [edit], new Set()) }, FILE)
    expect(design.schematic.drawings.find((d) => d.id === "A[3:0]")).toMatchObject({ kind: "bus", name: "A[3:0]", members: ["A3", "A2", "A1", "A0"], points: [p(0, 10), p(3, 10)] })
    expect(drawSummary("bus", "A[3:0]")).toBe("add the bus A[3:0]")
  })

  test("one more piece of a bus gets the id the tool waits for", () => {
    const edit = drawingEdit({ ...bus, name: "D[0:7]" }, model)
    const design = buildDesign({ [FILE]: applyEdits(SOURCE, [edit], new Set()) }, FILE)
    expect(design.schematic.drawings.filter((d) => d.kind === "bus" && d.name === "D[0:7]").map((d) => d.id)).toContain(newDrawingId(model, "D[0:7]"))
  })

  test("a sent bus is drawn as the bus until its build", () => {
    expect(sentDrawing(bus, "A[3:0]")).toMatchObject({ id: "A[3:0]", kind: "bus", name: "A[3:0]", members: ["A3", "A2", "A1", "A0"], points: [p(0, 10), p(3, 10)] })
  })
})
