import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { drillFiles } from "../../src/engine/fab/excellon.js"
import { writeGerber } from "../../src/engine/fab/gerber.js"
import { gerberLayers } from "../../src/engine/fab/layers.js"
import { readDrill } from "../helpers/drill-read.js"
import { counterClockwise, difference, pathArea, toPath, union, type Paths } from "../../src/engine/pour/clip.js"
import { readGerber } from "../helpers/gerber-read.js"

const MAIN = "main.circuit.tsx"
const CREATED = new Date(Date.UTC(2026, 10, 11, 9, 0, 0))

function circuit(pours: string): Record<string, string> {
  const body = [
    `<resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} />`,
    `<resistor name="R2" resistance="1k" footprint="0603" pcbX={5} pcbY={0} pcbRotation={45} />`,
    `<pinheader name="J1" pinCount={2} pitch="2.54mm" gender="male" pcbX={0} pcbY={-3} pcbRotation={0} />`,
    `<trace from="R1.pin1" to="net.GND" />`,
    `<trace from="R2.pin1" to="net.GND" />`,
    `<trace from="J1.pin1" to="net.GND" />`,
    `<trace from="R1.pin2" to="net.SIG" />`,
    `<trace from="R2.pin2" to="net.SIG" />`,
    `<trace from="J1.pin2" to="net.SIG" />`,
    `<hole x={-8} y={4} diameter={1.5} />`,
    `<hole x={8} y={-4} diameter={2.2} />`,
    pours,
  ].join("\n")
  return { [MAIN]: `export default () => (<board width="22mm" height="12mm">${body}</board>)` }
}

const POURS = `<copperpour net="GND" layer="top" /><copperpour net="GND" layer="bottom" thermal="solid" />`
const design = buildDesign(circuit(POURS), MAIN)
const plain = buildDesign(circuit(""), MAIN)
const layersOf = (built: typeof design) => new Map(gerberLayers(built.pcb, built.rules.fabrication).map(({ name, layer }) => [name, layer]))

/**
 * The pours' copper as read back, drawn in file order as a reader would: each dark Conductor region added, each clear
 * region removing what is under it so far. Nested pieces (an island inside a hole) count only when drawn after the hole.
 */
function pourArea(text: string): number {
  let drawn: Paths = []
  for (const region of readGerber(text).regions) {
    const path = counterClockwise(toPath(region.points.slice(0, -1)))
    if (region.polarity === "clear") drawn = difference(drawn, [path])
    else if (region.fn === "Conductor") drawn = union([...drawn, path])
  }
  return drawn.reduce((sum, path) => sum + pathArea(path), 0) / 1e6
}

const emptyLayer = { fileFunction: "", polarity: "Positive" as const, objects: [] }

describe("the pour in the Gerber files", () => {
  test("each copper layer's pour reads back as regions with its reliefs and holes cleared, within 1% of the model's area", () => {
    const layers = layersOf(design)
    const [top, bottom] = design.pcb.pours
    expect(top?.polygons.some((polygon) => polygon.holes.length > 0)).toBe(true)
    for (const [name, pour] of [["F_Cu", top], ["B_Cu", bottom]] as const) {
      const text = writeGerber(layers.get(name) ?? emptyLayer, CREATED)
      const read = readGerber(text)
      expect(read.regions.some((region) => region.polarity === "clear")).toBe(true)
      const model = pour?.area ?? 0
      expect(model).toBeGreaterThan(100)
      expect(Math.abs(pourArea(text) - model) / model).toBeLessThan(0.01)
    }
  })

  test("an island inside another pour's hole is drawn after that hole is cleared, and the area still matches", () => {
    const island = `<copperpour net="GND" layer="top" /><copperpour net="SIG" layer="top" priority={1} outline={[{ x: -7.5, y: -1.5 }, { x: -2.5, y: -1.5 }, { x: -2.5, y: 2 }, { x: -7.5, y: 2 }]} />`
    const nested = buildDesign(circuit(island), MAIN)
    const [ground, inner] = nested.pcb.pours
    expect(inner?.area).toBeGreaterThan(5)
    const text = writeGerber(layersOf(nested).get("F_Cu") ?? emptyLayer, CREATED)
    const regions = readGerber(text).regions
    const islandAt = regions.findIndex((region, i) => i > 0 && region.fn === "Conductor")
    expect(regions.slice(0, islandAt).some((region) => region.polarity === "clear")).toBe(true)
    const model = (ground?.area ?? 0) + (inner?.area ?? 0)
    expect(Math.abs(pourArea(text) - model) / model).toBeLessThan(0.01)
  })

  test("the pour comes before the pads and tracks, which are drawn dark after it", () => {
    const text = writeGerber(layersOf(design).get("F_Cu") ?? emptyLayer, CREATED)
    const lastClear = text.lastIndexOf("%LPC*%")
    const firstFlash = text.search(/D03\*/)
    expect(lastClear).toBeGreaterThan(0)
    expect(firstFlash).toBeGreaterThan(lastClear)
    expect(text.slice(lastClear).indexOf("%LPD*%")).toBeGreaterThan(0)
  })

  test("the mask and paste ignore the pour", () => {
    const [withPour, without] = [layersOf(design), layersOf(plain)]
    for (const name of ["F_Mask", "B_Mask", "F_Paste", "B_Paste"] as const) expect(withPour.get(name)).toEqual(without.get(name))
  })

  test("a board without pours writes no clear polarity", () => {
    const text = writeGerber(layersOf(plain).get("F_Cu") ?? emptyLayer, CREATED)
    expect(text).not.toContain("%LPC*%")
  })
})

describe("the holes in the drill files", () => {
  test("non-plated holes go to -NPTH.drl as mechanical drills, one tool per diameter; the plated file is unchanged", () => {
    const files = new Map(drillFiles(design.pcb, "b", CREATED).map(({ file, text }) => [file, readDrill(text)]))
    const npth = files.get("b-NPTH.drl")
    expect([...(npth?.tools.values() ?? [])]).toEqual([1.5, 2.2])
    expect(npth?.holes.map((hole) => hole.at)).toEqual([
      { x: -8, y: 4 },
      { x: 8, y: -4 },
    ])
    expect(npth?.comments).toContain("#@! TA.AperFunction,NonPlated,NPTH,MechanicalDrill")
    const platedText = (built: typeof design) => drillFiles(built.pcb, "b", CREATED)[0]?.text
    expect(platedText(design)).toBe(platedText(plain))
  })
})
