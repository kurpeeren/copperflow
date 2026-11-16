import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { DEFAULT_MASK_EXPANSION, designatorPlacements, silkClearance } from "../src/engine/fab/designators.js"
import { boardTexts, boardWithTextMoves } from "../studio/src/pcb/part-text.js"

const FOLDER = join(import.meta.dirname, "fixtures", "can-module")

function filesIn(folder: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else files[relative(folder, path).split("\\").join("/")] = readFileSync(path, "utf8")
    }
  }
  walk(folder)
  return files
}

describe("the Studio's silkscreen designators", () => {
  const design = buildDesign(filesIn(FOLDER), "can-module.circuit.tsx")
  const exported = new Map(designatorPlacements(design.pcb, design.rules.fabrication.maskExpansion ?? DEFAULT_MASK_EXPANSION, silkClearance(design.rules.fabrication)).map((p) => [p.component, p.at]))

  test("the design carries each part's designator anchor, the same the export draws, for the CAN module", () => {
    for (const part of design.pcb.parts) expect(part.designatorAt, part.component).toEqual(exported.get(part.component))
    expect(boardTexts(design.pcb).map((text) => [text.part, text.at])).toEqual(design.pcb.parts.map((part) => [part.component, exported.get(part.component)]))
    // C1 would cover U1's pads above its courtyard; the Studio shows it where the export moved it.
    expect(boardTexts(design.pcb).find((text) => text.part === "C1")?.at).not.toEqual({ x: -12.5, y: -3.8 })
  })

  test("a moved designator still wins, in the Studio as in the export", () => {
    const moved = boardWithTextMoves(design.pcb, [{ id: "C1:pcbNameAt", at: { x: 3, y: 4 } }])
    expect(boardTexts(moved).find((text) => text.part === "C1")?.at).toEqual({ x: 3, y: 4 })
    expect(designatorPlacements(moved, 0.05).find((p) => p.component === "C1")?.at).toEqual({ x: 3, y: 4 })
  })
})
