// File → Import a drawing (SVG or DXF)…: the dialog's state as plain data: the file read, its size and what was left
// out, the layer list, the width with the height kept to the drawing's shape, which fields show, and what Import sends.
import { describe, expect, test } from "vitest"
import {
  afterImport,
  graphicImportRequest,
  cachedPreview,
  fieldProblems,
  latestOnly,
  graphicNetChoices,
  showsNet,
  graphicLayerChoices,
  graphicPreview,
  keptHeight,
  readPickedDrawing,
  showsFill,
  sizeLine,
  skippedLine,
  startForm,
  type PickedDrawing,
} from "../studio/src/shell/graphic-import-form.js"

const FILLED = `<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm" viewBox="0 0 20 10"><path d="M0 0 H20 V10 H0 Z" fill="black"/></svg>`
const OUTLINE = `<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm" viewBox="0 0 20 10"><rect x="0" y="0" width="20" height="10" fill="none" stroke="black" stroke-width="0.5"/><text x="1" y="5">A</text></svg>`

const picked = (name: string, text: string): PickedDrawing => {
  const read = readPickedDrawing(name, text)
  if ("message" in read) throw new Error(read.message)
  return read
}

describe("choosing the file", () => {
  test("an SVG is read into shapes, with its size and what the reader left out", () => {
    const logo = picked("logo.svg", OUTLINE)
    expect(sizeLine(logo.shapes)).toBe("20 × 10 mm")
    expect(skippedLine(logo.shapes)).toMatch(/^Left out: .*text/)
    expect(skippedLine(picked("box.svg", FILLED).shapes)).toBeUndefined()
    const white = picked("white.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="8mm" height="4mm" viewBox="0 0 8 4"><rect width="8" height="4" fill="white"/></svg>`)
    expect(skippedLine(white.shapes)).toBe("No dark shape, so the light shapes are drawn as ink.")
  })

  test("a file that is not a drawing, or one the reader refuses, is told in plain words", () => {
    expect(readPickedDrawing("logo.png", "x")).toEqual({ message: "Choose an SVG or DXF file" })
    expect(readPickedDrawing("big.svg", FILLED, 2_000_000)).toEqual({ message: "big.svg is larger than 1 MB; put it in the project and import it with copperflow graphic" })
    expect(readPickedDrawing("bad.svg", "not a drawing")).toHaveProperty("message")
    expect(readPickedDrawing("empty.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="5mm" height="5mm"></svg>`)).toHaveProperty("message")
  })

  test("the form starts on the top silkscreen at the drawing's own width, named after the file", () => {
    expect(startForm(picked("logo.svg", FILLED))).toEqual({ layer: "top-silkscreen", width: "20", fill: false, name: "logo", net: "" })
  })
})

describe("the fields", () => {
  test("the layer list says what each layer does; the inner layers only on a 4-layer board", () => {
    const two = graphicLayerChoices(2)
    expect(two.map((one) => one.id)).toEqual(["top-silkscreen", "bottom-silkscreen", "top-mask", "bottom-mask", "top", "bottom"])
    expect(two[0]?.label).toBe("Top silkscreen: ink")
    expect(two[2]?.label).toBe("Top solder mask: an opening")
    expect(two[4]?.label).toBe("Top copper")
    expect(graphicLayerChoices(4).map((one) => one.id).slice(-2)).toEqual(["inner1", "inner2"])
    expect(graphicLayerChoices(4).at(-1)?.label).toBe("Inner copper 2")
  })

  test("the height follows the width, keeping the drawing's shape", () => {
    const shapes = picked("logo.svg", FILLED).shapes
    expect(keptHeight(shapes, "20")).toBe("10")
    expect(keptHeight(shapes, "7")).toBe("3.5")
    expect(keptHeight(shapes, "wide")).toBeUndefined()
  })

  test("Fill closed outlines shows only for a drawing with closed lines", () => {
    expect(showsFill(picked("logo.svg", OUTLINE).shapes)).toBe(true)
    expect(showsFill(picked("box.svg", FILLED).shapes)).toBe(false)
  })

  test("the preview is the shapes in a small box, y turned down", () => {
    const preview = graphicPreview(picked("box.svg", FILLED).shapes, 100)
    expect(preview.width).toBe(100)
    expect(preview.height).toBe(50)
    expect(preview.fills).toHaveLength(1)
    expect(preview.fills[0]).toMatch(/^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+)+ Z$/)
    expect(graphicPreview(picked("logo.svg", OUTLINE).shapes, 100).strokes).toHaveLength(1)
  })
})

describe("Import", () => {
  test("sends the file, the layer, the width, the fill when offered and the name", () => {
    const logo = picked("logo.svg", OUTLINE)
    const form = { ...startForm(logo), layer: "bottom-mask" as const, width: "12.5", fill: true, name: "Badge" }
    expect(graphicImportRequest(logo, form)).toEqual({ name: "logo.svg", text: OUTLINE, layer: "bottom-mask", width: 12.5, fill: true, title: "Badge" })
  })

  test("leaves out a fill the drawing does not offer and an empty name", () => {
    const box = picked("box.svg", FILLED)
    expect(graphicImportRequest(box, { ...startForm(box), fill: true, name: "  " })).toEqual({ name: "box.svg", text: FILLED, layer: "top-silkscreen", width: 20 })
  })

  test("a refusal from the server stays in the dialog, which closes only when the drawing was placed", () => {
    expect(afterImport({ ok: true })).toEqual({ close: true })
    expect(afterImport({ ok: false, refusal: "The board has no inner1 layer" })).toEqual({ close: false, problem: "The board has no inner1 layer" })
    expect(afterImport({ ok: false })).toEqual({ close: false, problem: "The drawing was not imported; see the status line" })
  })

  test("a width that is not a number of mm is refused with the reason", () => {
    const box = picked("box.svg", FILLED)
    expect(graphicImportRequest(box, { ...startForm(box), width: "0" })).toEqual({ message: "The width must be a number of mm above 0" })
    expect(graphicImportRequest(box, { ...startForm(box), width: "" })).toEqual({ message: "The width must be a number of mm above 0" })
  })
})

describe("the net of a drawing on copper", () => {
  const box = (): PickedDrawing => {
    const read = readPickedDrawing("box.svg", FILLED)
    if ("message" in read) throw new Error(read.message)
    return read
  }

  test("the field shows for copper layers only", () => {
    for (const layer of ["top", "bottom", "inner1", "inner2"] as const) expect([layer, showsNet(layer)]).toEqual([layer, true])
    for (const layer of ["top-silkscreen", "bottom-silkscreen", "top-mask", "bottom-mask"] as const) expect([layer, showsNet(layer)]).toEqual([layer, false])
  })

  test("No net comes first, then the circuit's nets by first name", () => {
    expect(graphicNetChoices([{ names: ["GND", "0V"] }, { names: [] }, { names: ["VCC"] }])).toEqual([
      { value: "", label: "No net" },
      { value: "GND", label: "GND" },
      { value: "VCC", label: "VCC" },
    ])
  })

  test("the request sends the net on copper when one is chosen, and none otherwise", () => {
    const picked = box()
    const form = { ...startForm(picked), layer: "top" as const }
    expect(graphicImportRequest(picked, { ...form, net: "GND" })).toMatchObject({ layer: "top", net: "GND" })
    expect(graphicImportRequest(picked, { ...form, net: "" })).not.toHaveProperty("net")
    expect(startForm(picked).net).toBe("")
  })

  test("switching the layer back to silkscreen drops the net from the request", () => {
    const picked = box()
    const request = graphicImportRequest(picked, { ...startForm(picked), layer: "top-silkscreen", net: "GND" })
    expect(request).not.toHaveProperty("net")
  })
})

describe("review fixes", () => {
  const box = (): PickedDrawing => {
    const read = readPickedDrawing("box.svg", FILLED)
    if ("message" in read) throw new Error(read.message)
    return read
  }

  test("the preview is built once per drawing", () => {
    const shapes = box().shapes
    expect(cachedPreview(shapes, 100)).toBe(cachedPreview(shapes, 100))
  })

  test("a bad width or a too long name is told under its own field; nothing while valid", () => {
    const picked = box()
    expect(fieldProblems(picked, startForm(picked))).toEqual({})
    expect(fieldProblems(picked, { ...startForm(picked), width: "" })).toEqual({ width: "The width must be a number of mm above 0" })
    expect(fieldProblems(picked, { ...startForm(picked), name: "x".repeat(101) })).toEqual({ name: "The name must be at most 100 characters" })
  })

  test("the size is checked before the file is read", () => {
    expect(readPickedDrawing("big.svg", "", 2_000_000)).toHaveProperty("message")
  })

  test("of two reads only the latest one counts", () => {
    const reads = latestOnly()
    const a = reads.next()
    const b = reads.next()
    expect(reads.isLatest(a)).toBe(false)
    expect(reads.isLatest(b)).toBe(true)
  })

  test("a finished import does not close a dialog already closed", () => {
    expect(afterImport({ ok: true }, false)).toEqual({ close: false })
    expect(afterImport({ ok: false, refusal: "No" }, false)).toEqual({ close: false })
  })

  test("a net no longer in the circuit is not sent", () => {
    const picked = box()
    const form = { ...startForm(picked), layer: "top" as const, net: "OLD" }
    expect(graphicImportRequest(picked, form, ["GND"])).not.toHaveProperty("net")
    expect(graphicImportRequest(picked, { ...form, net: "GND" }, ["GND"])).toMatchObject({ net: "GND" })
  })
})
