import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import type { Edit } from "../src/core/types.js"
import { buildDesign, type Design } from "../src/engine/design.js"
import { movePlan, moveWithWires, type GestureInput } from "../studio/src/pcb/gestures.js"
import { sendGroupEdit, skippedNote, type GroupEditActions, type Layout } from "../studio/src/pcb/group-edits.js"
import { keySession, type EditInput } from "../studio/src/pcb/key-session.js"
import { movePreview, previewMoving, type MovePreview } from "../studio/src/pcb/move-preview.js"
import { moveBlocker, partAnchors, type SourceCircuit } from "../studio/src/pcb/positions.js"
import { sheetBoxes } from "../studio/src/pcb/schematic-draw.js"
import { movesOf, wireFollowEdits, withFollowingWires } from "../studio/src/pcb/wire-follow.js"
import { Selection } from "../studio/src/selection.js"

const FILE = "main.circuit.tsx"
const p = (x: number, y: number) => ({ x, y })

// A resistor's pin1 ends half a unit left of its origin, pin2 half a unit right.
const SOURCE = `export default () => (
  <board width="40mm" height="30mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={4} schY={2} />
    <resistor name="R3" resistance="1k" footprint="0402" schX={0} schY={-4} />
    <resistor name="R4" resistance="1k" footprint="0402" schX={4} schY={-4} />
    <resistor name="R5" resistance="1k" footprint="0402" schX={0} schY={6} />
    <resistor name="R6" resistance="1k" footprint="0402" schX={4} schY={8} />
    <resistor name="R7" resistance="1k" footprint="0402" schX={0} schY={11} />
    <resistor name="R8" resistance="1k" footprint="0402" schX={0} schY={14} />
    <resistor name="R9" resistance="1k" footprint="0402" schX={0} schY={17} />
    <resistor name="R10" resistance="1k" footprint="0402" schX={4} schY={17} />
    <resistor name="R11" resistance="1k" footprint="0402" schX={0} schY={20} />
    <trace from=".R1 > .pin2" to=".R2 > .pin1" schematicRouteHints={[{ x: 2, y: 0 }, { x: 2, y: 2 }]} />
    <trace from=".R3 > .pin2" to=".R4 > .pin1" schematicRouteHints={[{ x: 0.5, y: -5 }, { x: 3.5, y: -5 }]} />
    <trace from=".R5 > .pin2" to=".R6 > .pin1" schematicRouteHints={[{ x: 3.5, y: 6 }]} />
    <trace from=".R7 > .pin2" to="net.VCC" schematicRouteHints={[{ x: 1.5, y: 11 }, { x: 1.5, y: 12 }]} />
    <trace from="net.GND" to=".R8 > .pin2" schematicRouteHints={[{ x: 1.5, y: 15 }, { x: 1.5, y: 14 }]} />
    <trace from=".R9 > .pin2" to=".R10 > .pin1" schematicRouteHints={[{ x: 1, y: 18 }, { x: 3, y: 18 }]} />
    <trace from=".R11 > .pin2" to="net.V3" schematicRouteHints={[{ x: 2, y: 20 }]} />
    <trace from=".R1 > .pin1" to=".R3 > .pin1" />
  </board>
)`

function setup(source = SOURCE): { design: Design; source: SourceCircuit } {
  return { design: buildDesign({ [FILE]: source }, FILE), source: { model: analyzeCircuit(source) } }
}

const sheet = setup()
const moves = (entries: [string, { x: number; y: number }][]) => new Map(entries)
const follow = (entries: [string, { x: number; y: number }][], locked: ReadonlySet<string> = new Set(), at = sheet) =>
  wireFollowEdits(at.design, at.source, moves(entries), locked)
const hints = (from: string, to: string, corners: { x: number; y: number }[]): Edit => ({ kind: "setTraceHints", from, to, schematicRouteHints: corners })
const pointsOf = (design: Design, id: string) => design.schematic.wires.find((wire) => wire.id === id)?.points

