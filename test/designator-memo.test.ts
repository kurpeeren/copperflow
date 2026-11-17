// The designators of one board are placed once: the check (which lists the placed parts anew), the design (which
// adds each designator's place to its part) and the export all get the kept answer. Without this, every build placed
// them twice and every check placed them again.
import { expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { DEFAULT_MASK_EXPANSION, designatorPlacements, silkClearance, withDesignators } from "../src/engine/fab/designators.js"

const CIRCUIT = `export default () => (
  <board width="20mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-4} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" pcbX={0} pcbY={0} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={4} pcbY={0} />
    <trace from=".R1 > .pin2" to=".R2 > .pin1" />
    <trace from=".R2 > .pin2" to=".C1 > .pin1" />
  </board>
)`

function board() {
  const design = buildDesign({ "main.circuit.tsx": CIRCUIT }, "main.circuit.tsx")
  const fabrication = design.rules.fabrication
  return { pcb: design.pcb, fabrication, expansion: fabrication.maskExpansion ?? DEFAULT_MASK_EXPANSION, clearance: silkClearance(fabrication) }
}

test("the same parts in another list get the kept answer", () => {
  const { pcb, expansion, clearance } = board()
  const first = designatorPlacements(pcb, expansion, clearance)
  expect(designatorPlacements({ ...pcb, parts: [...pcb.parts] }, expansion, clearance)).toBe(first)
  expect(designatorPlacements({ ...pcb, parts: pcb.parts.filter(() => true) }, expansion, clearance)).toBe(first)
})

test("the board that carries the designators' places has the answer it was made from", () => {
  const { pcb, fabrication, expansion, clearance } = board()
  const bare = { ...pcb, parts: pcb.parts.map(({ designatorAt: _at, designatorRotation: _turn, ...part }) => part) }
  const first = designatorPlacements(bare, expansion, clearance)
  expect(designatorPlacements(withDesignators(bare, fabrication), expansion, clearance)).toBe(first)
})

test("another clearance, another part or fewer parts are placed anew", () => {
  const { pcb, expansion, clearance } = board()
  const first = designatorPlacements(pcb, expansion, clearance)
  expect(designatorPlacements(pcb, expansion, clearance + 0.1)).not.toBe(first)
  expect(designatorPlacements({ ...pcb, parts: pcb.parts.slice(1) }, expansion, clearance)).not.toBe(first)
  const moved = pcb.parts.map((part, i) => (i === 2 ? { ...part, x: part.x + 1 } : part))
  expect(designatorPlacements({ ...pcb, parts: moved }, expansion, clearance)).not.toBe(first)
  expect(designatorPlacements({ ...pcb, vias: [] }, expansion, clearance)).not.toBe(first)
})
