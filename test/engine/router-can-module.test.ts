import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { cleanup } from "../../src/engine/router/cleanup.js"
import { checkRouted, checkRoutedAll, routeDesign, routeIn } from "../helpers/route-check.js"

const FOLDER = join(import.meta.dirname, "..", "fixtures", "can-module")
const MAIN = "can-module.circuit.tsx"

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

describe("the CAN module board", () => {
  const files = filesIn(FOLDER)
  const design = buildDesign(files, MAIN)

  test("builds with its two library parts and has connections to route", () => {
    expect(design.circuit.components.map((c) => c.id)).toContain("U1")
    expect(design.pcb.parts.find((part) => part.component === "U1")?.pads).toHaveLength(18)
    expect(design.pcb.ratsnest.length).toBeGreaterThan(10)
  })

  test("one connection routes and passes every check", () => {
    const line = design.pcb.ratsnest.find((l) => l.net === "net.TXCAN")
    expect(line).toBeDefined()
    if (line === undefined) return
    const result = routeIn(design, line.from, line.to)
    if (!result.routed) throw new Error(result.reason)
    const checked = checkRouted(files, MAIN, result.copper)
    expect(checked.copper).toEqual([])
    expect(checked.added).toEqual([])
    expect(checked.after.pcb.ratsnest.filter((l) => l.net === "net.TXCAN")).toEqual([])
    expect(checked.after.pcb.ratsnest).toHaveLength(design.pcb.ratsnest.length - 1)
  })
})

describe("the CAN module board, routed whole", () => {
  const files = filesIn(FOLDER)
  const design = buildDesign(files, MAIN)

  test("every connection routes, the board passes every copper check with no ratsnest left, and a second run is the same", () => {
    const report = routeDesign(design)
    expect(report.unrouted).toEqual([])
    expect(report.routed).toHaveLength(design.pcb.ratsnest.length)
    const checked = checkRoutedAll(files, MAIN, report.routed.map((route) => route.copper))
    expect(checked.copper).toEqual([])
    expect(checked.added).toEqual([])
    expect(checked.after.pcb.ratsnest).toEqual([])
    expect({ ...routeDesign(design), ms: 0 }).toEqual({ ...report, ms: 0 })
    expect(cleanup({ layout: design.pcb, rules: design.rules, nets: design.circuit.nets }, report.routed)).toEqual(report.routed)
    expect(report.edits).toHaveLength(report.routed.reduce((sum, route) => sum + route.copper.tracks.length + route.copper.vias.length, 0))
  }, 30_000)
})