describe("the sheet the tests move on", () => {
  test("the wires start square at their pins", () => {
    expect(pointsOf(sheet.design, "wire:R1.pin2|R2.pin1")).toEqual([p(0.5, 0), p(2, 0), p(2, 2), p(3.5, 2)])
    expect(pointsOf(sheet.design, "wire:R3.pin2|R4.pin1")).toEqual([p(0.5, -4), p(0.5, -5), p(3.5, -5), p(3.5, -4)])
    expect(pointsOf(sheet.design, "wire:R5.pin2|R6.pin1")).toEqual([p(0.5, 6), p(3.5, 6), p(3.5, 8)])
    expect(pointsOf(sheet.design, "wire:net.GND|R8.pin2")).toEqual([p(0.5, 14), p(1.5, 14), p(1.5, 15)])
  })
})

describe("wireFollowEdits", () => {
  test("one end moved, horizontal first segment: the corner next to the pin takes the pin's dy and keeps its x", () => {
    expect(follow([["R1", p(0.3, 0.5)]])).toEqual([hints(".R1 > .pin2", ".R2 > .pin1", [p(2, 0.5), p(2, 2)])])
  })

  test("one end moved, vertical first segment: the corner next to the pin takes the pin's dx and keeps its y", () => {
    expect(follow([["R3", p(0.2, 0.3)]])).toEqual([hints(".R3 > .pin2", ".R4 > .pin1", [p(0.7, -5), p(3.5, -5)])])
  })

  test("the far end moved: the corner next to that pin follows it", () => {
    expect(follow([["R2", p(0.5, 1)]])).toEqual([hints(".R1 > .pin2", ".R2 > .pin1", [p(2, 0), p(2, 3)])])
  })

  test("a move along the first segment changes no corner, so nothing is sent", () => {
    expect(follow([["R1", p(0.3, 0)]])).toEqual([])
    expect(follow([["R3", p(0, 0.4)]])).toEqual([])
  })

  test("both ends moved by the same delta: every corner moves by it", () => {
    expect(follow([["R1", p(1, 1)], ["R2", p(1, 1)]])).toEqual([hints(".R1 > .pin2", ".R2 > .pin1", [p(3, 1), p(3, 3)])])
  })

  test("both ends moved by different deltas (align): each corner next to a pin follows its own pin", () => {
    expect(follow([["R1", p(0, 0.5)], ["R2", p(0, 1)]])).toEqual([hints(".R1 > .pin2", ".R2 > .pin1", [p(2, 0.5), p(2, 3)])])
    expect(follow([["R3", p(2, 0)], ["R4", p(-2, 0)]])).toEqual([hints(".R3 > .pin2", ".R4 > .pin1", [p(2.5, -5), p(1.5, -5)])])
  })

  test("a wire with one corner gets both adjustments, one per end", () => {
    expect(follow([["R5", p(0.2, 0.5)], ["R6", p(0.5, 0.3)]])).toEqual([hints(".R5 > .pin2", ".R6 > .pin1", [p(4, 6.5)])])
    expect(follow([["R6", p(0.5, 0.3)]])).toEqual([hints(".R5 > .pin2", ".R6 > .pin1", [p(4, 6)])])
  })

  test("a pin-to-net wire: the corner next to the pin follows and the label end stays", () => {
    expect(follow([["R7", p(0.2, 0.5)]])).toEqual([hints(".R7 > .pin2", "net.VCC", [p(1.5, 11.5), p(1.5, 12)])])
  })

  test("a trace that names the net first gets its corners back in its own order", () => {
    expect(follow([["R8", p(0, 0.5)]])).toEqual([hints("net.GND", ".R8 > .pin2", [p(1.5, 15), p(1.5, 14.5)])])
  })

  test("a label right after the pin is that corner, so it moves across with the pin", () => {
    expect(follow([["R11", p(0.4, 0.5)]])).toEqual([hints(".R11 > .pin2", "net.V3", [p(2, 20.5)])])
  })

  test("a slanted first segment (old files) is left alone", () => {
    expect(follow([["R9", p(0, 0.5)]])).toEqual([])
    expect(follow([["R10", p(0.5, 0.5)]])).toEqual([])
  })

  test("a trace without corners is drawn by the engine and needs nothing; no moves, no edits", () => {
    expect(pointsOf(sheet.design, "wire:R1.pin1|R3.pin1")).toBeDefined()
    expect(follow([["R1", p(0.5, 0.5)], ["R3", p(1, 1)]]).filter((edit) => edit.kind === "setTraceHints" && edit.to === ".R3 > .pin1")).toEqual([])
    expect(follow([])).toEqual([])
  })

  const Z_HINTS = `schematicRouteHints={[{ x: 2, y: 0 }, { x: 2, y: 2 }]}`
  const Z_TRACE = `<trace from=".R1 > .pin2" to=".R2 > .pin1" ${Z_HINTS} />`

  test("a read-only trace is skipped and the other wires still follow", () => {
    const looped = setup(SOURCE.replace(Z_TRACE, `{[1].map(() => ${Z_TRACE})}`))
    expect(pointsOf(looped.design, "wire:R1.pin2|R2.pin1")).toEqual([p(0.5, 0), p(2, 0), p(2, 2), p(3.5, 2)])
    expect(follow([["R1", p(0, 0.5)], ["R7", p(0, 0.5)]], new Set(), looped)).toEqual([hints(".R7 > .pin2", "net.VCC", [p(1.5, 11.5), p(1.5, 12)])])
  })

  test("corners written as an expression are skipped", () => {
    const named = SOURCE.replace(Z_HINTS, `schematicRouteHints={corners}`)
    const expression = setup(named.replace("export default", "const corners = [{ x: 2, y: 0 }, { x: 2, y: 2 }]\nexport default"))
    expect(pointsOf(expression.design, "wire:R1.pin2|R2.pin1")).toEqual([p(0.5, 0), p(2, 0), p(2, 2), p(3.5, 2)])
    expect(follow([["R1", p(0, 0.5)]], new Set(), expression)).toEqual([])
  })

  test("a locked part at the other end is skipped, so core does not refuse the whole move", () => {
    expect(follow([["R1", p(0, 0.5)], ["R7", p(0, 0.5)]], new Set(["R2"]))).toEqual([hints(".R7 > .pin2", "net.VCC", [p(1.5, 11.5), p(1.5, 12)])])
  })

  test("a trace with a point in the middle of its first run follows the tidied path, so no segment turns slanted", () => {
    const text = SOURCE.replace(Z_HINTS, `schematicRouteHints={[{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }]}`)
    const edits = follow([["R1", p(0, 0.5)]], new Set(), setup(text))
    expect(edits).toEqual([hints(".R1 > .pin2", ".R2 > .pin1", [p(2, 0.5), p(2, 2)])])
    const moved = applyEdits(text, [{ kind: "setProps", part: "R1", props: { schY: 0.5 } }, ...edits], new Set())
    const points = pointsOf(setup(moved).design, "wire:R1.pin2|R2.pin1") ?? []
    expect(points.slice(1).every((b, i) => points[i]?.x === b.x || points[i]?.y === b.y)).toBe(true)
  })

  test("after core writes the move and the corners, the rebuilt wire leaves its pins square", () => {
    const edits: Edit[] = [{ kind: "setProps", part: "R1", props: { schX: 0.3, schY: 0.5 } }, ...follow([["R1", p(0.3, 0.5)]])]
    const rebuilt = setup(applyEdits(SOURCE, edits, new Set()))
    expect(pointsOf(rebuilt.design, "wire:R1.pin2|R2.pin1")).toEqual([p(0.8, 0.5), p(2, 0.5), p(2, 2), p(3.5, 2)])
  })
})

