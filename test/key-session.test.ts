import { describe, expect, test } from "vitest"
import type { Edit, PartInfo } from "../src/core/types.js"
import type { PartBox } from "../studio/src/pcb/geometry.js"
import type { GroupEditActions, Layout } from "../studio/src/pcb/group-edits.js"
import type { BuildStatus } from "../studio/src/pcb/key-burst.js"
import { keySession, type EditInput } from "../studio/src/pcb/key-session.js"
import { moveBlocker, ZERO, type Anchor, type SourceCircuit } from "../studio/src/pcb/positions.js"
import { Selection } from "../studio/src/selection.js"

const prop = (literal: number) => ({ literal, source: String(literal), editable: true })

function part(name: string, x: number, y: number): PartInfo {
  return { name, tag: "resistor", line: 1, props: { pcbX: prop(x), pcbY: prop(y), pcbRotation: prop(0) }, editable: true, start: 0, end: 0 }
}

const circuitOf = (parts: PartInfo[]): SourceCircuit => ({ model: { parts, traces: [], skipped: [], imports: [] } })

/** What the server writes: each setProps edit's literals. */
function applied(circuit: SourceCircuit, edits: readonly Edit[]): SourceCircuit {
  const parts = circuit.model.parts.map((p) => {
    const props = edits.flatMap((edit) => (edit.kind === "setProps" && edit.part === p.name ? Object.entries(edit.props) : []))
    return props.length === 0 ? p : { ...p, props: { ...p.props, ...Object.fromEntries(props.map(([key, value]) => [key, prop(value as number)])) } }
  })
  return circuitOf(parts)
}

const literal = (circuit: SourceCircuit, name: string, key: string) => circuit.model.parts.find((p) => p.name === name)?.props[key]?.literal

