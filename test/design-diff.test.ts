import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../src/engine/design.js"
import { diffDesigns, onBoard } from "../src/engine/design-diff.js"

const circuit = (body: string, size = `width="20mm" height="10mm"`) => `export default () => (
  <board ${size}>
${body}
  </board>
)
`
const track = (id: string, points: string) => `{"t":"track","id":"${id}","net":"net:R1.pin2","layer":"top","width":0.25,"points":${points},"locked":false,"by":"human"}`
const via = (id: string) => `{"t":"via","id":"${id}","at":{"x":0,"y":-2},"drill":0.3,"diameter":0.6,"layers":["top","bottom"],"locked":false,"by":"human"}`

const BEFORE_PARTS = `
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} schX={0} schY={0} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={4} pcbY={0} schX={3} schY={0} />
    <resistor name="R2" resistance="10k" footprint="0603" pcbX={0} pcbY={3} schX={6} schY={0} />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />`
const AFTER_PARTS = `
    <resistor name="R1" resistance="2k" footprint="0603" pcbX={-6} pcbY={0} pcbRotation={90} schX={0} schY={2} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={4} pcbY={0} schX={3} schY={0} />
    <resistor name="R3" resistance="4.7k" footprint="0402" pcbX={0} pcbY={-3} schX={9} schY={0} />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />
    <trace from=".R3 > .pin1" to=".C1 > .pin1" />
    <hole x={8} y={4} diameter={1} />`

const build = (files: Record<string, string>): Design => buildDesign(files, "a.circuit.tsx")
const before = build({
  "a.circuit.tsx": circuit(BEFORE_PARTS),
  "a.circuit.layout.json": `${track("t0001", '[{"x":-3,"y":0},{"x":3,"y":0}]')}\n`,
})
const after = build({
  "a.circuit.tsx": circuit(AFTER_PARTS, `width="22mm" height="10mm"`),
  "a.circuit.layout.json": `${track("t0002", '[{"x":-5,"y":0},{"x":3,"y":0}]')}\n${via("v0001")}\n`,
  "rules.yaml": "fabrication:\n  filletRadius: 40mil\n",
})

