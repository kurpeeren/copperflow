// The heights of the surface-mount packages that stood at an assumed 1 mm: every one has a row, none claims a document.
import { describe, expect, test } from "vitest"
import { parseFootprint } from "../../src/engine/footprints/parse.js"
import { HEIGHT_TABLE, partHeight } from "../../src/engine/solid/heights.js"
import { SMD_ROWS } from "../../src/engine/solid/heights-smd.js"

const part = (footprint: string, props: Record<string, unknown> = {}) => ({ footprint, props })

const HEIGHTS: [string, number][] = [
  ["01005", 0.2],
  ["2220", 3.2],
  ["sod523", 0.7],
  ["sod923", 0.4],
  ["sod123f", 1.1],
  ["sod128", 1.1],
  ["minimelf", 1.6],
  ["sod80", 1.6],
  ["do213aa", 1.6],
  ["melf", 2.6],
  ["do213ab", 2.6],
  ["sot323", 1.1],
  ["sot353", 1.1],
  ["sot363", 1.1],
  ["sc70", 1.1],
  ["sc70_5", 1.1],
  ["sc70_6", 1.1],
  ["sot523", 0.8],
  ["sot563", 0.6],
  ["sot723", 0.55],
  ["sot143", 1.1],
  ["sot23_8", 1.45],
  ["msop8", 1.1],
  ["msop10", 1.1],
  ["qsop16", 1.75],
  ["qsop20", 1.75],
  ["qsop24", 1.75],
  ["qsop28", 1.75],
  ["smdip4", 4.5],
  ["smdip6", 4.5],
  ["smdip8", 4.5],
  ["smdip16", 4.5],
  ["msop8_ep1.6x1.8", 1.1],
  ["dpak", 2.4],
  ["to252", 2.4],
  ["d2pak", 4.8],
  ["to263", 4.8],
  ["d2pak_5", 4.8],
  ["d2pak_7", 4.8],
  ["tant_a", 1.8],
  ["tant_b", 2.1],
  ["tant_c", 2.8],
  ["tant_d", 3.1],
  ["tant_e", 4.3],
  ["tant3216", 1.8],
  ["tant3528", 2.1],
  ["tant6032", 2.8],
  ["tant7343", 3.1],
  ["array4x0603", 0.5],
  ["array4x0402", 0.35],
  ["array2x0402", 0.35],
  ["xtal2016", 0.5],
  ["xtal2520", 0.6],
  ["xtal3225", 0.8],
  ["xtal5032", 1.2],
  ["xtal7050", 1.4],
  ["xtal5032_2", 1.2],
  ["xtal3215", 0.9],
  ["hc49smd", 4.5],
  ["led3528", 1.9],
  ["led5050", 1.6],
  ["led5050_6", 1.6],
  ["plcc20", 4.57],
  ["plcc28", 4.57],
  ["plcc44", 4.57],
  ["plcc52", 4.57],
  ["plcc68", 4.57],
  ["plcc84", 4.57],
  ["plcc32", 3.55],
]

describe("heights of the surface-mount packages", () => {
  test("every package has a height, none assumed, none claiming a document", () => {
    for (const [footprint, height] of HEIGHTS) {
      const found = partHeight(part(footprint))
      expect(found.height, footprint).toBe(height)
      expect(found.assumed, footprint).toBe(false)
      expect(found.state, footprint).toBe("typical")
      expect(found.source.length, footprint).toBeGreaterThan(20)
    }
  })

  test("the exposed-pad duals keep the height of their package", () => {
    expect(partHeight(part("soic8_ep2.4x3.1")).height).toBe(1.75)
    expect(partHeight(part("tssop20_ep3x4.2")).height).toBe(1.2)
  })

  test("the can height is read from the string", () => {
    for (const [footprint, height] of [["smdcan4x5.4", 5.4], ["smdcan5x5.4", 5.4], ["smdcan6.3x5.4", 5.4], ["smdcan6.3x7.7", 7.7], ["smdcan8x6.5", 6.5], ["smdcan8x10.2", 10.2], ["smdcan10x10.2", 10.2]] as const) {
      const found = partHeight(part(footprint))
      expect(found.height, footprint).toBe(height)
      expect(found.state, footprint).toBe("typical")
      expect(found.source, footprint).toContain("footprint name")
    }
    // A height the part gives still wins.
    expect(partHeight(part("smdcan8x10.2", { height: "9mm" }))).toMatchObject({ height: 9, state: "given" })
  })

  test("a flat-lead diode is lower than the gull-wing one of the same family, and sod123 is unchanged", () => {
    expect(partHeight(part("sod123f")).height).toBeLessThan(partHeight(part("sod123")).height)
    expect(partHeight(part("sod123")).height).toBe(1.35)
    expect(partHeight(part("sod323")).height).toBe(1.1)
    expect(partHeight(part("sod323f")).height).toBe(1.1)
  })

  test("a tantalum case is as high as its name says, and the name is the string's case", () => {
    expect(partHeight(part("tant3216")).height).toBe(1.8)
    expect(partHeight(part("tant_a")).source).toContain("tenths of a mm")
  })

  test("none of the rows names a document, each has its own name and source, and a string sees one row first", () => {
    for (const row of SMD_ROWS) {
      expect(row.document, row.packages).toBeUndefined()
      expect(row.packages.length, row.packages).toBeGreaterThan(3)
      expect(row.source.length, row.packages).toBeGreaterThan(20)
      expect(HEIGHT_TABLE.includes(row), row.packages).toBe(true)
    }
    for (const [footprint] of HEIGHTS) {
      const parsed = parseFootprint(footprint)!
      expect(SMD_ROWS.filter((row) => row.matches(parsed)).length, footprint).toBeLessThanOrEqual(1)
    }
  })

  test("a footprint of another package the rows must not take stays assumed or as it was", () => {
    expect(partHeight(part("sot23")).height).toBe(1.12)
    expect(partHeight(part("0402")).height).toBe(0.55)
    expect(partHeight(part("tant_z")).assumed).toBe(true)
  })
})
