import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import type { Edit } from "../src/core/types.js"
import { buildDesign, type Design } from "../src/engine/design.js"
import type { NetLabel } from "../src/engine/schematic.js"
import { labelRenameEdits, renameQuestion } from "../studio/src/pcb/label-rename.js"

const FILE = "main.circuit.tsx"
const wrap = (body: string) => `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={6} schY={0} />
${body}
  </board>
)`

const DIRECT = wrap(`    <trace from=".R1 > .pin2" to="net.GND" />`)
const TWO = wrap(`    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.GND" />`)
const DRAWN = wrap(`    <trace from=".R1 > .pin1" to="net.VCC" schematicRouteHints={[{ x: -1.5, y: 0.3 }, { x: -1.5, y: 1 }]} />`)
const REVERSED = wrap(`    <trace from="net.VCC" to="R1.pin1" schematicRouteHints={[{ x: -1.5, y: 1 }, { x: -1.5, y: 0.3 }]} />`)
const LOOPED = wrap(`    {[1].map(() => <trace from=".R1 > .pin2" to="net.GND" />)}`)
const BOTH = wrap(`    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.VCC" />`)

function setup(source: string) {
  const design = buildDesign({ [FILE]: source }, FILE)
  return { design, model: { model: analyzeCircuit(source) } }
}

/** The label of the net named `text`. */
function labelNamed(design: Design, text: string): NetLabel {
  const label = design.schematic.labels.find((l) => l.text === text)
  if (!label) throw new Error(`no ${text} label: ${design.schematic.labels.map((l) => l.text).join(", ")}`)
  return label
}

const NONE: ReadonlySet<string> = new Set()

function rebuilt(source: string, edits: Edit[]): Design {
  return buildDesign({ [FILE]: applyEdits(source, edits, new Set()) }, FILE)
}

const netOf = (design: Design, pin: string) => design.circuit.nets.find((net) => net.pins.includes(pin))

describe("renaming a net from its label", () => {
  test("rewrites the trace to the old name as a trace to the new one, in one change", () => {
    const { design, model } = setup(DIRECT)
    const plan = labelRenameEdits(design, model, labelNamed(design, "GND"), "AGND", NONE)
    expect(plan).toEqual({
      edits: [
        { kind: "removeTrace", from: ".R1 > .pin2", to: "net.GND" },
        { kind: "addTrace", from: ".R1 > .pin2", to: "net.AGND" },
      ],
      summary: "Rename net GND to AGND",
    })
    if (!("edits" in plan)) return
    const after = rebuilt(DIRECT, plan.edits)
    expect(netOf(after, "R1.pin2")?.names).toEqual(["AGND"])
    expect(after.circuit.nets.some((net) => net.names.includes("GND"))).toBe(false)
  })

  test("renames the net everywhere it is written, not only at this label", () => {
    const { design, model } = setup(TWO)
    const plan = labelRenameEdits(design, model, labelNamed(design, "GND"), "AGND", NONE)
    if (!("edits" in plan)) throw new Error(plan.blocked)
    expect(plan.edits.filter((edit) => edit.kind === "removeTrace")).toHaveLength(2)
    const after = rebuilt(TWO, plan.edits)
    expect(netOf(after, "R1.pin2")?.names).toEqual(["AGND"])
    expect(netOf(after, "R2.pin1")?.names).toEqual(["AGND"])
  })

  test("a hand-drawn label keeps its corners, in the trace's own order", () => {
    for (const source of [DRAWN, REVERSED]) {
      const { design, model } = setup(source)
      const before = model.model.traces[0]
      const plan = labelRenameEdits(design, model, labelNamed(design, "VCC"), "V3V3", NONE)
      if (!("edits" in plan)) throw new Error(plan.blocked)
      const added = plan.edits.find((edit) => edit.kind === "addTrace")
      expect(added).toMatchObject({ schematicRouteHints: before?.schematicRouteHints })
      expect([added && "from" in added ? added.from : "", added && "to" in added ? added.to : ""]).toEqual(
        source === DRAWN ? [".R1 > .pin1", "net.V3V3"] : ["net.V3V3", "R1.pin1"],
      )
      expect(netOf(rebuilt(source, plan.edits), "R1.pin1")?.names).toEqual(["V3V3"])
    }
  })

  test("the same name again changes nothing", () => {
    const { design, model } = setup(DIRECT)
    expect(labelRenameEdits(design, model, labelNamed(design, "GND"), " GND ", NONE)).toEqual({ edits: [], summary: "Rename net GND to GND" })
  })

  test("a name another net has joins the two, and says so", () => {
    const { design, model } = setup(BOTH)
    const plan = labelRenameEdits(design, model, labelNamed(design, "GND"), "VCC", NONE)
    expect(plan).toMatchObject({ joins: "VCC" })
  })

  test("a name that is not a net name is refused with the naming rule", () => {
    const { design, model } = setup(DIRECT)
    expect(labelRenameEdits(design, model, labelNamed(design, "GND"), "3V3", NONE)).toEqual({ blocked: expect.stringContaining("letters") })
    expect(labelRenameEdits(design, model, labelNamed(design, "GND"), "  ", NONE)).toEqual({ blocked: "Name the net label" })
  })

  test("a locked part on one of the traces blocks the rename", () => {
    const { design, model } = setup(TWO)
    expect(labelRenameEdits(design, model, labelNamed(design, "GND"), "AGND", new Set(["R2"]))).toEqual({ blocked: "R2 is locked" })
  })

  test("a read-only trace blocks the rename", () => {
    const { design, model } = setup(LOOPED)
    expect(labelRenameEdits(design, model, labelNamed(design, "GND"), "AGND", NONE)).toEqual({ blocked: expect.stringContaining("read-only") })
  })

  test("a trace whose pin the Studio cannot find blocks the rename, as a locked part would", () => {
    const { design, model } = setup(DIRECT)
    const [trace] = model.model.traces
    if (!trace) throw new Error("no trace")
    const lost = { model: { ...model.model, traces: [{ ...trace, from: ".Q9 > .pin1" }] } }
    expect(labelRenameEdits(design, lost, labelNamed(design, "GND"), "AGND", NONE)).toEqual({ blocked: expect.stringContaining(".Q9 > .pin1") })
  })

  test("a name written on no trace has to be renamed in the code", () => {
    const { design, model } = setup(DIRECT)
    const bare = { model: { ...model.model, traces: [] } }
    expect(labelRenameEdits(design, bare, labelNamed(design, "GND"), "AGND", NONE)).toEqual({ blocked: expect.stringContaining("in the code") })
  })
})

describe("the question before a ground or power flag renames its net", () => {
  test("asks to rename the net everywhere, with the connections counted", () => {
    const one = setup(DIRECT)
    expect(renameQuestion(one.model, labelNamed(one.design, "GND"))).toBe("Rename the GND net everywhere (1 connection)?")
    const two = setup(TWO)
    expect(renameQuestion(two.model, labelNamed(two.design, "GND"))).toBe("Rename the GND net everywhere (2 connections)?")
  })

  test("a power flag asks too", () => {
    const { design, model } = setup(DRAWN)
    expect(renameQuestion(model, labelNamed(design, "VCC"))).toBe("Rename the VCC net everywhere (1 connection)?")
  })

  test("a plain net label asks nothing", () => {
    const { design, model } = setup(DIRECT)
    expect(renameQuestion(model, { ...labelNamed(design, "GND"), style: "label" })).toBeUndefined()
  })
})
