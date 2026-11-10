import { expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { cachedPourFills, pourInputKey } from "../../src/engine/pour/cache.js"
import { fillPours, type PourInputs } from "../../src/engine/pour/fill.js"
import { loadRules } from "../../src/engine/rules/load.js"

const MAIN = "main.circuit.tsx"

function circuit(x = 0, pours = `<copperpour net="GND" layer="top" /><copperpour net="GND" layer="bottom" thermal="solid" />`): Record<string, string> {
  const body = [
    `<resistor name="R1" resistance="1k" footprint="0402" pcbX={${x}} pcbY={0} />`,
    `<resistor name="R2" resistance="1k" footprint="0402" pcbX={4} pcbY={0} />`,
    `<trace from="R1.pin1" to="net.GND" />`,
    `<trace from="R2.pin1" to="net.GND" />`,
    `<trace from="R1.pin2" to="R2.pin2" />`,
    pours,
    `<hole x={-6} y={-6} diameter={3.2} />`,
  ].join("\n")
  return { [MAIN]: `export default () => (<board width="20mm" height="20mm">${body}</board>)` }
}

test("the design carries the filled pours and the holes", () => {
  const design = buildDesign(circuit(), MAIN)
  expect(design.pcb.holes).toEqual([expect.objectContaining({ id: "hole:1", x: -6, y: -6, diameter: 3.2 })])
  expect(design.pcb.pours.map((pour) => [pour.id, pour.net, pour.layer])).toEqual([
    ["copperpour:1", "net.GND", "top"],
    ["copperpour:2", "net.GND", "bottom"],
  ])
  const [top, bottom] = design.pcb.pours
  expect(top?.polygons).toHaveLength(1)
  expect(top?.area).toBeGreaterThan(300)
  expect(top?.area).toBeLessThan(19.6 * 19.6 - Math.PI * 1.8 * 1.8)
  // The bottom has no GND copper (the parts' pads are on top): nothing to join to, so it keeps its whole fill.
  expect(bottom?.area).toBeCloseTo(19.6 * 19.6 - Math.PI * 1.8 * 1.8, 0)
  expect(design.diagnostics).toEqual([])
})

test("a board without pours has none, and an unchanged board is not filled again", () => {
  expect(buildDesign(circuit(0, ""), MAIN).pcb.pours).toEqual([])
  const first = buildDesign(circuit(), MAIN).pcb.pours
  expect(buildDesign(circuit(), MAIN).pcb.pours).toBe(first)
  const moved = buildDesign(circuit(-2), MAIN).pcb.pours
  expect(moved).not.toBe(first)
  expect(moved[0]?.polygons).not.toEqual(first[0]?.polygons)
})

test("the cache key leaves out source positions but not what the fill depends on", () => {
  const design = buildDesign(circuit(), MAIN)
  const board = design.pcb.board
  if (!board) throw new Error("no board")
  const inputs: PourInputs = {
    board,
    pads: design.pcb.parts.flatMap((part) => part.pads),
    tracks: [],
    vias: [],
    rules: loadRules({}).rules,
    classOf: () => "default",
  }
  const shifted = { ...board, pours: board.pours?.map((pour) => ({ ...pour, source: { ...pour.source, line: 99 } })) }
  expect(pourInputKey({ ...inputs, board: shifted })).toBe(pourInputKey(inputs))
  expect(pourInputKey({ ...inputs, board: { ...board, holes: [] } })).not.toBe(pourInputKey(inputs))
  expect(cachedPourFills(inputs)).toEqual(fillPours(inputs))
})
