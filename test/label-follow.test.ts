import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import type { Edit } from "../src/core/types.js"
import { buildDesign, type Design } from "../src/engine/design.js"
import { moveWithWires, type GestureInput } from "../studio/src/pcb/gestures.js"
import type { GroupEditActions } from "../studio/src/pcb/group-edits.js"
import { keySession, type EditInput } from "../studio/src/pcb/key-session.js"
import { labelDragEdits } from "../studio/src/pcb/label-drag.js"
import { deletePlan } from "../studio/src/pcb/delete-plan.js"
import { labelAfterBuild, labelProperties, labelsRemoval } from "../studio/src/pcb/label-selection.js"
import { wiresRemoval } from "../studio/src/pcb/wire-actions.js"
import { shownSelection } from "../studio/src/pcb/wire-selection.js"
import { labelsAfterMove, previewMoving, type MovePreview } from "../studio/src/pcb/move-preview.js"
import { moveBlocker, partAnchors } from "../studio/src/pcb/positions.js"
import { sheetBoxes } from "../studio/src/pcb/schematic-draw.js"
import { Selection } from "../studio/src/selection.js"

const FILE = "main.circuit.tsx"
const p = (x: number, y: number) => ({ x, y })

// R1.pin1 is on GND with no corners, so Studio puts a ground flag on its pin end. R1.pin2 has a hand-drawn wire whose
// label sits right after the pin; R3.pin2's wire turns once before its label.
const SOURCE = `export default () => (
  <board width="40mm" height="30mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R3" resistance="1k" footprint="0402" schX={0} schY={4} />
    <trace from=".R1 > .pin1" to="net.GND" />
    <trace from=".R1 > .pin2" to="net.SIG" schematicRouteHints={[{ x: 2, y: 0 }]} />
    <trace from=".R3 > .pin2" to="net.OUT" schematicRouteHints={[{ x: 1.5, y: 4 }, { x: 1.5, y: 5 }]} />
  </board>
)`

const FLAG = "label:net.GND:R1.pin1"
const SIG = "label:R1.pin2|net.SIG"
const OUT = "label:R3.pin2|net.OUT"
const OUT_WIRE = "wire:R3.pin2|net.OUT"

function inputFor(source: string, locked: ReadonlySet<string> = new Set()): { design: Design; input: GestureInput } {
  const design = buildDesign({ [FILE]: source }, FILE)
  const circuit = { model: analyzeCircuit(source) }
  const input = {
    view: "schematic",
    circuit,
    anchors: partAnchors(design, "schematic"),
    boxes: sheetBoxes(design.schematic),
    blockerFor: (name: string) => moveBlocker(circuit, locked, name, "schematic"),
    follow: { design, locked },
  } as unknown as GestureInput
  return { design, input }
}

const { design, input } = inputFor(SOURCE)
const labelAt = (on: Design, id: string) => on.schematic.labels.find((label) => label.id === id)?.at
const plus = (a: { x: number; y: number } | undefined, b: { x: number; y: number }) => a && p(a.x + b.x, a.y + b.y)
const rebuilt = (edits: readonly Edit[]) => buildDesign({ [FILE]: applyEdits(SOURCE, [...edits], new Set()) }, FILE)
/** How many edits change each trace, by its two ends. */
const perTrace = (edits: readonly Edit[]) => {
  const counts = new Map<string, number>()
  for (const edit of edits) if (edit.kind === "setTraceHints") counts.set(`${edit.from}|${edit.to}`, (counts.get(`${edit.from}|${edit.to}`) ?? 0) + 1)
  return [...counts.values()]
}