describe("movesOf", () => {
  test("each schematic move is the new position less the one the source has; other props and other views are not moves", () => {
    const edits: Edit[] = [
      { kind: "setProps", part: "R1", props: { schX: 0.3, schY: 0.5 } },
      { kind: "setProps", part: "R2", props: { pcbX: 5, pcbY: 5 } },
      { kind: "setProps", part: "R3", props: { schRotation: 90 } },
      { kind: "setProps", part: "R4", props: { schY: -3 } },
    ]
    expect(movesOf(sheet.design, sheet.source, edits)).toEqual(new Map([["R1", p(0.3, 0.5)], ["R4", p(0, 1)]]))
  })

  test("a part without position literals moves from where the sheet draws it", () => {
    const loose = setup(SOURCE.replace(`<resistor name="R11" resistance="1k" footprint="0402" schX={0} schY={20} />`, `<resistor name="R11" resistance="1k" footprint="0402" />`))
    const at = loose.design.schematic.symbols.find((symbol) => symbol.component === "R11")
    if (!at) throw new Error("R11 is not on the sheet")
    expect(movesOf(loose.design, loose.source, [{ kind: "setProps", part: "R11", props: { schX: at.x + 1, schY: at.y - 1 } }])).toEqual(new Map([["R11", p(1, -1)]]))
  })
})

