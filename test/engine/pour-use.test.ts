import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { formatCopperSummary } from "../../src/mcp/copper-summary.js"

const FOLDER = join(import.meta.dirname, "..", "fixtures", "can-module")
const CAN = "can-module.circuit.tsx"

function filesIn(folder: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else files[relative(FOLDER, path).split("\\").join("/")] = readFileSync(path, "utf8")
    }
  }
  walk(folder)
  return files
}

const canWith = (extra: string) => {
  const files = filesIn(FOLDER)
  return { ...files, [CAN]: (files[CAN] ?? "").replace("  </board>", `    ${extra}\n  </board>`) }
}
const pourFindings = (extra: string) =>
  buildDesign(canWith(extra), CAN)
    .violations.filter((v) => v.code.startsWith("pour"))
    .map((v) => [v.code, v.severity, v.message])

describe("what a pour joins, on the CAN board whose parts sit on top", () => {
  test("a bottom-only GND pour joins only the connector's through pad: pour-sparse names the count", () => {
    expect(pourFindings(`<copperpour net="GND" layer="bottom" />`)).toEqual([
      ["pour-sparse", "warning", "copperpour:1 joins only 1 of 8 GND pads; a pour joins the pads on its own layer and through pads, so put one on the layer the parts sit on"],
    ])
  })

  test("a GND pour on top joins most of them, alone or with the bottom one: no warning", () => {
    expect(pourFindings(`<copperpour net="GND" layer="top" />`)).toEqual([])
    expect(pourFindings(`<copperpour net="GND" layer="top" /><copperpour net="GND" layer="bottom" />`)).toEqual([])
  })

  test("a pour that joins no pad of its net is pour-floating", () => {
    expect(pourFindings(`<copperpour net="RESET" layer="bottom" />`)).toEqual([["pour-floating", "warning", "copperpour:1 joins no pad of RESET"]])
  })

  test("a pour whose every piece is cut off from its net has no copper, and pour-empty says so", () => {
    const outline = `outline={[{x:-1,y:-1},{x:1,y:-1},{x:1,y:1},{x:-1,y:1}]}`
    expect(pourFindings(`<copperpour net="GND" layer="bottom" ${outline} />`)).toEqual([
      ["pour-empty", "warning", "copperpour:1 has no copper: what is left of its area once other copper, keepouts and holes are kept clear of touches no GND copper"],
    ])
  })

  test("a second whole-board pour of another net at equal priority has no copper: pour-empty says which pour took it, and copper_summary shows 0 mm²", () => {
    const extra = `<copperpour net="GND" layer="bottom" /><copperpour net="VCC" layer="bottom" />`
    expect(pourFindings(extra).filter(([code]) => code === "pour-empty")).toEqual([["pour-empty", "warning", "copperpour:2 has no copper: copperpour:1 took its area"]])
    const summary = formatCopperSummary(CAN, buildDesign(canWith(extra), CAN))
    expect(summary).toMatch(/^copperpour:2 VCC bottom: 0\.00 mm², joins 0 pads$/m)
    expect(summary).toMatch(/pour-empty 1/)
  })
})
