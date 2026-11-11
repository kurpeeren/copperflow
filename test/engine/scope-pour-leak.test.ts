import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { filesIn } from "../helpers/place-fixtures.js"
import { routeDesign } from "../helpers/route-check.js"

const FOLDER = join(import.meta.dirname, "..", "fixtures", "can-proof-3")
const MAIN = "can-module.circuit.tsx"
const LAYOUT = "can-module.circuit.layout.json"

/**
 * The third proof run's board with no copper and GND poured on the bottom only: the pour joins the through pads, so
 * the top parts' GND pads are open lines before any run.
 */
function bottomPourOnly(): Record<string, string> {
  const files = filesIn(FOLDER)
  const main = (files[MAIN] as string).replace('<copperpour net="GND" layer="top" />', "")
  return { ...files, [MAIN]: main, [LAYOUT]: `${(files[LAYOUT] as string).split("\n")[0]}\n` }
}

describe("a scoped run's pour rounds route only lines the run itself broke", () => {
  test('autoroute { nets: ["SCK"] } on a poured board with open GND lines writes no GND copper', () => {
    const design = buildDesign(bottomPourOnly(), MAIN)
    const openGround = design.pcb.ratsnest.filter((line) => line.net === "net.GND")
    expect(openGround.length).toBeGreaterThan(0)
    const report = routeDesign(design, { scope: { kind: "nets", nets: ["SCK"] } })
    expect(report.routed.map((route) => route.net)).toEqual(["net.SCK"])
    expect(report.edits.every((edit) => !("net" in edit) || edit.net === "net.SCK")).toBe(true)
  }, 120_000)
})
