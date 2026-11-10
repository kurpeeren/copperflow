import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"
import { buildBom } from "../../src/core/bom.js"
import { buildDesign } from "../../src/engine/design.js"
import { fabricationSet } from "../../src/engine/fab/export.js"
import { checkRoutedAll, routeDesign } from "../helpers/route-check.js"

const FOLDER = join(import.meta.dirname, "..", "fixtures", "can-module")
const CAN = "can-module.circuit.tsx"
const CREATED = new Date(Date.UTC(2026, 10, 11, 12, 0, 0))

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

describe("two pours of different nets on one layer of the CAN board", () => {
  test("routed and rebuilt, the GND and VCC fills keep the clearance everywhere: no violation, and the board exports", async () => {
    const files = filesIn(FOLDER)
    const pours = `<copperpour net="GND" layer="top" /><copperpour net="VCC" layer="top" priority={1} />`
    const withPours = { ...files, [CAN]: (files[CAN] ?? "").replace("  </board>", `    ${pours}\n  </board>`) }
    const report = routeDesign(buildDesign(withPours, CAN))
    expect(report.unrouted).toEqual([])
    const checked = checkRoutedAll(withPours, CAN, report.routed.map((route) => route.copper))
    expect(checked.after.pcb.pours.map((pour) => pour.area > 0)).toEqual([true, true])
    expect(checked.after.violations.filter((v) => v.severity === "error")).toEqual([])
    expect(checked.copper).toEqual([])
    const set = fabricationSet(checked.after, await buildBom(FOLDER, CAN, { design: checked.after }), CREATED)
    expect(set.ok ? [] : set.errors).toEqual([])
  }, 120_000)
})
