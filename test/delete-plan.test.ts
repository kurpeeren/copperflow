import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import { buildDesign } from "../src/engine/design.js"
import { deletePlan, NOTHING_TO_DELETE } from "../studio/src/pcb/delete-plan.js"
import { skippedNote } from "../studio/src/pcb/group-edits.js"
import { moveBlocker } from "../studio/src/pcb/positions.js"
import { wiresRemoval } from "../studio/src/pcb/wire-actions.js"
import { Selection } from "../studio/src/selection.js"

const FILE = "main.circuit.tsx"

// R5 and R6 are on GND with no wire of their own, so Studio draws the wire between them.
const SOURCE = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
    <resistor name="R3" resistance="1k" footprint="0402" schX={6} schY={0} />
    <resistor name="R4" resistance="1k" footprint="0402" schX={0} schY={3} />
    <resistor name="R5" resistance="1k" footprint="0402" schX={0} schY={6} />
    <resistor name="R6" resistance="1k" footprint="0402" schX={3} schY={6} />
    <trace from=".R1 > .pin2" to=".R2 > .pin1" schematicRouteHints={[{ x: 1, y: 1 }, { x: 2, y: 1 }]} />
    <trace from=".R3 > .pin1" to="net.VCC" schematicRouteHints={[{ x: 7, y: 1 }, { x: 7, y: 2 }]} />
    <trace from="net.VCC" to=".R4 > .pin1" schematicRouteHints={[{ x: -2, y: 4 }, { x: -2, y: 2 }]} />
    <trace from=".R3 > .pin2" to=".R4 > .pin2" />
    <trace from=".R5 > .pin1" to="net.GND" />
    <trace from=".R6 > .pin1" to="net.GND" />
  </board>
)`

const R1_R2 = "wire:R1.pin2|R2.pin1"
const R3_VCC = "wire:R3.pin1|net.VCC"
const VCC_R4 = "wire:net.VCC|R4.pin1"
const GND = "wire:net.GND:1"

const design = buildDesign({ [FILE]: SOURCE }, FILE)
const source = { model: analyzeCircuit(SOURCE) }

/** Delete on `selection`, with these parts locked. */
function plan(selection: Selection, locked: ReadonlySet<string> = new Set()) {
  const blockerFor = (name: string) => moveBlocker(source, locked, name, "schematic")
  return deletePlan(selection, blockerFor, (ids, parts) => wiresRemoval(design, source, ids, parts, locked))
}

const wireIds = (text: string) => buildDesign({ [FILE]: text }, FILE).schematic.wires.map((wire) => wire.id)

describe("Delete with nothing selected", () => {
  test("does nothing and says what to select", () => {
    expect(plan(Selection.none)).toEqual({ message: NOTHING_TO_DELETE })
    expect(NOTHING_TO_DELETE).toBe("Select a part or a wire first.")
  })
})

describe("Delete on wires alone", () => {
  test("one wire: its trace goes, named in the history by its ends, and nothing is asked", () => {
    expect(plan(Selection.none.onlyWire(R3_VCC))).toEqual({
      plan: { edits: [{ kind: "removeTrace", from: ".R3 > .pin1", to: "net.VCC" }], summary: "remove the wire from R3.pin1 to net VCC", parts: [], skipped: [], done: "removed" },
      wires: [R3_VCC],
    })
  })

  test("several wires: every trace in one edit list, counted in the history", () => {
    const result = plan(Selection.none.addWires([R3_VCC, VCC_R4]))
    if ("message" in result) throw new Error(result.message)
    expect(result.plan.edits.map((edit) => edit.kind)).toEqual(["removeTrace", "removeTrace"])
    expect(result.plan.summary).toBe("remove 2 wires")
  })
})

describe("Delete on parts and wires together", () => {
  const mix = Selection.none.only("R1").addWires([R3_VCC, R1_R2])

  test("removes the wires' traces first, then the parts, in one change, and asks first because parts go", () => {
    const result = plan(mix)
    if ("message" in result) throw new Error(result.message)
    expect(result.plan.edits).toEqual([
      { kind: "removeTrace", from: ".R3 > .pin1", to: "net.VCC" },
      { kind: "removePart", part: "R1" },
    ])
    expect(result.plan.summary).toBe("remove R1 and the wire from R3.pin1 to net VCC")
    expect(result.question).toBe("Remove R1 and its connections, and 1 wire?")
  })

  test("a wire whose trace ends on a part being removed is left to the part, so no trace is removed twice; it still leaves the selection", () => {
    const result = plan(mix)
    if ("message" in result) throw new Error(result.message)
    expect(result.plan.edits.filter((edit) => edit.kind === "removeTrace" && edit.from === ".R1 > .pin2")).toEqual([])
    expect(result.wires).toEqual([R3_VCC, R1_R2])
  })

  test("core takes the change, and after a rebuild the parts and wires are gone and the rest stay", () => {
    const result = plan(mix)
    if ("message" in result) throw new Error(result.message)
    const after = wireIds(applyEdits(SOURCE, result.plan.edits, new Set()))
    expect(after).not.toContain(R3_VCC)
    expect(after).not.toContain(R1_R2)
    expect(after).toContain(VCC_R4)
  })

  test("a wire Studio draws to a part being removed goes with the part, without a word", () => {
    const result = plan(Selection.none.only("R5").addWires([GND]))
    expect(result).toMatchObject({ plan: { edits: [{ kind: "removePart", part: "R5" }], summary: "remove R5", skipped: [] }, wires: [GND], question: "Remove R5 and its connections?" })
  })
})

describe("what Delete cannot remove", () => {
  test("is named in one note, and the rest goes ahead", () => {
    const result = plan(Selection.none.only("R2").addWires([GND, R3_VCC, VCC_R4]), new Set(["R2", "R4"]))
    if ("message" in result) throw new Error(result.message)
    expect(result.plan.edits).toEqual([{ kind: "removeTrace", from: ".R3 > .pin1", to: "net.VCC" }])
    expect(result.question).toBeUndefined()
    expect(result.wires).toEqual([R3_VCC])
    expect(skippedNote(result.plan)).toBe(
      "Not removed: R2 is locked; The wire from R5.pin1 to R6.pin1 has no trace of its own: Studio draws it for net GND; The wire from net VCC to R4.pin1: R4 is locked",
    )
  })

  test("with nothing that can go, the note is the reasons alone", () => {
    const result = plan(Selection.none.onlyWire(GND))
    if ("message" in result) throw new Error(result.message)
    expect(result.plan.edits).toEqual([])
    expect(skippedNote(result.plan)).toBe("The wire from R5.pin1 to R6.pin1 has no trace of its own: Studio draws it for net GND")
  })
})
