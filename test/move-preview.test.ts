import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import { buildDesign } from "../src/engine/design.js"
import { moveWithWires, type GestureInput } from "../studio/src/pcb/gestures.js"
import { labelsAfterMove } from "../studio/src/pcb/move-preview.js"
import { moveBlocker, partAnchors } from "../studio/src/pcb/positions.js"
import { sheetBoxes } from "../studio/src/pcb/schematic-draw.js"

const FILE = "main.circuit.tsx"
const p = (x: number, y: number) => ({ x, y })

// R1.pin1 is on GND with no wire, so Studio puts a ground symbol on its pin end. R1.pin2 has a hand-drawn wire whose
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

const design = buildDesign({ [FILE]: SOURCE }, FILE)
const source = { model: analyzeCircuit(SOURCE) }
const input = {
  view: "schematic",
  circuit: source,
  anchors: partAnchors(design, "schematic"),
  boxes: sheetBoxes(design.schematic),
  blockerFor: (name: string) => moveBlocker(source, new Set(), name, "schematic"),
  follow: { design, locked: new Set<string>() },
} as unknown as GestureInput

const places = (labels: readonly { id: string; at: { x: number; y: number }; side: string }[]) => Object.fromEntries(labels.map((label) => [label.id, { at: label.at, side: label.side }]))

describe("the labels a move takes along", () => {
  test("the sheet has a ground symbol on a pin and labels at the ends of hand-drawn wires", () => {
    expect(design.schematic.labels.map((label) => label.id).sort()).toEqual(["label:R1.pin2|net.SIG", "label:R3.pin2|net.OUT", "label:net.GND:R1.pin1"])
  })

  test("are drawn where the build then puts them: a symbol on a moved pin moves with it, a wire's label sits at the end of its new shape", () => {
    const offset = p(0.3, 0.5)
    const { plan, lines } = moveWithWires(input, ["R1", "R3"], offset, [])
    const shown = labelsAfterMove(design.schematic, { names: plan.parts, offset, wires: lines })
    const built = buildDesign({ [FILE]: applyEdits(SOURCE, plan.edits, new Set()) }, FILE)
    expect(places(shown)).toEqual(places(built.schematic.labels))
    expect(places(shown)["label:net.GND:R1.pin1"]?.at).not.toEqual(places(design.schematic.labels)["label:net.GND:R1.pin1"]?.at)
  })

  test("a label at the end of a wire whose end stays keeps its place", () => {
    const { plan, lines } = moveWithWires(input, ["R3"], p(0, 0.5), [])
    const shown = labelsAfterMove(design.schematic, { names: plan.parts, offset: p(0, 0.5), wires: lines })
    expect(places(shown)["label:R3.pin2|net.OUT"]).toEqual(places(design.schematic.labels)["label:R3.pin2|net.OUT"])
  })

  test("with nothing moving, the labels are the sheet's own", () => {
    expect(labelsAfterMove(design.schematic, undefined)).toBe(design.schematic.labels)
    expect(labelsAfterMove(design.schematic, { names: [], offset: p(0, 0), wires: [] })).toBe(design.schematic.labels)
  })
})
