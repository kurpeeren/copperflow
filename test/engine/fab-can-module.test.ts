import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { gerberFiles } from "../../src/engine/fab/layers.js"
import { checkRoutedAll, routeDesign } from "../helpers/route-check.js"
import { readGerber, type ReadGerber } from "../helpers/gerber-read.js"

const FOLDER = join(import.meta.dirname, "..", "fixtures", "can-module")
const MAIN = "can-module.circuit.tsx"
const CREATED = new Date(Date.UTC(2026, 10, 10, 12, 0, 0))

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

/** Positions as sorted "x,y" keys in whole nanometres, so the file's rounding and the model's floats compare. */
const keys = (points: readonly { x: number; y: number }[]) => points.map((p) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`).sort()

/** The pads a file holds: its flashes (apart from vias) and the middle of each region (a turned rectangle). */
function padPositions(read: ReadGerber) {
  const flashes = read.flashes.filter((f) => f.aperture.fn !== "ViaPad").map((f) => f.at)
  const regions = read.regions.map(({ points }) => {
    const corners = points.slice(0, -1)
    return { x: corners.reduce((sum, p) => sum + p.x, 0) / corners.length, y: corners.reduce((sum, p) => sum + p.y, 0) / corners.length }
  })
  return keys([...flashes, ...regions])
}

const segments = (read: ReadGerber) => read.strokes.reduce((sum, stroke) => sum + stroke.points.length - 1, 0)

describe("the CAN module's Gerbers after the router runs on it", () => {
  test("the copper parsed back holds the routed tracks, the 12 vias and every pad, and a second run is byte-identical", () => {
    const files = filesIn(FOLDER)
    const report = routeDesign(buildDesign(files, MAIN))
    expect(report.unrouted).toEqual([])
    const routed = checkRoutedAll(files, MAIN, report.routed.map((route) => route.copper)).after
    const written = gerberFiles(routed.pcb, routed.rules.fabrication, "can-module", CREATED)
    const read = new Map(written.map(({ file, text }) => [file, readGerber(text)]))
    const top = read.get("can-module-F_Cu.gtl") as ReadGerber
    const bottom = read.get("can-module-B_Cu.gbl") as ReadGerber

    expect(routed.pcb.tracks).toHaveLength(44)
    expect(top.strokes.length + bottom.strokes.length).toBe(44)
    expect(top.flashes.filter((f) => f.aperture.fn === "ViaPad")).toHaveLength(12)
    expect(bottom.flashes.filter((f) => f.aperture.fn === "ViaPad")).toHaveLength(12)
    const model = (layer: string) => routed.pcb.tracks.filter((t) => t.layer === layer)
    expect(top.strokes).toHaveLength(model("top").length)
    expect(segments(top)).toBe(model("top").reduce((sum, t) => sum + t.points.length - 1, 0))
    expect(segments(bottom)).toBe(model("bottom").reduce((sum, t) => sum + t.points.length - 1, 0))
    const pads = routed.pcb.parts.flatMap((part) => part.pads)
    expect(top.flashes.filter((f) => f.aperture.fn !== "ViaPad")).toHaveLength(pads.filter((p) => p.layers !== "bottom").length)
    expect(top.flashes.find((f) => f.aperture.fn === "ViaPad")?.at).toEqual(routed.pcb.vias[0]?.at)

    // Each layer's pads are where the model puts them: copper and mask on their side (through pads on both), paste on SMD pads only.
    const smd = (p: (typeof pads)[number]) => p.layers !== "through" && p.drill === undefined
    for (const [side, key] of [["top", "F"], ["bottom", "B"]] as const) {
      const onSide = pads.filter((p) => p.layers === side || p.layers === "through")
      const file = (layer: string, ext: string) => read.get(`can-module-${key}_${layer}.${ext}`) as ReadGerber
      const ext = side === "top" ? { Cu: "gtl", Mask: "gts", Paste: "gtp" } : { Cu: "gbl", Mask: "gbs", Paste: "gbp" }
      expect(padPositions(file("Cu", ext.Cu))).toEqual(keys(onSide))
      expect(padPositions(file("Mask", ext.Mask))).toEqual(keys(onSide))
      expect(padPositions(file("Paste", ext.Paste))).toEqual(keys(onSide.filter(smd)))
    }

    expect(gerberFiles(routed.pcb, routed.rules.fabrication, "can-module", CREATED)).toEqual(written)
  }, 60_000)
})
