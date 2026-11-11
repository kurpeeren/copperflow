// Library → New part…: the dialog's pure logic (rows, paste, the request) and the footprint preview drawn from the generator.
import { describe, expect, test } from "vitest"
import { generateFootprint } from "../src/engine/footprints/index.js"
import { unknownFootprint } from "../src/engine/footprints/known.js"
import {
  createdSummary,
  EMPTY_FIELDS,
  readCreateRequest,
  withoutPin,
  withPasted,
  withPin,
  withPinChanged,
  type CreatePartResult,
  type NewPartFields,
} from "../studio/src/shell/new-part-form.js"
import { footprintPreview } from "../studio/src/shell/footprint-preview.js"
import { originLabel } from "../studio/src/shell/import-part-form.js"

const FILLED: NewPartFields = {
  ...EMPTY_FIELDS,
  id: " X16M ",
  title: "16 MHz crystal",
  mpn: "ABLS-16.000MHZ-B4-T",
  packageText: "hc49s",
  pins: [
    { number: "1", name: "XTAL1", type: "passive", description: "" },
    { number: "2", name: "XTAL2", type: "passive", description: "" },
  ],
  suppliers: [
    { supplier: "LCSC", number: "C16212" },
    { supplier: "", number: "" },
  ],
  datasheet: "https://abracon.com/abls.pdf",
}

describe("New part dialog: the pin rows", () => {
  test("a new row takes the next number; rows change and go without touching the others", () => {
    const one = withPin([])
    expect(one).toEqual([{ number: "1", name: "", type: "passive", description: "" }])
    const two = withPin(withPinChanged(one, 0, { name: "VDD", type: "power_in" }))
    expect(two.map((pin) => [pin.number, pin.name, pin.type])).toEqual([
      ["1", "VDD", "power_in"],
      ["2", "", "passive"],
    ])
    expect(one[0]?.name).toBe("")
    expect(withoutPin(two, 0).map((pin) => pin.number)).toEqual(["2"])
  })

  test("a paste adds its pins, replaces rows with the same number, drops empty rows and keeps the errors per line", () => {
    const rows = [
      { number: "1", name: "OLD", type: "passive" as const, description: "" },
      { number: "", name: "", type: "passive" as const, description: "" },
    ]
    const pasted = withPasted(rows, "Pin\tName\tType\n1\tVDD\tpower_in\n3\tSDA\tI/O\n2\tGND\tground\tGround")
    expect(pasted.pins).toEqual([
      { number: "1", name: "VDD", type: "power_in", description: "" },
      { number: "2", name: "GND", type: "ground", description: "Ground" },
    ])
    expect(pasted.errors.map((error) => error.line)).toEqual([3])
    expect(pasted.errors[0]?.message).toContain('"I/O" is not a pin type')
  })
})

