import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import type { Edit } from "../src/core/types.js"
import { buildDesign, type Design } from "../src/engine/design.js"
import { labelAt, labelBlocker, labelDragEdits } from "../studio/src/pcb/label-drag.js"
import { labelTag } from "../studio/src/pcb/label-tag.js"

const FILE = "main.circuit.tsx"
const wrap = (body: string) => `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
    <chip name="IC1" footprint="soic8" pinLabels={{ pin1: "VIN", pin2: "GND", pin3: "EN", pin4: "GND" }} schX={8} schY={0} />
${body}
  </board>
)`

const DIRECT = wrap(`    <trace from=".R1 > .pin2" to="net.GND" />`)
const INDIRECT = wrap(`    <trace from=".R1 > .pin2" to=".R2 > .pin1" />
    <trace from=".R2 > .pin1" to="net.GND" />`)
const DRAWN = wrap(`    <trace from=".R1 > .pin1" to="net.VCC" schematicRouteHints={[{ x: -1.5, y: 0.3 }, { x: -1.5, y: 1 }]} />`)
const REVERSED = wrap(`    <trace from="net.VCC" to="R1.pin1" schematicRouteHints={[{ x: -1.5, y: 1 }, { x: -1.5, y: 0.3 }]} />`)
const LOOPED = wrap(`    {[1].map(() => <trace from=".R1 > .pin2" to="net.GND" />)}`)
const SHARED = wrap(`    <trace from="IC1.pin2" to=".R2 > .pin2" />
    <trace from=".R2 > .pin2" to="net.GND" />`)

function setup(source: string) {
  const design = buildDesign({ [FILE]: source }, FILE)
  return { design, model: { model: analyzeCircuit(source) } }
}

const pinEnd = (design: Design, pin: string) => {
  const end = design.schematic.symbols.find((s) => s.pinEnds[pin])?.pinEnds[pin]
  if (!end) throw new Error(`no pin ${pin}`)
  return end
}

const labelOf = (design: Design, id: string) => {
  const label = design.schematic.labels.find((l) => l.id === id)
  if (!label) throw new Error(`no label ${id}: ${design.schematic.labels.map((l) => l.id).join(", ")}`)
  return label
}

/** Applies the edits to the source and builds the result. */
function rebuilt(source: string, edits: Edit[]): Design {
  return buildDesign({ [FILE]: applyEdits(source, edits, new Set()) }, FILE)
}

