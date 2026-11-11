import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { fabricationSet } from "../../src/engine/fab/export.js"
import { filesIn } from "../helpers/place-fixtures.js"

const FOLDER = join(import.meta.dirname, "..", "fixtures", "can-proof-3")
const MAIN = "can-module.circuit.tsx"
const CREATED = new Date("2026-11-12T00:00:00Z")

describe("check and export agree on the silkscreen", () => {
  const design = buildDesign(filesIn(FOLDER), MAIN)
  const exported = fabricationSet(design, [], CREATED)
  if (!exported.ok) throw new Error(`the proof board did not export: ${exported.errors.join("; ")}`)
  const warned = exported.warnings.filter((w) => w.includes("'s silkscreen overlaps"))
  const checked = design.violations.filter((v) => v.code === "silk-on-pad" && v.items.some((item) => item.endsWith(" designator")))

  test("the proof board's designator findings: the export warns about them, and the check reports the same ones", () => {
    // The third proof run's export warned about C2 over U2's pads and R3's designator, and two more.
    expect(warned.length).toBeGreaterThanOrEqual(3)
    expect(warned).toContain("C2's silkscreen overlaps U2's pads and R3's designator")
    expect(checked.map((v) => v.message)).toEqual(warned)
  })

  test("each check finding is a warning that names the part, the parts it covers, and sits at the designator", () => {
    const c2 = checked.find((v) => v.message.startsWith("C2's"))
    expect(c2?.severity).toBe("warning")
    expect(c2?.items).toEqual(["C2", "C2 designator", "R3", "U2"])
    expect(c2?.at).toBeDefined()
    expect(new Set(design.violations.map((v) => v.id)).size).toBe(design.violations.length)
  })
})
