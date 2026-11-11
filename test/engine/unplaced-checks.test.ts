import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { withoutUnplacedPositions } from "../../src/engine/checks/unplaced-parts.js"
import { violation } from "../../src/engine/checks/violation.js"
import { filesIn } from "../helpers/place-fixtures.js"

const FOLDER = join(import.meta.dirname, "..", "fixtures", "can-proof")
const MAIN = "can-module.circuit.tsx"
const LAYOUT = "can-module.circuit.layout.json"

/** The proof run's circuit as new_circuit wrote it with place: false: no part has a position, no copper. */
function beforePlacement(): Record<string, string> {
  const { [LAYOUT]: _, ...files } = filesIn(FOLDER)
  const source = (files[MAIN] ?? "").replace(/ pcbX=\{[-\d.]+\} pcbY=\{[-\d.]+\} pcbRotation=\{\d+\}/g, "")
  return { ...files, [MAIN]: source }
}

describe("checks on parts nobody has placed", () => {
  test("the proof circuit before placement: 0 errors, and the unplaced warning names every part", () => {
    const files = beforePlacement()
    expect(files[MAIN]).not.toMatch(/pcbY/)
    const design = buildDesign(files, MAIN)
    expect(design.pcb.parts.every((part) => part.autoPlaced)).toBe(true)
    const errors = design.violations.filter((v) => v.severity === "error")
    expect(errors).toEqual([])
    expect(design.violations.map((v) => v.code)).not.toEqual(expect.arrayContaining(["board-edge"]))
    expect(design.violations.find((v) => v.code === "unplaced")?.items).toHaveLength(design.pcb.parts.length)
  })

  test("a placed part keeps its position findings; an auto-placed one keeps only what its footprint does on its own", () => {
    const parts = [
      { component: "U1", autoPlaced: true },
      { component: "R1", autoPlaced: false },
      { component: "R2", autoPlaced: false },
    ] as never
    const found = [
      violation("board-edge", "error", "U1#15 is outside the board", ["U1#15"], "pcb"),
      violation("board-edge", "error", "R1#1 is outside the board", ["R1#1"], "pcb"),
      violation("courtyard-overlap", "error", "overlap", ["U1", "R1"], "pcb"),
      violation("courtyard-overlap", "error", "overlap", ["R1", "R2"], "pcb"),
      violation("clearance", "error", "own pads", ["U1#1", "U1#2"], "pcb"),
      violation("clearance", "error", "pads of two parts", ["U1#1", "R1#2"], "pcb"),
      violation("unplaced", "warning", "no position", ["U1"], "pcb"),
    ]
    expect(withoutUnplacedPositions(found, { parts }).map((v) => v.id)).toEqual([
      "board-edge:R1#1",
      "courtyard-overlap:R1,R2",
      "clearance:U1#1,U1#2",
      "unplaced:U1",
    ])
  })
})