const Z = "wire:R1.pin2|R2.pin1"
/** Whether every segment of the path is horizontal or vertical. */
const square = (points: readonly { x: number; y: number }[]) => points.slice(1).every((b, i) => points[i]?.x === b.x || points[i]?.y === b.y)

describe("selected wires in a move of the selection", () => {
  const input = (locked: ReadonlySet<string> = new Set()) =>
    ({
      view: "schematic",
      circuit: sheet.source,
      anchors: partAnchors(sheet.design, "schematic"),
      boxes: sheetBoxes(sheet.design.schematic),
      blockerFor: (name: string) => moveBlocker(sheet.source, locked, name, "schematic"),
      follow: { design: sheet.design, locked },
    }) as unknown as GestureInput

  test("a selected wire whose ends stay moves its corners by the offset, with a new segment at each end", () => {
    const plan = movePlan(input(), [], p(0.5, 0.5), [Z])
    expect(plan.edits).toEqual([hints(".R1 > .pin2", ".R2 > .pin1", [p(0.5, 0.5), p(2.5, 0.5), p(2.5, 2.5), p(3.5, 2.5)])])
    expect(plan.summary).toBe("move the wire from R1.pin2 to R2.pin1 in the schematic by (0.5, 0.5)")
    const rebuilt = pointsOf(setup(applyEdits(SOURCE, plan.edits, new Set())).design, Z)
    expect(rebuilt).toEqual([p(0.5, 0), p(0.5, 0.5), p(2.5, 0.5), p(2.5, 2.5), p(3.5, 2.5), p(3.5, 2)])
  })

  test("a selected wire with one end's part moving: that end goes along, the other end gets the new segment, in one edit for the trace", () => {
    const plan = movePlan(input(), ["R1"], p(0, 0.5), [Z])
    expect(plan.edits).toEqual([{ kind: "setProps", part: "R1", props: { schX: 0, schY: 0.5 } }, hints(".R1 > .pin2", ".R2 > .pin1", [p(2, 0.5), p(2, 2.5), p(3.5, 2.5)])])
    expect(plan.summary).toBe("move R1 and the wire from R1.pin2 to R2.pin1 in the schematic by (0, 0.5)")
    expect(square(pointsOf(setup(applyEdits(SOURCE, plan.edits, new Set())).design, Z) ?? [])).toBe(true)
  })

  test("a selected wire whose two end parts both move is moved whole by the parts, with one edit for its trace", () => {
    const plan = movePlan(input(), ["R1", "R2"], p(1, 1), [Z])
    expect(plan.edits.filter((edit) => edit.kind === "setTraceHints")).toEqual([hints(".R1 > .pin2", ".R2 > .pin1", [p(3, 1), p(3, 3)])])
    expect(plan.summary).toBe("move R1, R2 and the wire from R1.pin2 to R2.pin1 in the schematic by (1, 1)")
  })

  test("two selected wires are counted in the history", () => {
    expect(movePlan(input(), [], p(0.5, 0), [Z, "wire:R3.pin2|R4.pin1"]).summary).toBe("move 2 wires in the schematic by (0.5, 0)")
  })

  test("a pin-to-net wire keeps its label end, which gets the new segment", () => {
    expect(movePlan(input(), [], p(0.5, 0), ["wire:R7.pin2|net.VCC"]).edits).toEqual([hints(".R7 > .pin2", "net.VCC", [p(2, 11), p(2, 12), p(1.5, 12)])])
  })

  test("a selected wire that cannot move is named, and the rest of the selection still moves", () => {
    const plan = movePlan(input(new Set(["R2"])), ["R1"], p(0, 0.5), [Z])
    expect(plan.edits).toEqual([{ kind: "setProps", part: "R1", props: { schX: 0, schY: 0.5 } }])
    expect(plan.skipped).toEqual(["The wire from R1.pin2 to R2.pin1: R2 is locked"])
  })

  test("a wire held by a locked part already named is not named again", () => {
    expect(movePlan(input(new Set(["R2"])), ["R1", "R2"], p(0, 0.5), [Z]).skipped).toEqual(["R2 is locked"])
  })

  test("the history names only the selected wires the move changes", () => {
    const along = "wire:R11.pin2|net.V3"
    expect(movePlan(input(), ["R3"], p(0.5, 0), [along]).summary).toBe("move R3 in the schematic to (0.5, -4)")
    expect(movePlan(input(), ["R3"], p(0.5, 0), [along, Z]).summary).toBe("move R3 and the wire from R1.pin2 to R2.pin1 in the schematic by (0.5, 0)")
  })

  test("the far end's part moving alone takes that end along; the near end gets the new segment", () => {
    const plan = movePlan(input(), ["R2"], p(0, 0.5), [Z])
    expect(plan.edits).toEqual([{ kind: "setProps", part: "R2", props: { schX: 4, schY: 2.5 } }, hints(".R1 > .pin2", ".R2 > .pin1", [p(0.5, 0.5), p(2, 0.5), p(2, 2.5)])])
    expect(square(pointsOf(setup(applyEdits(SOURCE, plan.edits, new Set())).design, Z) ?? [])).toBe(true)
  })

  test("a wire Studio draws the shape of (a trace without corners) is left as it is: Studio draws it again", () => {
    const plan = movePlan(input(), ["R1"], p(0, 0.5), ["wire:R1.pin1|R3.pin1"])
    expect(plan.edits.map((edit) => edit.kind)).toEqual(["setProps", "setTraceHints"])
    expect(plan.summary).toBe("move R1 in the schematic to (0, 0.5)")
    expect(movePlan(input(), [], p(0, 0.5), ["wire:R1.pin1|R3.pin1"]).edits).toEqual([])
  })

  test("a move of only such wires says why nothing moved", () => {
    const one = movePlan(input(), [], p(0, 0.5), ["wire:R1.pin1|R3.pin1"])
    expect(skippedNote(one)).toBe("Studio draws this wire's shape between its pins; drag one of its segments to give it corners first")
    expect(movePlan(input(), ["R1"], p(0, 0.5), ["wire:R1.pin1|R3.pin1"]).skipped).toEqual([])
  })
})

