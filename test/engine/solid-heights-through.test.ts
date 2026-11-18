// The heights of the through-hole packages: axial parts (the body's diameter and a small gap), round LEDs, screw terminal
// blocks by pitch, pin sockets, and the power packages seated on their leads' shoulders.
import { describe, expect, test } from "vitest"
import { partHeight } from "../../src/engine/solid/heights.js"

const part = (footprint: string) => ({ footprint, props: {} })
const GAP = 0.3

describe("through-hole heights", () => {
  test("an axial part stands its body diameter plus a small gap", () => {
    const cases: [string, number][] = [
      ["axial3.5x7.62", 1.8 + GAP],
      ["axial6.3x10.16", 2.5 + GAP],
      ["axial9x15.24", 3.5 + GAP],
      ["axial12x20.32", 4.5 + GAP],
      ["axial15x25.4", 5.5 + GAP],
      ["axial9x15.24_d3.5", 3.5 + GAP],
      ["axial6.3x10.16_d4", 4 + GAP],
      ["do35", 2 + GAP],
      ["do41", 2.7 + GAP],
      ["do15", 3.6 + GAP],
      ["do201ad", 5.3 + GAP],
    ]
    for (const [footprint, height] of cases) {
      const found = partHeight(part(footprint))
      expect(found.height, footprint).toBeCloseTo(height, 6)
      expect(found.state, footprint).toBe("typical")
      expect(found.assumed, footprint).toBe(false)
      expect(found.source, footprint).not.toBe("")
    }
  })

  test("the other through-hole packages have a typical row", () => {
    const cases: [string, number][] = [
      ["led3mm", 5.5],
      ["led5mm", 8.7],
      ["screw2", 10],
      ["screw6_p5mm", 10],
      ["screw3_p3.5mm", 8.5],
      ["screw3_p3.81mm", 8.5],
      ["socket4", 8.5],
      ["socket2x20", 8.5],
      ["to220", 20.5],
      ["to220_2", 20.5],
      ["to220_5", 20.5],
      ["to247", 25.5],
      ["to126", 13.3],
      ["to92", 5.2],
      ["radial5.0x2", 11],
      ["radial6x2.5", 11],
      ["radial20x7.5", 35.5],
      ["radial22x10", 35.5],
      ["radial3x1.5", 7],
      ["radial6.3x2.5", 11],
      ["pinrow4_p2mm", 6],
      ["pinrow2x3_p2mm", 6],
      ["pinrow6_p1.27mm", 4.6],
    ]
    for (const [footprint, height] of cases) {
      const found = partHeight(part(footprint))
      expect(found.height, footprint).toBeCloseTo(height, 6)
      expect(found.state, footprint).toBe("typical")
      expect(found.source, footprint).not.toBe("")
    }
  })

  test("a pin row at a pitch above 2.54 mm is still an unknown part", () => {
    expect(partHeight(part("pinrow4_p5.08mm")).assumed).toBe(true)
  })

  test("a radial can of a size with no row takes the nearest listed size, and says so", () => {
    expect(partHeight(part("radial22x10")).source).toMatch(/nearest/i)
    expect(partHeight(part("radial10x5")).source).not.toMatch(/nearest/i)
  })

  test("a height the part gives wins", () => {
    expect(partHeight({ footprint: "axial6.3x10.16", props: { height: "4mm" } }).height).toBe(4)
  })

  test("the sources say where a typical figure comes from, and name no document", () => {
    for (const footprint of ["axial6.3x10.16", "do41", "led5mm", "screw2", "socket4", "to220", "to247", "to126"]) {
      expect(partHeight(part(footprint)).source, footprint).toMatch(/makers'|typical|general/i)
    }
  })
})