describe("labelDragEdits", () => {
  const Q = { x: 2, y: -1.5 }

  test("an automatic ground symbol with a direct trace sets that trace's corners, horizontal first", () => {
    const { design, model } = setup(DIRECT)
    const p = pinEnd(design, "R1.pin2")
    const edits = labelDragEdits(design, model, "label:net.GND:R1.pin2", Q)
    expect(edits).toEqual([{ kind: "setTraceHints", from: ".R1 > .pin2", to: "net.GND", schematicRouteHints: [{ x: Q.x, y: p.y }, Q] }])
  })

  test("a drop in line with the pin gives a single corner", () => {
    const { design, model } = setup(DIRECT)
    const p = pinEnd(design, "R1.pin2")
    const drop = { x: p.x, y: p.y - 1 }
    const edits = labelDragEdits(design, model, "label:net.GND:R1.pin2", drop)
    expect(edits).toEqual([{ kind: "setTraceHints", from: ".R1 > .pin2", to: "net.GND", schematicRouteHints: [drop] }])
  })

  test("with no direct trace to the net it adds one from the pin, carrying the corners", () => {
    const { design, model } = setup(INDIRECT)
    const p = pinEnd(design, "R1.pin2")
    const edits = labelDragEdits(design, model, "label:net.GND:R1.pin2", Q)
    expect(edits).toEqual([{ kind: "addTrace", from: "R1.pin2", to: "net.GND", schematicRouteHints: [{ x: Q.x, y: p.y }, Q] }])
  })

  test("a pin name two pins share is written as pin<n>", () => {
    const { design, model } = setup(SHARED)
    const edits = labelDragEdits(design, model, "label:net.GND:IC1.pin2", Q)
    expect(edits).toMatchObject([{ kind: "addTrace", from: "IC1.pin2", to: "net.GND" }])
  })

  test("a hand-drawn label keeps its earlier corners and moves the last one", () => {
    const { design, model } = setup(DRAWN)
    const edits = labelDragEdits(design, model, "label:R1.pin1|net.VCC", { x: -3, y: 2 })
    expect(edits).toEqual([
      { kind: "setTraceHints", from: ".R1 > .pin1", to: "net.VCC", schematicRouteHints: [{ x: -1.5, y: 0.3 }, { x: -3, y: 0.3 }, { x: -3, y: 2 }] },
    ])
    expect(design.schematic.labels.map((l) => l.id)).toContain("label:R1.pin1|net.VCC")
  })

  test("a hand-drawn label whose trace is written net first is written back in the trace's order", () => {
    const { design, model } = setup(REVERSED)
    const edits = labelDragEdits(design, model, "label:net.VCC|R1.pin1", { x: -3, y: 2 })
    expect(edits).toEqual([
      { kind: "setTraceHints", from: "net.VCC", to: "R1.pin1", schematicRouteHints: [{ x: -3, y: 2 }, { x: -3, y: 0.3 }, { x: -1.5, y: 0.3 }] },
    ])
  })

  test("dropping a label on its pin's end changes nothing", () => {
    const { design, model } = setup(DIRECT)
    expect(labelDragEdits(design, model, "label:net.GND:R1.pin2", pinEnd(design, "R1.pin2"))).toEqual([])
  })

  test("dropping a hand-drawn label back on its pin removes the corners", () => {
    const { design, model } = setup(DRAWN)
    const edits = labelDragEdits(design, model, "label:R1.pin1|net.VCC", pinEnd(design, "R1.pin1"))
    expect(edits).toEqual([{ kind: "setTraceHints", from: ".R1 > .pin1", to: "net.VCC", schematicRouteHints: [] }])
  })

  test("a read-only trace blocks the drag", () => {
    const { design, model } = setup(LOOPED)
    const result = labelDragEdits(design, model, "label:net.GND:R1.pin2", Q)
    expect(result).toEqual({ blocked: expect.stringContaining("read-only") })
    expect(labelBlocker(design, model, "label:net.GND:R1.pin2")).toContain("read-only")
    expect(labelBlocker(setup(DIRECT).design, setup(DIRECT).model, "label:net.GND:R1.pin2")).toBeNull()
  })

  test("a trace whose corners are an expression blocks the drag", () => {
    const source = `const route = [{ x: -1.5, y: 1 }]\n${wrap(`    <trace from=".R1 > .pin1" to="net.VCC" schematicRouteHints={route} />`)}`
    const { design, model } = setup(source)
    expect(labelBlocker(design, model, "label:R1.pin1|net.VCC")).toContain("expression")
  })

  test("an unknown label has nothing to move", () => {
    const { design, model } = setup(DIRECT)
    expect(labelDragEdits(design, model, "label:net.X:R9.pin1", Q)).toEqual({ blocked: expect.any(String) })
  })
})

describe("selector resolution and locks", () => {
  const Q = { x: 2, y: -1.5 }

  test("a trace written with a pin alias is found", () => {
    const source = wrap(`    <led name="D1" footprint="0603" schX={0} schY={4} />
    <trace from="D1.anode" to="net.VCC" />`)
    const { design, model } = setup(source)
    const id = design.schematic.labels.find((l) => l.net === "net.VCC")?.id ?? ""
    expect(id).toBe("label:net.VCC:D1.pin1")
    expect(labelDragEdits(design, model, id, Q)).toMatchObject([{ kind: "setTraceHints", from: "D1.anode", to: "net.VCC" }])
  })

  test("a name several pins share resolves to the first pin; the other pin gets an addTrace with pin<n>", () => {
    const body = `    <trace from="IC1.GND" to="net.GND" />
    <trace from="IC1.pin4" to=".R2 > .pin1" />
    <trace from=".R2 > .pin1" to="net.GND" />`
    const source = wrap(body).replace("<board ", "<board schMaxTraceDistance={0.01} ")
    const { design, model } = setup(source)
    expect(design.schematic.labels.map((l) => l.id)).toEqual(expect.arrayContaining(["label:net.GND:IC1.pin2", "label:net.GND:IC1.pin4"]))
    expect(labelDragEdits(design, model, "label:net.GND:IC1.pin2", Q)).toMatchObject([{ kind: "setTraceHints", from: "IC1.GND", to: "net.GND" }])
    expect(labelDragEdits(design, model, "label:net.GND:IC1.pin4", Q)).toMatchObject([{ kind: "addTrace", from: "IC1.pin4", to: "net.GND" }])
  })

  test("a label with no findable pin, such as one on a repeated name (RX~2), is blocked", () => {
    const { design, model } = setup(DIRECT)
    expect(labelDragEdits(design, model, "label:net.GND:RX~2.pin1", Q)).toEqual({ blocked: expect.any(String) })
  })

  test("a locked part blocks the drag with the Studio's wording, and an unlocked one does not", () => {
    const { design, model } = setup(DIRECT)
    const id = "label:net.GND:R1.pin2"
    expect(labelBlocker(design, model, id, new Set(["R1"]))).toBe("R1 is locked")
    expect(labelDragEdits(design, model, id, Q, new Set(["R1"]))).toEqual({ blocked: "R1 is locked" })
    expect(labelBlocker(design, model, id, new Set(["R2"]))).toBeNull()
  })

  test("a locked part at the far end of the trace blocks it too", () => {
    const { design, model } = setup(wrap('    <trace from="net.GND" to=".R1 > .pin2" />'))
    expect(labelBlocker(design, model, "label:net.GND:R1.pin2", new Set(["R1"]))).toBe("R1 is locked")
  })
})

