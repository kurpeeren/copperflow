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
    // The third proof run's export warned about C2 over U2's pads and R3's designator, and two more. The placer now
    // finds those clear places; R3 has none, and lies on JP1's courtyard.
    expect(warned).toEqual(["R3's silkscreen overlaps JP1's courtyard"])
    expect(checked.map((v) => v.message)).toEqual(warned)
  })

  test("each check finding is a warning that names the part, the parts it covers, and sits at the designator", () => {
    const r3 = checked.find((v) => v.message.startsWith("R3's"))
    expect(r3?.severity).toBe("warning")
    expect(r3?.items).toEqual(["JP1", "R3", "R3 designator"])
    expect(r3?.at).toBeDefined()
    expect(new Set(design.violations.map((v) => v.id)).size).toBe(design.violations.length)
  })
})
