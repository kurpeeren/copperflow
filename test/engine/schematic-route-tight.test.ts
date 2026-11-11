import { expect, test } from "vitest"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import { layoutSchematicWithDiagnostics } from "../../src/engine/schematic.js"
import { CAN_FOLDER, CAN_MAIN, filesIn } from "../helpers/place-fixtures.js"

/** The CAN module with no schematic positions: the placer packs the crystal 0.3 from the MCP2515. */
function canUnplacedSchematic() {
  const files = filesIn(CAN_FOLDER)
  const main = (files[CAN_MAIN] as string).replace(/ schX=\{[^}]*\} schY=\{[^}]*\} schRotation=\{[^}]*\}/g, "")
  const circuit = elaborate(evaluateCircuit({ ...files, [CAN_MAIN]: main }, CAN_MAIN), CAN_MAIN, { padCount: () => undefined })
  return layoutSchematicWithDiagnostics(circuit)
}

test("three neighbouring chip pins tied to VCC and the chip-to-chip wire route without a warning", () => {
  const { layout, diagnostics } = canUnplacedSchematic()
  const warned = diagnostics.filter((d) => d.code === "auto-route").map((d) => d.items.join("–"))
  for (const pair of ["U1.pin4–U1.pin5", "U1.pin5–U1.pin6", "U1.pin1–U2.pin1", "C3.pin1–U1.pin6", "R1.pin2–U1.pin17", "U2.pin2–U2.pin8"]) {
    expect(warned).not.toContain(pair)
  }
  // Before the fix nine wires of this sheet were drawn straight.
  expect(warned.length).toBeLessThanOrEqual(3)
  expect(canUnplacedSchematic().layout).toEqual(layout)
})