describe("New part dialog: the request", () => {
  test("reads the fields into the route's request: trimmed, blank supplier rows dropped, the key in lower case", () => {
    expect(readCreateRequest(FILLED)).toEqual({
      id: "X16M",
      title: "16 MHz crystal",
      mpn: "ABLS-16.000MHZ-B4-T",
      package: "hc49s",
      pins: [
        { number: "1", name: "XTAL1", type: "passive" },
        { number: "2", name: "XTAL2", type: "passive" },
      ],
      suppliers: { lcsc: "C16212" },
      datasheet: { url: "https://abracon.com/abls.pdf" },
      replace: false,
    })
  })

  test("a footprint file asks for no string; the request names the file", () => {
    const request = readCreateRequest({ ...FILLED, packageKind: "file", packageText: "" })
    expect(request).toMatchObject({ package: { file: "footprint.yaml" } })
  })

  test("says everything that is wrong at once", () => {
    const wrong = readCreateRequest({
      ...EMPTY_FIELDS,
      id: "9x",
      packageText: "qfn5",
      pins: [
        { number: "1", name: "A", type: "passive", description: "" },
        { number: "1", name: "+B", type: "passive", description: "" },
        { number: "x", name: "C", type: "passive", description: "" },
      ],
      suppliers: [{ supplier: "Mouser Electronics", number: "" }],
      datasheet: "ftp://x",
    })
    expect(wrong).toEqual({
      problems: [
        '"9x" is not a part id: start with a letter, end with a letter or digit, and use letters, digits, ".", "_" or "-".',
        "Give the part a title.",
        unknownFootprint("qfn5"),
        "Pin row 2: pin 1 is already in row 1.",
        'Pin row 2: "+B" is not a pin name; use letters, digits and _, starting with a letter (e.g. _B).',
        'Pin row 3: "x" is not a pin number; pins are numbered 1, 2, 3 ….',
        'Supplier "Mouser Electronics": name it with lower-case letters, digits and _ (e.g. mouser) and give its part number.',
        "The datasheet link must start with http:// or https://.",
      ],
    })
    expect(readCreateRequest({ ...FILLED, pins: [] })).toEqual({ problems: ["Add the pins: type them in the rows or paste the datasheet's pin table."] })
    expect(readCreateRequest({ ...FILLED, packageText: " " })).toEqual({ problems: ["Type a footprint string such as soic8, or choose a footprint file."] })
  })

  test("the result's summary", () => {
    const result: CreatePartResult = { id: "X16M", title: "16 MHz crystal", pins: 2, footprint: "hc49s", files: [], notes: [], verification: "parts/X16M/verification.md", checklist: "" }
    expect(createdSummary(result)).toBe("Created X16M: 16 MHz crystal, 2 pins, footprint hc49s. Not verified: check it in parts/X16M/verification.md.")
  })

  test("the Library shows a written part's origin", () => {
    expect(originLabel("written 2026-11-11")).toBe("Written on 2026-11-11")
  })
})

describe("New part dialog: the footprint preview", () => {
  const SIZE = { width: 200, height: 140 }

  test("the pads are the generator's, in the same order, placed and scaled into the canvas with y down", () => {
    const generated = generateFootprint("soic8")
    if ("error" in generated) throw new Error(generated.error)
    const preview = footprintPreview("soic8", SIZE)
    if ("error" in preview) throw new Error(preview.error)
    expect(preview.pads.map((pad) => pad.number)).toEqual(generated.pads.map((pad) => pad.number))
    const [first, last] = [generated.pads[0]!, generated.pads[7]!]
    const [a, b] = [preview.pads[0]!, preview.pads[7]!]
    expect(b.x - a.x).toBeCloseTo((last.x - first.x) * preview.scale, 6)
    expect(b.y - a.y).toBeCloseTo(-(last.y - first.y) * preview.scale, 6)
    expect(a.width).toBeCloseTo(first.width * preview.scale, 6)
    for (const pad of preview.pads) {
      expect(pad.x).toBeGreaterThan(0)
      expect(pad.x).toBeLessThan(SIZE.width)
      expect(pad.y).toBeGreaterThan(0)
      expect(pad.y).toBeLessThan(SIZE.height)
    }
    expect(preview.courtyard.length).toBeGreaterThan(2)
    const xs = generated.courtyard.map((p) => p.x)
    const ys = generated.courtyard.map((p) => p.y)
    const span = (values: number[]) => Number((Math.max(...values) - Math.min(...values)).toFixed(2))
    expect(preview.summary).toBe(`8 pads, courtyard ${span(xs)} × ${span(ys)} mm`)
  })

  test("through pads keep their drill; a footprint copperflow cannot make is an error, an empty string asks for one", () => {
    const preview = footprintPreview("hc49s", SIZE)
    if ("error" in preview) throw new Error(preview.error)
    expect(preview.pads.map((pad) => pad.through)).toEqual([true, true])
    expect(preview.pads[0]?.drill).toBeGreaterThan(0)
    expect(footprintPreview("qfn5_9x9", SIZE)).toEqual({ error: 'copperflow cannot make footprint "qfn5_9x9": a QFN named by its body needs its pitch, such as _p0.5' })
    expect(footprintPreview("  ", SIZE)).toEqual({ error: "Type a footprint string such as soic8, qfn32_5x5_p0.5 or hc49s." })
  })
})