describe("labels moved with a selection", () => {
  test("a flag Studio placed on a pin of a moved part needs no edit of its own, and the history names it", () => {
    const offset = p(0, 1)
    const alone = moveWithWires(input, ["R1"], offset)
    const withFlag = moveWithWires(input, ["R1"], offset, [], [FLAG])
    expect(withFlag.plan.edits).toEqual(alone.plan.edits)
    expect(withFlag.plan.summary).toBe("move R1 and the GND flag in the schematic by (0, 1)")
    expect(labelAt(rebuilt(withFlag.plan.edits), FLAG)).toEqual(plus(labelAt(design, FLAG), offset))
  })

  test("a flag Studio placed on a pin of a part that stays gets the short pin-to-net wire a label drag writes", () => {
    const offset = p(-1, 0)
    const { plan, labels } = moveWithWires(input, [], offset, [], [FLAG])
    const drop = plus(labelAt(design, FLAG), offset) ?? p(0, 0)
    expect(plan.edits).toEqual(labelDragEdits(design, input.circuit, FLAG, drop))
    expect(plan.summary).toBe("move the GND flag in the schematic by (-1, 0)")
    expect(labels).toMatchObject([{ id: FLAG, at: drop }])
    // The flag now ends a hand-drawn wire, so the build names it by that wire's connection.
    expect(labelAt(rebuilt(plan.edits), "label:R1.pin1|net.GND")).toEqual(drop)
  })

  test("a hand-drawn label whose wire and part stay moves with its wire's end, as a label drag does", () => {
    const offset = p(0.5, 0)
    const { plan, labels } = moveWithWires(input, [], offset, [], [OUT])
    const drop = plus(labelAt(design, OUT), offset) ?? p(0, 0)
    expect(plan.edits).toEqual(labelDragEdits(design, input.circuit, OUT, drop))
    expect(labels).toMatchObject([{ id: OUT, at: drop, hideWire: OUT_WIRE }])
    expect(labelAt(rebuilt(plan.edits), OUT)).toEqual(drop)
  })

  test("a hand-drawn label whose wire is carried too: one edit for the trace, and the label goes with the wire's end", () => {
    const offset = p(0, 1)
    const { plan, lines, labels } = moveWithWires(input, [], offset, [OUT_WIRE], [OUT])
    expect(plan.edits).toHaveLength(1)
    expect(labels).toEqual([])
    const built = rebuilt(plan.edits)
    expect(labelAt(built, OUT)).toEqual(plus(labelAt(design, OUT), offset))
    expect(lines.find((line) => line.id === OUT_WIRE)?.points).toEqual(built.schematic.wires.find((wire) => wire.id === OUT_WIRE)?.points)
    expect(plan.summary).toBe("move the wire from R3.pin2 to net OUT and the OUT label in the schematic by (0, 1)")
  })

  test("a hand-drawn label whose part moves: its wire moves whole, in one edit", () => {
    const offset = p(0.5, 1)
    const { plan } = moveWithWires(input, ["R3"], offset, [], [OUT])
    expect(perTrace(plan.edits)).toEqual([1])
    const built = rebuilt(plan.edits)
    expect(labelAt(built, OUT)).toEqual(plus(labelAt(design, OUT), offset))
    const before = design.schematic.wires.find((wire) => wire.id === OUT_WIRE)?.points ?? []
    expect(built.schematic.wires.find((wire) => wire.id === OUT_WIRE)?.points).toEqual(before.map((point) => plus(point, offset)))
  })

  test("every label of a mix is drawn live where the build then puts it", () => {
    const offset = p(0.5, -1)
    const { plan, lines, labels } = moveWithWires(input, ["R1"], offset, [], [FLAG, SIG, OUT])
    const shown = labelsAfterMove(design.schematic, { names: plan.parts, offset, wires: lines })
    const drawn = shown.map((label) => labels.find((moved) => moved.id === label.id)?.at ?? label.at)
    expect(drawn).toEqual(rebuilt(plan.edits).schematic.labels.map((label) => label.at))
    expect(plan.summary).toBe("move R1 and 3 labels in the schematic by (0.5, -1)")
  })

  test("an arrow key moves the selected labels in the same edit as the parts, and draws them until the build lands", async () => {
    const calls: { edits: Edit[]; summary: string }[] = []
    const actions: GroupEditActions = { edit: async (edits, summary) => (calls.push({ edits, summary }), true), notify: () => undefined }
    const previews: MovePreview[] = []
    const session = keySession({ resolved: () => undefined, holding: () => undefined, moved: (preview) => void previews.push(preview) })
    const edit: EditInput = {
      view: "schematic",
      selection: Selection.none.all(["R1"], [], [FLAG, OUT]),
      circuit: input.circuit,
      actions,
      blockerFor: input.blockerFor,
      layout: { anchors: partAnchors(design, "schematic"), boxes: sheetBoxes(design.schematic), step: 0.5 },
      builtMark: 0,
      buildStatus: "done",
      moveWaiting: false,
      follow: { design, locked: new Set() },
    }
    session.nudge(edit, { action: "nudgeRight", preventDefault: true, steps: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const offset = p(0.5, 0)
    expect(calls).toEqual([{ edits: moveWithWires(input, ["R1"], offset, [], [FLAG, OUT]).plan.edits, summary: "move R1 and 2 labels in the schematic by (0.5, 0)" }])
    const shown = previewMoving(previews[0] as MovePreview, partAnchors(design, "schematic"))
    expect(shown.labels).toMatchObject([{ id: OUT, at: plus(labelAt(design, OUT), offset) }])
  })

  test("a label whose part is locked is named once among those left out; the rest still moves", () => {
    const locked = inputFor(SOURCE, new Set(["R3"]))
    const { plan } = moveWithWires(locked.input, [], p(0, 1), [], [OUT, FLAG])
    expect(plan.skipped).toEqual(["The OUT label: R3 is locked"])
    expect(plan.edits).toHaveLength(1)
  })
})

describe("the selected labels after a build", () => {
  test("a flag that now ends a hand-drawn wire stays selected under its new id, in its place", () => {
    const { plan } = moveWithWires(input, [], p(-1, 0), [], [FLAG])
    const after = rebuilt(plan.edits)
    const selection = Selection.none.all(["R1"], [], [OUT, FLAG])
    expect(labelAfterBuild(selection, design, after)).toMatchObject({ names: ["R1"], labels: [OUT, "label:R1.pin1|net.GND"] })
  })

  test("a label the sheet still draws stays; one gone for good goes; nothing selected is the same selection", () => {
    const selection = Selection.none.all([], [], [OUT, "label:net.X:R9.pin1"])
    expect(labelAfterBuild(selection, design, design).labels).toEqual([OUT])
    const same = Selection.none.all(["R1"], [], [OUT])
    expect(labelAfterBuild(same, design, design)).toBe(same)
    expect(labelAfterBuild(Selection.none, undefined, design)).toBe(Selection.none)
  })

  test("the views are shown only the labels the open sheet draws, and none on the PCB", () => {
    const selection = Selection.none.all(["R1"], [], [OUT, FLAG])
    expect(shownSelection(selection, { view: "schematic", labels: [OUT] }).labels).toEqual([OUT])
    expect(shownSelection(selection, { view: "pcb", labels: [OUT, FLAG] }).labels).toEqual([])
  })
})

describe("Delete with labels selected", () => {
  const circuit = { model: analyzeCircuit(SOURCE) }
  const remove = (selection: Selection, locked: ReadonlySet<string> = new Set()) =>
    deletePlan(
      selection,
      (name) => moveBlocker(circuit, locked, name, "schematic"),
      (ids, parts, said) => wiresRemoval(design, circuit, ids, parts, locked, said),
      (ids, parts) => labelsRemoval(design, ids, parts),
    )

  test("a hand-drawn label takes its trace away, and leaves the selection", () => {
    const result = remove(Selection.none.onlyLabel(OUT))
    expect(result).toMatchObject({ plan: { edits: [{ kind: "removeTrace", from: ".R3 > .pin2", to: "net.OUT" }], skipped: [] }, labels: [OUT] })
    expect("question" in result).toBe(false)
  })

  test("a label and its own wire selected remove the trace once", () => {
    const result = remove(Selection.none.all([], [OUT_WIRE], [OUT]))
    expect(result).toMatchObject({ plan: { edits: [{ kind: "removeTrace" }] }, wires: [OUT_WIRE], labels: [OUT] })
  })

  test("a flag Studio placed cannot go on its own: it is named, and the rest goes ahead", () => {
    const result = remove(Selection.none.all([], [], [FLAG, OUT]))
    expect(result).toMatchObject({
      plan: { edits: [{ kind: "removeTrace", from: ".R3 > .pin2" }], skipped: ["The GND flag: Studio places it on R1.pin1 for its net; delete that pin's part or wire instead"] },
      labels: [OUT],
    })
  })

  test("labels of a removed part go with it, with nothing sent twice and nothing refused", () => {
    const result = remove(Selection.none.all(["R1"], [], [FLAG, SIG]))
    expect(result).toMatchObject({ plan: { edits: [{ kind: "removePart", part: "R1" }], skipped: [] }, labels: [FLAG, SIG] })
  })
})

describe("Properties of one label", () => {
  test("names its net, its text and whether it sits at a pin or ends a hand-drawn wire", () => {
    expect(labelProperties(design, FLAG)).toEqual({
      net: "net.GND",
      rows: [
        { label: "Net", value: "GND" },
        { label: "Text", value: "GND" },
        { label: "Kind", value: "At a pin" },
      ],
    })
    expect(labelProperties(design, OUT)?.rows.at(-1)).toEqual({ label: "Kind", value: "Hand-drawn" })
    expect(labelProperties(design, "label:gone")).toBeUndefined()
  })
})
