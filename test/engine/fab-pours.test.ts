import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { drillFiles } from "../../src/engine/fab/excellon.js"
import { writeGerber } from "../../src/engine/fab/gerber.js"
import { gerberLayers } from "../../src/engine/fab/layers.js"
import { readDrill } from "../helpers/drill-read.js"
import { readGerber, type Point } from "../helpers/gerber-read.js"

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

/** The shoelace area of a closed contour, its closing corner repeated, in mm². */
function area(points: readonly Point[]): number {
  return Math.abs(points.slice(1).reduce((sum, p, i) => sum + ((points[i] as Point).x * p.y - p.x * (points[i] as Point).y), 0)) / 2
}

/** The pour's copper as read back: its dark regions less its clear ones. */
function pourArea(text: string): number {
  const regions = readGerber(text).regions.filter((region) => region.fn === "Conductor" || region.polarity === "clear")
  return regions.reduce((sum, region) => sum + (region.polarity === "clear" ? -area(region.points) : area(region.points)), 0)
}

describe("the pour in the Gerber files", () => {
  test("each copper layer's pour reads back as regions with its reliefs and holes cleared, within 1% of the model's area", () => {
    const layers = layersOf(design)
    const [top, bottom] = design.pcb.pours
    expect(top?.polygons.some((polygon) => polygon.holes.length > 0)).toBe(true)
    for (const [name, pour] of [["F_Cu", top], ["B_Cu", bottom]] as const) {
      const text = writeGerber(layers.get(name) ?? { fileFunction: "", polarity: "Positive", objects: [] }, CREATED)
      const read = readGerber(text)
      expect(read.regions.some((region) => region.polarity === "clear")).toBe(true)
      const model = pour?.area ?? 0
      expect(model).toBeGreaterThan(100)
      expect(Math.abs(pourArea(text) - model) / model).toBeLessThan(0.01)
    }
  })

  test("the pour comes before the pads and tracks, which are drawn dark after it", () => {
    const text = writeGerber(layersOf(design).get("F_Cu") ?? { fileFunction: "", polarity: "Positive", objects: [] }, CREATED)
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
    const text = writeGerber(layersOf(plain).get("F_Cu") ?? { fileFunction: "", polarity: "Positive", objects: [] }, CREATED)
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