/** What a build draws: each part at its literal position, in a 1 by 1 box; `hidden` parts are not in this view. */
function built(circuit: SourceCircuit, hidden: readonly string[] = []): Layout {
  const shown = circuit.model.parts.filter((p) => !hidden.includes(p.name))
  const at = (p: PartInfo) => ({ x: literal(circuit, p.name, "pcbX") as number, y: literal(circuit, p.name, "pcbY") as number })
  const anchors = new Map<string, Anchor>(shown.map((p) => [p.name, { origin: at(p), group: ZERO, autoPlaced: false }]))
  const boxes: PartBox[] = shown.map((p) => {
    const { x, y } = at(p)
    return { name: p.name, pcbComponentId: p.name, center: { x, y }, box: { minX: x - 0.5, minY: y - 0.5, maxX: x + 0.5, maxY: y + 0.5 } }
  })
  return { anchors, boxes, step: 1 }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Studio around one key session: an edit is answered when the test says (and the circuit reloads with it), and a
 * build lands when the test says, drawing the circuit as it is then. The canvas settles after every change it draws.
 */
function bench(start: SourceCircuit, names: readonly string[], options: { hidden?: readonly string[]; fail?: boolean } = {}) {
  let circuit = start
  let layout = built(start, options.hidden)
  let builds = 0
  let buildId = "b0"
  let build: BuildStatus = "done"
  const holding: boolean[] = []
  const answers: (() => void)[] = []
  const sent: string[] = []
  const notes: string[] = []
  const actions: GroupEditActions = {
    edit: (edits, summary) =>
      new Promise((resolve) => {
        sent.push(summary)
        answers.push(() => {
          if (!options.fail) circuit = applied(circuit, edits)
          resolve(!options.fail)
        })
      }),
    notify: (text) => void notes.push(text),
  }
  const session = keySession({ resolved: () => undefined, holding: (on) => void holding.push(on) })
  const input = (): EditInput => ({
    view: "pcb",
    selection: Selection.none.all(names),
    circuit,
    actions,
    blockerFor: (name) => moveBlocker(circuit, new Set(), name, "pcb"),
    layout,
    buildId,
    buildStatus: build,
    moveWaiting: false,
  })
  return {
    sent,
    holding,
    notes,
    input,
    circuit: () => circuit,
    rotate: (repeat = false) => session.rotate(input(), repeat),
    nudge: (steps: number) => session.nudge(input(), { action: "nudgeRight", preventDefault: true, steps }),
    /** The server answers the oldest edit; the circuit reloads, and the canvas settles. */
    async answer() {
      answers.shift()?.()
      await flush()
      session.settle(input())
    },
    /** A build finishes with a new id, drawing the circuit as it is then; a failed one keeps the design it had. */
    build(ok = true) {
      builds += 1
      buildId = `b${builds}`
      build = ok ? "done" : "failed"
      if (ok) layout = built(circuit, options.hidden)
      session.settle(input())
    },
  }
}

const at = (circuit: SourceCircuit, name: string) => [literal(circuit, name, "pcbX"), literal(circuit, name, "pcbY"), literal(circuit, name, "pcbRotation")]

describe("two quick group rotates", () => {
  const start = circuitOf([part("R1", 0, 0), part("R2", 4, 0)])

  async function sequential(): Promise<SourceCircuit> {
    const studio = bench(start, ["R1", "R2"])
    studio.rotate()
    await studio.answer()
    studio.build()
    studio.rotate()
    await studio.answer()
    return studio.circuit()
  }

  test("a second press after the first edit resolved, before the rebuild, waits for the build and turns about the same centre", async () => {
    const studio = bench(start, ["R1", "R2"])
    studio.rotate()
    await studio.answer()
    expect(at(studio.circuit(), "R1")).toEqual([2, -2, 90])
    expect(at(studio.circuit(), "R2")).toEqual([2, 2, 90])
    studio.rotate()
    expect(studio.sent).toHaveLength(1)
    studio.build()
    expect(studio.sent).toHaveLength(2)
    await studio.answer()
    expect(at(studio.circuit(), "R1")).toEqual([4, 0, 180])
    expect(at(studio.circuit(), "R2")).toEqual([0, 0, 180])
    expect(studio.circuit()).toEqual(await sequential())
  })

  test("a second press while the first edit is in flight is held too, not dropped", async () => {
    const studio = bench(start, ["R1", "R2"])
    studio.rotate()
    studio.rotate()
    await studio.answer()
    expect(studio.sent).toHaveLength(1)
    studio.build()
    await studio.answer()
    expect(studio.circuit()).toEqual(await sequential())
  })

  test("a key held down turns once: its repeats are not held", async () => {
    const studio = bench(start, ["R1", "R2"])
    studio.rotate()
    studio.rotate(true)
    studio.rotate(true)
    await studio.answer()
    studio.build()
    expect(studio.sent).toHaveLength(1)
  })

  test("a failed rotate drops the press held behind it and leaves the gate open", async () => {
    const studio = bench(start, ["R1", "R2"], { fail: true })
    studio.rotate()
    studio.rotate()
    await studio.answer()
    studio.build()
    expect(studio.sent).toHaveLength(1)
    studio.rotate()
    expect(studio.sent).toHaveLength(2)
  })

  test("a rotate after an arrow press waits for the arrow's build", async () => {
    const studio = bench(start, ["R1", "R2"])
    studio.nudge(1)
    await studio.answer()
    studio.rotate()
    expect(studio.sent).toEqual(["move R1 and R2 by (1, 0)"])
    studio.build()
    expect(studio.sent).toEqual(["move R1 and R2 by (1, 0)", "rotate R1 and R2 by 90°"])
  })
})

describe("the held rotate and the build id", () => {
  const start = circuitOf([part("R1", 0, 0), part("R2", 4, 0)])

  test("a held rotate is released by a new build id", async () => {
    const studio = bench(start, ["R1", "R2"])
    studio.rotate()
    await studio.answer()
    studio.rotate()
    expect(studio.sent).toHaveLength(1)
    studio.build()
    expect(studio.sent).toHaveLength(2)
  })

  test("after a failed build the rotate stays held until a build succeeds", async () => {
    const studio = bench(start, ["R1", "R2"])
    studio.rotate()
    await studio.answer()
    studio.rotate()
    studio.build(false)
    expect(studio.sent).toHaveLength(1)
    studio.build()
    expect(studio.sent).toHaveLength(2)
  })

  test("tells the canvas while a rotate is held and when it is let go", async () => {
    const studio = bench(start, ["R1", "R2"])
    studio.rotate()
    expect(studio.holding).toEqual([])
    studio.rotate()
    expect(studio.holding).toEqual([true])
    await studio.answer()
    studio.build()
    expect(studio.holding).toEqual([true, false])
  })

  test("a failed rotate drops the press held behind it and tells the canvas it is no longer held", async () => {
    const studio = bench(start, ["R1", "R2"], { fail: true })
    studio.rotate()
    studio.rotate()
    expect(studio.holding).toEqual([true])
    await studio.answer()
    expect(studio.holding).toEqual([true, false])
  })
})

describe("a rotate while a drag waits", () => {
  test("is held until the dragged move's build has landed", async () => {
    const start = circuitOf([part("R1", 0, 0), part("R2", 4, 0)])
    const session = keySession({ resolved: () => undefined, holding: () => undefined })
    const sent: string[] = []
    const actions: GroupEditActions = {
      edit: async (_edits, summary) => {
        sent.push(summary)
        return true
      },
      notify: () => undefined,
    }
    const input: EditInput = {
      view: "pcb",
      selection: Selection.none.all(["R1", "R2"]),
      circuit: start,
      actions,
      blockerFor: () => null,
      layout: built(start),
      buildId: "b0",
      buildStatus: "done",
      moveWaiting: true,
    }
    session.rotate(input, false)
    expect(sent).toEqual([])
    session.settle({ ...input, moveWaiting: false })
    expect(sent).toEqual(["rotate R1 and R2 by 90°"])
  })
})

describe("arrow keys and parts outside the view", () => {
  test("a selected part the view does not draw is left out and named, the rest move", async () => {
    const studio = bench(circuitOf([part("R1", 0, 0), part("R2", 4, 0), part("C1", 9, 9)]), ["R1", "R2", "C1"], { hidden: ["C1"] })
    studio.nudge(2)
    await studio.answer()
    expect(studio.sent).toEqual(["move R1 and R2 by (2, 0)"])
    expect(at(studio.circuit(), "C1")).toEqual([9, 9, 0])
    expect(studio.notes).toEqual(["Not moved: C1 is not in this view"])
  })

  test("with no selected part in the view nothing is sent and the reason is told", () => {
    const studio = bench(circuitOf([part("C1", 9, 9)]), ["C1"], { hidden: ["C1"] })
    studio.nudge(1)
    expect(studio.sent).toEqual([])
    expect(studio.notes).toEqual(["C1 is not in this view"])
  })
})