describe("what a move draws until its build lands", () => {
  const input = {
    view: "schematic",
    circuit: sheet.source,
    anchors: partAnchors(sheet.design, "schematic"),
    boxes: sheetBoxes(sheet.design.schematic),
    blockerFor: (name: string) => moveBlocker(sheet.source, new Set(), name, "schematic"),
    follow: { design: sheet.design, locked: new Set<string>() },
  } as unknown as GestureInput

  test("the shapes a move gives its wires, carried and following, are the ones the build then draws", () => {
    const { plan, lines } = moveWithWires(input, ["R1", "R7"], p(0, 0.5), [Z])
    expect(lines.map((line) => line.id)).toEqual([Z, "wire:R7.pin2|net.VCC"])
    expect(lines).toHaveLength(plan.edits.filter((edit) => edit.kind === "setTraceHints").length)
    const rebuilt = setup(applyEdits(SOURCE, plan.edits, new Set())).design
    for (const line of lines) expect(pointsOf(rebuilt, line.id)).toEqual(line.points)
  })

  test("without the sheet's wires (the PCB) a move has no shapes to draw", () => {
    expect(moveWithWires({ ...input, follow: undefined }, ["R1"], p(0, 0.5), [Z]).lines).toEqual([])
  })

  test("a preview puts each moved part where its new props put it, and is drawn from the sheet as it is now", () => {
    const { plan, lines } = moveWithWires(input, ["R1", "R7"], p(0, 0.5), [Z])
    const preview = movePreview(sheet.design, plan, lines)
    expect(preview.parts).toEqual([{ name: "R1", to: p(0, 0.5) }, { name: "R7", to: p(0, 11.5) }])
    expect(previewMoving(preview, partAnchors(sheet.design, "schematic"))).toEqual({ names: ["R1", "R7"], offset: p(0, 0.5), wires: lines })
    const halfway = setup(applyEdits(SOURCE, [{ kind: "setProps", part: "R1", props: { schX: 0, schY: 0.2 } }, { kind: "setProps", part: "R7", props: { schX: 0, schY: 11.2 } }], new Set()))
    expect(previewMoving(preview, partAnchors(halfway.design, "schematic"))?.offset).toEqual(p(0, 0.3))
  })

  test("a preview of wires alone moves no part", () => {
    const { plan, lines } = moveWithWires(input, [], p(0.5, 0.5), [Z])
    expect(previewMoving(movePreview(sheet.design, plan, lines), partAnchors(sheet.design, "schematic"))).toEqual({ names: [], offset: p(0, 0), wires: lines })
  })
})