describe("engine round trip", () => {
  const Q = { x: 2, y: -1.5 }

  test.each([
    ["direct trace", DIRECT, "label:net.GND:R1.pin2", "R1.pin2"],
    ["indirect trace", INDIRECT, "label:net.GND:R1.pin2", "R1.pin2"],
  ])("%s: the label sits at the drop point with a wire from the pin", (_name, source, id, pin) => {
    const { design, model } = setup(source)
    const edits = labelDragEdits(design, model, id, Q)
    if (!Array.isArray(edits)) throw new Error(edits.blocked)
    const after = rebuilt(source, edits)
    const labels = after.schematic.labels.filter((l) => l.net === "net.GND")
    expect(labels.map((l) => l.at)).toEqual([Q])
    const wire = after.schematic.wires.find((w) => w.connection === `${pin}|net.GND`)
    expect(wire?.points[0]).toEqual(pinEnd(after, pin))
    expect(wire?.points[(wire?.points.length ?? 1) - 1]).toEqual(Q)
  })

  test("a hand-drawn label ends where it was dropped", () => {
    const { design, model } = setup(DRAWN)
    const edits = labelDragEdits(design, model, "label:R1.pin1|net.VCC", { x: -3, y: 2 })
    if (!Array.isArray(edits)) throw new Error(edits.blocked)
    expect(labelOf(rebuilt(DRAWN, edits), "label:R1.pin1|net.VCC").at).toEqual({ x: -3, y: 2 })
  })

  test("a trace written net first keeps the label at the drop point", () => {
    const { design, model } = setup(REVERSED)
    const edits = labelDragEdits(design, model, "label:net.VCC|R1.pin1", { x: -3, y: 2 })
    if (!Array.isArray(edits)) throw new Error(edits.blocked)
    expect(labelOf(rebuilt(REVERSED, edits), "label:net.VCC|R1.pin1").at).toEqual({ x: -3, y: 2 })
  })

  test("dropping a hand-drawn label back on its pin brings the automatic label back", () => {
    const { design, model } = setup(DRAWN)
    const edits = labelDragEdits(design, model, "label:R1.pin1|net.VCC", pinEnd(design, "R1.pin1"))
    if (!Array.isArray(edits)) throw new Error(edits.blocked)
    const after = rebuilt(DRAWN, edits)
    expect(after.schematic.labels.map((l) => l.id)).toEqual(["label:net.VCC:R1.pin1"])
  })
})

describe("labelAt", () => {
  test("a net label is hit inside its drawn tag and not outside it", () => {
    const { design } = setup(wrap(`    <trace from=".R1 > .pin1" to="net.SIG" />\n    <trace from=".R2 > .pin1" to="net.SIG" schematicRouteHints={[{ x: 5, y: 3 }]} />`))
    const label = design.schematic.labels.find((l) => l.style === "label")
    if (!label) throw new Error("no net label")
    const { box } = labelTag(label)
    expect(labelAt(design, { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 })?.id).toBe(label.id)
    expect(labelAt(design, { x: box.maxX + 0.5, y: box.maxY + 0.5 })).toBeUndefined()
  })

  test("a ground symbol is hit within its drawn bounds plus 0.1", () => {
    const { design } = setup(DIRECT)
    const label = labelOf(design, "label:net.GND:R1.pin2")
    expect(label.style).toBe("ground")
    expect(labelAt(design, { x: label.at.x + 0.2, y: label.at.y - 0.25 })?.id).toBe(label.id)
    expect(labelAt(design, { x: label.at.x + 0.3, y: label.at.y })).toBeUndefined()
    expect(labelAt(design, { x: label.at.x, y: label.at.y - 0.31 })).toBeUndefined()
  })

  test("a power symbol is hit on its bar", () => {
    const { design } = setup(DRAWN)
    const label = labelOf(design, "label:R1.pin1|net.VCC")
    expect(label.style).toBe("power")
    expect(labelAt(design, { x: label.at.x, y: label.at.y + 0.1 })?.id).toBe(label.id)
  })

  test("nothing far from every label", () => {
    const { design } = setup(DIRECT)
    expect(labelAt(design, { x: 50, y: 50 })).toBeUndefined()
  })
})