describe("what changed between two built designs", () => {
  const diff = diffDesigns({ design: before }, { design: after })

  test("parts added, removed, moved (from, to, turn, side) and changed", () => {
    expect(diff.failed).toBeUndefined()
    expect(diff.parts.added.map((part) => part.name)).toEqual(["R3"])
    expect(diff.parts.removed.map((part) => part.name)).toEqual(["R2"])
    expect(diff.parts.moved).toHaveLength(1)
    expect(diff.parts.moved[0]).toMatchObject({ name: "R1", from: { x: -4, y: 0, rotation: 0, side: "top" }, to: { x: -6, y: 0, rotation: 90, side: "top" } })
    expect(diff.parts.moved[0]?.from.courtyard.length).toBeGreaterThan(2)
    expect(diff.parts.changed).toEqual([{ name: "R1", field: "value", from: "1k", to: "2k" }])
    expect(diff.parts.renamed).toEqual([])
  })

  test("pins that joined or left a net, nets that appeared or went", () => {
    expect(diff.nets.joined.map((pin) => `${pin.pin} ${pin.net}`)).toEqual(["R3.pin1 net:C1.pin1"])
    expect(diff.nets.left).toEqual([])
    expect(before.circuit.nets.map((net) => net.id)).toContain("net:C1.pin1")
    expect(diff.nets.appeared).toEqual([])
    expect(diff.nets.went).toEqual([])
  })

  test("tracks and vias added and removed with their ids and lengths; the board's size, holes; the rules", () => {
    expect(diff.tracks.added.map((one) => [one.id, one.length])).toEqual([["t0002", 8]])
    expect(diff.tracks.removed.map((one) => [one.id, one.length])).toEqual([["t0001", 6]])
    expect(diff.vias.added.map((one) => one.id)).toEqual(["v0001"])
    expect(diff.vias.removed).toEqual([])
    expect(diff.board.size).toEqual({ from: "20 x 10 mm", to: "22 x 10 mm" })
    expect(diff.board.outline).toBe(true)
    expect(diff.board.holes.added.map((hole) => hole.id)).toEqual(["hole:1"])
    expect(diff.rules).toEqual([{ path: "fabrication.filletRadius", from: expect.any(String), to: "1.016" }])
    expect(diff.schematic.moved).toEqual(["R1"])
    expect(onBoard(diff)).toBe(true)
  })

  test("the same order every time, and nothing for a design against itself", () => {
    expect(diffDesigns({ design: before }, { design: after })).toEqual(diff)
    const same = diffDesigns({ design: before }, { design: before })
    expect(onBoard(same)).toBe(false)
    expect(same.checks).toEqual({ appeared: [], went: [] })
  })

  test("checks that appeared or went, errors first", () => {
    const plus = (design: Design, ...found: Design["violations"]): Design => ({ ...design, violations: [...design.violations, ...found] })
    const warn = { id: "w:R1", code: "w", severity: "warning" as const, message: "Warn R1", items: ["R1"], view: "pcb" as const }
    const err = { id: "e:C1", code: "e", severity: "error" as const, message: "Short on C1", items: ["C1"], view: "pcb" as const, at: { x: 4, y: 0 } }
    const gone = { id: "g:R2", code: "g", severity: "error" as const, message: "Gone R2", items: ["R2"], view: "pcb" as const }
    const checks = diffDesigns({ design: plus(before, gone) }, { design: plus(before, warn, err) }).checks
    expect(checks.appeared.map((check) => check.message)).toEqual(["Short on C1", "Warn R1"])
    expect(checks.went.map((check) => check.message)).toEqual(["Gone R2"])
  })

  test("a part renamed in place, and a pour added", () => {
    const parts = (name: string) => `    <resistor name="${name}" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />`
    const one = build({ "a.circuit.tsx": circuit(parts("R5")) })
    const two = build({ "a.circuit.tsx": circuit(parts("R6")) })
    const renamed = diffDesigns({ design: one }, { design: two })
    expect(renamed.parts.renamed.map((r) => `${r.from}>${r.to}`)).toEqual(["R5>R6"])
    expect(renamed.parts.added).toEqual([])
    expect(renamed.parts.removed).toEqual([])
    const pour = { id: "copperpour:1", net: "net.GND", layer: "top" as const, priority: 0, minWidth: 0.2, thermal: "relief" as const, thermalWidth: 0.3, thermalGap: 0.3, source: { file: "a", line: 1, column: 1, offset: 0 } }
    const board = one.pcb.board!
    const poured: Design = { ...one, pcb: { ...one.pcb, board: { ...board, pours: [pour] } } }
    const pours = diffDesigns({ design: one }, { design: poured }).pours
    expect(pours.added.map((p) => `${p.id} ${p.net} ${p.layer}`)).toEqual(["copperpour:1 net.GND top"])
    expect(pours.removed).toEqual([])
  })

  test("a side that fails to build is named, and nothing else is guessed", () => {
    const failed = diffDesigns({ design: before }, { error: "Unexpected token at a.circuit.tsx:3" })
    expect(failed.failed).toEqual({ side: "after", message: "Unexpected token at a.circuit.tsx:3" })
    expect(failed.parts.added).toEqual([])
    expect(diffDesigns({ error: "x" }, { error: "y" }).failed).toEqual({ side: "both", message: "y" })
    expect(diffDesigns({ error: "x" }, { design: after }).failed).toEqual({ side: "before", message: "x" })
  })
})

test("an unnamed net keeps its name when a pin that sorts first joins it", () => {
  const two = `
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={4} pcbY={0} />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />`
  const one = build({ "a.circuit.tsx": circuit(two) })
  const more = build({ "a.circuit.tsx": circuit(`${two}\n    <resistor name="A1" resistance="1k" footprint="0603" pcbX={0} pcbY={3} />\n    <trace from=".A1 > .pin1" to=".C1 > .pin1" />`) })
  const name = one.circuit.nets[0]?.id
  expect(more.circuit.nets.map((net) => net.id)).not.toContain(name)
  const nets = diffDesigns({ design: one }, { design: more }).nets
  expect(nets).toEqual({ appeared: [], went: [], joined: [{ pin: "A1.pin1", net: name }], left: [] })
})

test("copper that stayed where it was is not added or removed when only the net it carries changed", () => {
  const changedNet: Design = { ...before, pcb: { ...before.pcb, tracks: before.pcb.tracks.map((t) => ({ ...t, net: "net.OTHER" })) } }
  const copper = diffDesigns({ design: before }, { design: changedNet })
  expect(copper.tracks).toEqual({ added: [], removed: [] })
})