/** Studio's edit call, kept: every call's edits and summary; each edit is written to the source when `answer` says. */
function server(start = SOURCE) {
  let text = start
  const calls: { edits: Edit[]; summary: string }[] = []
  const answers: (() => void)[] = []
  const actions: GroupEditActions = {
    edit: async (edits, summary) => (await actions.editMarked?.(edits, summary))?.ok ?? false,
    editMarked: (edits, summary) =>
      new Promise((resolve) => {
        calls.push({ edits, summary })
        answers.push(() => {
          text = applyEdits(text, edits, new Set())
          resolve({ ok: true, mark: calls.length })
        })
      }),
    notify: () => undefined,
  }
  return {
    calls,
    actions,
    source: (): SourceCircuit => ({ model: analyzeCircuit(text) }),
    text: () => text,
    async answer() {
      answers.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

const layoutOf = (design: Design): Layout => ({ anchors: partAnchors(design, "schematic"), boxes: sheetBoxes(design.schematic), step: 0.1 })

describe("the move and its wires are one history entry", () => {
  test("a drag sends the move and the corner edits in one edit call, under the move's own summary", async () => {
    const studio = server()
    const input = {
      view: "schematic",
      circuit: sheet.source,
      anchors: partAnchors(sheet.design, "schematic"),
      boxes: sheetBoxes(sheet.design.schematic),
      blockerFor: (name: string) => moveBlocker(sheet.source, new Set(), name, "schematic"),
      follow: { design: sheet.design, locked: new Set<string>() },
    } as unknown as GestureInput
    const plan = movePlan(input, ["R1"], p(0, 0.5))
    expect(plan.summary).toBe("move R1 in the schematic to (0, 0.5)")
    const sent = sendGroupEdit(plan, studio.actions)
    await studio.answer()
    expect(await sent).toBe(true)
    expect(studio.calls).toEqual([
      { edits: [{ kind: "setProps", part: "R1", props: { schX: 0, schY: 0.5 } }, hints(".R1 > .pin2", ".R2 > .pin1", [p(2, 0.5), p(2, 2)])], summary: "move R1 in the schematic to (0, 0.5)" },
    ])
  })

  test("a wire that cannot follow (a locked part at its other end) leaves the move's own edit to go alone", () => {
    const input = {
      view: "schematic",
      circuit: sheet.source,
      anchors: partAnchors(sheet.design, "schematic"),
      boxes: sheetBoxes(sheet.design.schematic),
      blockerFor: (name: string) => moveBlocker(sheet.source, new Set(["R2"]), name, "schematic"),
      follow: { design: sheet.design, locked: new Set(["R2"]) },
    } as unknown as GestureInput
    expect(movePlan(input, ["R1"], p(0, 0.5)).edits).toEqual([{ kind: "setProps", part: "R1", props: { schX: 0, schY: 0.5 } }])
  })

  test("without the sheet's wires (the PCB) a move sends only the move", () => {
    const plan = { edits: [{ kind: "setProps" as const, part: "R1", props: { schX: 0, schY: 0.5 } }], summary: "move R1", parts: ["R1"], skipped: [], done: "moved" as const }
    expect(withFollowingWires(plan, sheet.source, undefined)).toBe(plan)
  })

  function keys(studio: ReturnType<typeof server>, names: readonly string[], design = sheet.design, wires: readonly string[] = [], previews: MovePreview[] = []) {
    const session = keySession({ resolved: () => undefined, holding: () => undefined, moved: (preview) => void previews.push(preview) })
    const input = (): EditInput => {
      const circuit = studio.source()
      return {
        view: "schematic",
        selection: Selection.none.all(names, wires),
        circuit,
        actions: studio.actions,
        blockerFor: (name) => moveBlocker(circuit, new Set(), name, "schematic"),
        layout: layoutOf(design),
        builtMark: 0,
        buildStatus: "done",
        moveWaiting: false,
        follow: { design, locked: new Set() },
      }
    }
    return { session, input }
  }

  test("an arrow key sends the nudge and the corner edits in one edit call", async () => {
    const studio = server()
    const { session, input } = keys(studio, ["R1"])
    session.nudge(input(), { action: "nudgeUp", preventDefault: true, steps: 1 })
    await studio.answer()
    expect(studio.calls).toEqual([
      { edits: [{ kind: "setProps", part: "R1", props: { schX: 0, schY: 0.1 } }, hints(".R1 > .pin2", ".R2 > .pin1", [p(2, 0.1), p(2, 2)])], summary: "move R1 in the schematic to (0, 0.1)" },
    ])
  })

  test("a second arrow press after the source reloaded, before the sheet is rebuilt, moves the corner on from where the source has it", async () => {
    const studio = server()
    const { session, input } = keys(studio, ["R1"])
    session.nudge(input(), { action: "nudgeUp", preventDefault: true, steps: 1 })
    await studio.answer()
    session.nudge(input(), { action: "nudgeUp", preventDefault: true, steps: 1 })
    await studio.answer()
    expect(studio.calls[1]?.edits).toEqual([{ kind: "setProps", part: "R1", props: { schX: 0, schY: 0.2 } }, hints(".R1 > .pin2", ".R2 > .pin1", [p(2, 0.2), p(2, 2)])])
    expect(pointsOf(setup(studio.text()).design, "wire:R1.pin2|R2.pin1")).toEqual([p(0.5, 0.2), p(2, 0.2), p(2, 2), p(3.5, 2)])
  })

  test("a second arrow press while the first is in flight is sent next with the total, and the corner moves with it", async () => {
    const studio = server()
    const { session, input } = keys(studio, ["R1"])
    session.nudge(input(), { action: "nudgeUp", preventDefault: true, steps: 1 })
    session.nudge(input(), { action: "nudgeUp", preventDefault: true, steps: 1 })
    expect(studio.calls).toHaveLength(1)
    await studio.answer()
    expect(studio.calls[1]?.edits).toEqual([{ kind: "setProps", part: "R1", props: { schX: 0, schY: 0.2 } }, hints(".R1 > .pin2", ".R2 > .pin1", [p(2, 0.2), p(2, 2)])])
    await studio.answer()
    expect(pointsOf(setup(studio.text()).design, "wire:R1.pin2|R2.pin1")).toEqual([p(0.5, 0.2), p(2, 0.2), p(2, 2), p(3.5, 2)])
  })

  test("arrow keys with parts and wires selected carry the wires in the nudge's one edit call, and a press in flight sends the total", async () => {
    const studio = server()
    const { session, input } = keys(studio, ["R1"], sheet.design, [Z])
    session.nudge(input(), { action: "nudgeUp", preventDefault: true, steps: 1 })
    session.nudge(input(), { action: "nudgeUp", preventDefault: true, steps: 1 })
    await studio.answer()
    expect(studio.calls[0]).toEqual({
      edits: [{ kind: "setProps", part: "R1", props: { schX: 0, schY: 0.1 } }, hints(".R1 > .pin2", ".R2 > .pin1", [p(2, 0.1), p(2, 2.1), p(3.5, 2.1)])],
      summary: "move R1 and the wire from R1.pin2 to R2.pin1 in the schematic by (0, 0.1)",
    })
    expect(studio.calls[1]?.edits).toEqual([{ kind: "setProps", part: "R1", props: { schX: 0, schY: 0.2 } }, hints(".R1 > .pin2", ".R2 > .pin1", [p(2, 0.2), p(2, 2.2), p(3.5, 2.2)])])
    await studio.answer()
    expect(square(pointsOf(setup(studio.text()).design, Z) ?? [])).toBe(true)
  })

  test("each arrow send hands the canvas the parts' places and the wires' shapes to draw until the build, the total from where the burst began", async () => {
    const studio = server()
    const previews: MovePreview[] = []
    const { session, input } = keys(studio, ["R1"], sheet.design, [Z], previews)
    session.nudge(input(), { action: "nudgeUp", preventDefault: true, steps: 1 })
    session.nudge(input(), { action: "nudgeUp", preventDefault: true, steps: 1 })
    await studio.answer()
    expect(previews).toEqual([
      { parts: [{ name: "R1", to: p(0, 0.1) }], wires: [{ id: Z, points: [p(0.5, 0.1), p(2, 0.1), p(2, 2.1), p(3.5, 2.1), p(3.5, 2)] }] },
      { parts: [{ name: "R1", to: p(0, 0.2) }], wires: [{ id: Z, points: [p(0.5, 0.2), p(2, 0.2), p(2, 2.2), p(3.5, 2.2), p(3.5, 2)] }] },
    ])
  })

  test("arrow keys with only a wire selected move that wire", async () => {
    const studio = server()
    const { session, input } = keys(studio, [], sheet.design, [Z])
    session.nudge(input(), { action: "nudgeRight", preventDefault: true, steps: 1 })
    await studio.answer()
    expect(studio.calls).toEqual([
      { edits: [hints(".R1 > .pin2", ".R2 > .pin1", [p(2.1, 0), p(2.1, 2)])], summary: "move the wire from R1.pin2 to R2.pin1 in the schematic by (0.1, 0)" },
    ])
  })

  test("align sends the moves of every part and the corner edits in one edit call", async () => {
    const studio = server()
    const { session, input } = keys(studio, ["R3", "R4"])
    session.align(input(), "alignVCentres")
    await studio.answer()
    expect(studio.calls).toHaveLength(1)
    const [call] = studio.calls
    expect(call?.summary).toBe("align R3 and R4 vertical centres in the schematic")
    expect(call?.edits.map((edit) => edit.kind)).toEqual(["setProps", "setProps", "setTraceHints"])
    const rebuilt = setup(studio.text())
    expect(pointsOf(rebuilt.design, "wire:R3.pin2|R4.pin1")).toEqual([p(2.5, -4), p(2.5, -5), p(1.5, -5), p(1.5, -4)])
  })
})
