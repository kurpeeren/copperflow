// The Verify screen's figures: what a land pattern drawing gives, read from the pads the build uses, only the ones
// that mean something for the arrangement; and the measure between two pads.
import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { footprintFromFile } from "../src/engine/footprints/file.js"
import { generateFootprint } from "../src/engine/footprints/index.js"
import type { Footprint } from "../src/engine/footprints/types.js"
import { landPatternFigures, mm, padNumbers } from "../studio/src/shell/verify-figures.js"
import { measurePads, measureText, padInfo, padsInOrder } from "../studio/src/shell/verify-measure.js"

function generated(name: string): Footprint {
  const footprint = generateFootprint(name)
  if ("error" in footprint) throw new Error(footprint.error)
  return footprint
}

function fromFile(path: string): Footprint {
  const footprint = footprintFromFile("parts/X/footprint.yaml", readFileSync(path, "utf8"))
  if ("error" in footprint) throw new Error(footprint.error)
  return footprint
}

const figures = (footprint: Footprint) => Object.fromEntries(landPatternFigures(footprint.pads).map((figure) => [figure.label, figure.value]))

describe("land pattern figures", () => {
  test("a two-pad chip: centre to centre, the gap and the span, no pitch", () => {
    expect(figures(generated("0402"))).toEqual({
      Pads: "2",
      "Pad width × height": "0.64 × 0.6 mm",
      "Pads centre to centre": "0.86 mm",
      "Gap between the pads": "0.22 mm",
      "Span outside the pads": "1.5 mm",
    })
  })

  test("sot23: two rows, the pitch along the row of two", () => {
    expect(figures(generated("sot23"))).toEqual({
      Pads: "3",
      "Pad width × height": "0.6 × 0.95 mm",
      "Pitch along": "1.9 mm",
      "Rows centre to centre": "2.25 mm",
      "Span outside the pads": "3.2 mm",
    })
  })

  test("soic18w: the pitch, the rows and the span outside", () => {
    expect(figures(generated("soic18w"))).toEqual({
      Pads: "18",
      "Pad width × height": "1.675 × 0.6 mm",
      "Pitch along": "1.27 mm",
      "Rows centre to centre": "9.675 mm",
      "Span outside the pads": "11.35 mm",
    })
  })

  test("a pin header: one row, its drill and annular ring", () => {
    expect(figures(generated("pinrow4_p2.54mm"))).toEqual({
      Pads: "4",
      "Pad width × height": "1.7 × 1.7 mm",
      "Pitch along": "2.54 mm",
      "Span outside the pads": "9.32 mm",
      Drill: "1 mm",
      "Annular ring": "0.35 mm",
    })
  })

  test("a quad package: pads of two sizes listed by size with their numbers, rows both ways", () => {
    expect(figures(generated("qfn16_3x3_p0.5"))).toEqual({
      Pads: "16",
      "Pad width × height, pads 1–4, 9–12": "0.875 × 0.25 mm",
      "Pad width × height, pads 5–8, 13–16": "0.25 × 0.875 mm",
      "Pitch along": "0.5 mm",
      "Rows centre to centre": "2.875 × 2.875 mm",
      "Span outside the pads": "3.75 × 3.75 mm",
    })
  })

  test("a footprint.yaml from the examples: sizes by pad, the slot drill and the span both ways", () => {
    expect(figures(fromFile("examples/usb-c-ldo/parts/TYPE-C-6P/footprint.yaml"))).toEqual({
      Pads: "10",
      "Pad width × height, pads 1, 2, 5, 6": "0.8 × 1 mm",
      "Pad width × height, pads 3, 4": "0.7 × 1 mm",
      "Pad width × height, pad 7": "1 × 1.8 mm",
      "Pitch along": "1, 1.2 mm",
      "Span outside the pads": "9.64 × 5.6 mm",
      Drill: "0.6 × 1.4 mm (slot)",
      "Annular ring": "0.2 mm",
    })
  })

  test("a placeholder's pads give their figures too; the screen says why it cannot be verified", () => {
    const text = 'placeholder: true\npads:\n  - { number: "1", shape: rect, x: -1, y: 0, width: 1, height: 1 }\n  - { number: "2", shape: rect, x: 1, y: 0, width: 1, height: 1 }\n'
    const footprint = footprintFromFile("parts/X/footprint.yaml", text)
    if ("error" in footprint) throw new Error(footprint.error)
    expect(footprint.placeholder).toBe(true)
    expect(figures(footprint)["Pads centre to centre"]).toBe("2 mm")
  })

  test("three decimals at most, and pad numbers in runs", () => {
    expect(mm(1.23456)).toBe("1.235")
    expect(mm(0.1 + 0.2)).toBe("0.3")
    expect(mm(-0)).toBe("0")
    expect(padNumbers(["3", "1", "2", "7", "9", "10", "11"])).toBe("1–3, 7, 9–11")
  })
})

describe("the measure", () => {
  test("two pads of a chip: centre to centre and the gap between their nearest edges", () => {
    const [a, b] = generated("0402").pads
    if (!a || !b) throw new Error("no pads")
    expect(measurePads(a, b)).toEqual({ dx: 0.86, dy: 0, straight: 0.86, gap: 0.22 })
    expect(measureText(a, b)).toBe("Pad 1 to pad 2: dx 0.86 mm, dy 0 mm, straight 0.86 mm, gap 0.22 mm")
  })

  test("round pads measure the gap round, and a pad is described with its pin", () => {
    const pads = generated("pinrow4_p2.54mm").pads
    expect(measurePads(pads[1]!, pads[2]!)).toEqual({ dx: 2.54, dy: 0, straight: 2.54, gap: 0.84 })
    expect(padInfo(pads[0]!, "VCC")).toBe("Pad 1, VCC: x -3.81 mm, y 0 mm, 1.7 × 1.7 mm, drill 1 mm")
    expect(padInfo(generated("sot23").pads[0]!, undefined)).toBe("Pad 1: x -0.95 mm, y -1.125 mm, 0.6 × 0.95 mm")
  })

  test("pads are focused in pad-number order", () => {
    const shuffled = [...generated("soic18w").pads].reverse()
    expect(padsInOrder(shuffled).map((pad) => pad.number).slice(0, 3)).toEqual(["1", "2", "3"])
  })
})
