import { beforeAll, describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import type { SchematicLayout } from "../src/engine/schematic.js"
import { drawSchematic, wireDrawnPx } from "../studio/src/pcb/schematic-draw.js"
import { schematicTheme } from "../studio/src/pcb/schematic-theme.js"
import { SCHEMATIC_ZOOM_REFERENCE_PX } from "../studio/src/pcb/units.js"
import { fakeInk, fakeTextWidth, fontPx, recorder, type DrawCall } from "./helpers/fake-ctx.js"

const DEMO = new URL("../examples/usb-c-ldo", import.meta.url)
const SIZE = { width: 1600, height: 900 }
const FILE = "main.circuit.tsx"
const RESISTORS = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
    <trace from=".R1 > .pin2" to=".R2 > .pin2" />
  </board>
)`
const resistors = buildDesign({ [FILE]: RESISTORS }, FILE).schematic

let demo: Design

beforeAll(async () => {
  demo = buildDesign(await collectProjectFiles(DEMO.pathname.replace(/^\/([A-Za-z]:)/, "$1"), { include: ENGINE_FILES }), "index.circuit.tsx")
})

function draw(layout: SchematicLayout, scale: number, ratio: number, cx = 1.5) {
  const rec = recorder()
  drawSchematic(rec.ctx as never, layout, { camera: { cx, cy: 0, scale }, size: SIZE }, { ratio })
  return rec
}

const written = (records: readonly DrawCall[]) => records.filter((r) => r.name === "fillText")
const textsOf = (records: readonly DrawCall[]) => written(records).map((r) => r.args[0] as string)
const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-6

describe("schematic text at the demo's 70%", () => {
  const scale = 0.7 * SCHEMATIC_ZOOM_REFERENCE_PX

  test.each([1, 1.1, 1.25, 1.5])("every text is written at a whole device pixel size of at least 5, and no pin numbers, at ratio %s", (ratio) => {
    const { records } = draw(demo.schematic, scale, ratio, 8)
    const texts = written(records)
    expect(texts.length).toBeGreaterThan(0)
    for (const text of texts) {
      const device = fontPx(text.font) * ratio
      expect([text.args[0], whole(device)]).toEqual([text.args[0], true])
      expect(device).toBeGreaterThanOrEqual(5)
    }
    expect(textsOf(records).filter((t) => /^\d+$/.test(t))).toEqual([])
  })

  test("designators show, values and pin names wait", () => {
    const texts = textsOf(draw(demo.schematic, scale, 1.1, 8).records)
    expect(texts).toEqual(expect.arrayContaining(["J1", "U1", "R1"]))
    expect(texts).not.toContain("5.1k")
    expect(texts).not.toContain("VBUS2")
  })
})

describe("schematic text levels", () => {
  test("judged by the designator's size: pin numbers from 11 device px, values from 9, designators from 7", () => {
    const at = (scale: number) => textsOf(draw(resistors, scale, 1).records)
    // designators (0.16 in) at 70 px/in are 11 px: pin numbers (0.1 in) are drawn though they are 7 px themselves
    expect(at(70)).toEqual(expect.arrayContaining(["R1", "1k", "1", "2"]))
    expect(at(65)).toEqual(expect.arrayContaining(["R1", "1k"]))
    expect(at(65)).not.toContain("1")
    expect(at(50)).toContain("R1")
    expect(at(50)).not.toContain("1k")
    expect(at(40)).toEqual([])
  })

  test("at 100% on a 100% display the pin names are drawn", () => {
    const texts = textsOf(draw(demo.schematic, SCHEMATIC_ZOOM_REFERENCE_PX, 1, 8).records)
    expect(texts).toEqual(expect.arrayContaining(["CC1", "VBUS2", "EN", "VOUT"]))
  })

  test("a shortened pin name is drawn at the whole device pixel size at or just above 70%", () => {
    // at 57 px/in designators are 9 px (all) and pin names 7 px; J1's bottom names, shortened, are 5 px (70% is 4.9)
    const { records } = draw(demo.schematic, 57, 1, 8)
    const short = written(records).filter((r) => (r.args[0] as string).endsWith("…"))
    expect(short.length).toBeGreaterThan(0)
    for (const r of short) expect(fontPx(r.font)).toBe(5)
  })

  test("text anchors are on device pixels in x and on the baseline", () => {
    const ratio = 1.25
    const { records } = draw(demo.schematic, 97.3, ratio, 8.13)
    const anchors = records.filter((r, i) => r.name === "translate" && records.slice(i + 1).find((n) => n.name === "fillText" || n.name === "translate")?.name === "fillText")
    expect(anchors.length).toBeGreaterThan(5)
    for (const a of anchors) expect([whole((a.args[0] as number) * ratio), whole((a.args[1] as number) * ratio)]).toEqual([true, true])
  })
})

/** A chip with names on every side: three on top, three at the bottom, two left, two right; turned by `degrees`. */
const turnedChip = (degrees: number) => `export default () => (
  <board width="30mm" height="18mm">
    <chip name="U1" schX={0} schY={0} schRotation={${degrees}}
      pinLabels={{ pin1: "T1", pin2: "T2", pin3: "T3", pin4: "B1", pin5: "B2", pin6: "B3", pin7: "IN", pin8: "EN", pin9: "OUT", pin10: "PG" }}
      pinSides={{ pin1: "top", pin2: "top", pin3: "top", pin4: "bottom", pin5: "bottom", pin6: "bottom", pin7: "left", pin8: "left", pin9: "right", pin10: "right" }} />
  </board>
)`
const ALL_NAMES = ["T1", "T2", "T3", "B1", "B2", "B3", "IN", "EN", "OUT", "PG"]

/** A chip turned 90° whose left and right names are wider than the 0.2 in pitch they run across. */
const TURNED_WIDE = `export default () => (
  <board width="30mm" height="18mm">
    <chip name="U2" schX={0} schY={0} schRotation={90}
      pinLabels={{ pin1: "VOUT", pin2: "SENSE", pin3: "GND", pin4: "VIN", pin5: "FB", pin6: "PGOOD" }}
      pinSides={{ pin1: "left", pin2: "left", pin3: "left", pin4: "right", pin5: "right", pin6: "right" }} />
  </board>
)`
const WIDE_NAMES = ["VOUT", "SENSE", "GND", "VIN", "FB", "PGOOD"]
/** The name as written: itself, or its start with an ellipsis. */
const writtenAs = (texts: readonly string[], name: string) => texts.find((t) => t === name || (t.endsWith("…") && name.startsWith(t.slice(0, -1))))

function noOverlap(records: readonly DrawCall[], names: readonly string[]): void {
  const boxes = writtenBoxes(records).filter((b) => names.some((n) => writtenAs([b.text], n)))
  for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect([a.text, b.text, overlaps(a, b)]).toEqual([a.text, b.text, false])
}

describe("side names of a box turned 90°", () => {
  const chip = () => buildDesign({ [FILE]: TURNED_WIDE }, FILE).schematic

  test("at 100% every name is kept, drawn smaller or shortened, and none overlap", () => {
    const { records } = draw(chip(), SCHEMATIC_ZOOM_REFERENCE_PX, 1, 0)
    const texts = textsOf(records)
    expect(WIDE_NAMES.filter((n) => !writtenAs(texts, n))).toEqual([])
    expect(texts.some((t) => t.endsWith("…"))).toBe(true)
    noOverlap(records, WIDE_NAMES)
  })

  test("at 70% none overlap: at ratio 1 pin names wait for the level, at ratio 1.5 they are fitted", () => {
    const scale = 0.7 * SCHEMATIC_ZOOM_REFERENCE_PX
    expect(WIDE_NAMES.filter((n) => writtenAs(textsOf(draw(chip(), scale, 1, 0).records), n))).toEqual([])
    const { records } = draw(chip(), scale, 1.5, 0)
    expect(WIDE_NAMES.filter((n) => writtenAs(textsOf(records), n)).length).toBeGreaterThan(0)
    noOverlap(records, WIDE_NAMES)
  })

  test("at any zoom the short names are written in full and the long ones shortened, as the pitch grows with the zoom", () => {
    for (const scale of [60, 120, 400]) {
      const texts = textsOf(draw(chip(), scale, 1, 0).records)
      expect([scale, ["VIN", "FB", "GND"].filter((n) => !texts.includes(n))]).toEqual([scale, []])
      expect([scale, ["VOUT", "SENSE", "PGOOD"].filter((n) => !writtenAs(texts, n))]).toEqual([scale, []])
    }
  })
})

describe("pin names never overprint", () => {
  test.each([0, 90, 180, 270])("a box turned %i° keeps every name that fits, on every side", (degrees) => {
    const chip = buildDesign({ [FILE]: turnedChip(degrees) }, FILE).schematic
    for (const scale of [80, 120, 200]) {
      const { records } = draw(chip, scale, 1, 0)
      expect([scale, ALL_NAMES.filter((n) => !textsOf(records).includes(n))]).toEqual([scale, []])
      const boxes = writtenBoxes(records).filter((b) => ALL_NAMES.includes(b.text))
      for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect([a.text, b.text, overlaps(a, b)]).toEqual([a.text, b.text, false])
    }
  })

  test("J1's bottom names, wider than their pitch, are drawn smaller and shortened rather than left out", () => {
    const { records } = draw(demo.schematic, 120, 1, 0)
    const texts = textsOf(records)
    expect(texts.filter((t) => t.startsWith("GN") && t.endsWith("…"))).toHaveLength(2)
    expect(texts).toContain("EH")
    expect(texts).toEqual(expect.arrayContaining(["CC1", "CC2", "VBUS1", "VBUS2"]))
    const eh = written(records).find((r) => r.args[0] === "EH")
    expect(fontPx(eh?.font ?? "")).toBeLessThanOrEqual(14)
  })

  test("no two pin names of one symbol are written over each other", () => {
    for (const scale of [60, 90, 120, 200, 400]) {
      const { records } = draw(demo.schematic, scale, 1, 0)
      const names = new Set(demo.schematic.symbols.flatMap((s) => s.symbol.shapes.flatMap((sh) => (sh.type === "text" && sh.role === "pin-name" ? [sh.text] : []))))
      const boxes = writtenBoxes(records).filter((b) => names.has(b.text))
      for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect([scale, a.text, b.text, overlaps(a, b)]).toEqual([scale, a.text, b.text, false])
    }
  })
})

describe("a two-pin part's designator and value", () => {
  test("are never wider than 2.5 symbol lengths: a long value is written smaller", () => {
    const long = buildDesign({ [FILE]: RESISTORS.replace('resistance="1k" footprint="0402" schX={0}', 'resistance="4.7k 0.1% 25ppm thin film 0805 AEC-Q200" footprint="0402" schX={0}') }, FILE).schematic
    const r1 = long.symbols.find((s) => s.component === "R1")
    const value = r1?.symbol.shapes.find((s) => s.type === "text" && s.role === "value")
    expect(value?.type === "text" && value.text.length).toBeGreaterThan(30)
    const scale = 200
    const { records } = draw(long, scale, 1, 0)
    const written = records.find((r) => r.name === "fillText" && r.args[0] === (value?.type === "text" ? value.text : ""))
    const [a, b] = r1?.symbol.pins ?? []
    const length = a && b ? Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y) : 0
    expect(length).toBeCloseTo(1)
    expect(fontPx(written?.font ?? "")).toBeLessThan(0.16 * scale)
    expect(fakeTextWidth(written?.args[0] as string, written?.font ?? "")).toBeLessThanOrEqual(2.5 * length * scale)
    const short = textsOf(draw(resistors, scale, 1, 0).records)
    expect(short).toContain("1k")
  })
})

describe("schematic strokes", () => {
  test("wires are at least one device pixel and at most their world width", () => {
    for (const [scale, ratio] of [[10, 2], [10, 1], [1000, 1.25]] as const) {
      const { records } = draw(resistors, scale, ratio)
      const wire = records.find((r) => r.name === "stroke" && r.strokeStyle === schematicTheme.wire)
      expect((wire?.lineWidth ?? 0) * scale).toBeCloseTo(wireDrawnPx(scale, ratio), 9)
    }
    expect(wireDrawnPx(10, 2)).toBeCloseTo(0.5)
    expect(wireDrawnPx(1000, 1.25)).toBeCloseTo(20)
  })

  test("wireDrawnPx is never below one device pixel, at any zoom and ratio", () => {
    for (const ratio of [1, 1.1, 1.25, 1.5, 2, 3]) {
      for (const scale of [0.01, 0.5, 5, 42, 49.9, 50, 60, 1000]) expect(wireDrawnPx(scale, ratio) * ratio).toBeGreaterThanOrEqual(1 - 1e-12)
    }
  })

  test("symbol outlines are at least one device pixel", () => {
    const { records } = draw(resistors, 10, 2)
    const outline = records.find((r) => r.name === "stroke" && r.strokeStyle === schematicTheme.symbolOutline)
    expect((outline?.lineWidth ?? 0) * 10).toBeCloseTo(0.5)
  })
})

interface Written {
  text: string
  x0: number
  x1: number
  y0: number
  y1: number
}

/** Each written text's box on screen, from the translate before it, its alignment and the fake measure. */
function writtenBoxes(records: readonly DrawCall[]): Written[] {
  const boxes: Written[] = []
  let at = { x: 0, y: 0 }
  for (const r of records) {
    if (r.name === "translate") at = { x: r.args[0] as number, y: r.args[1] as number }
    if (r.name !== "fillText") continue
    const text = r.args[0] as string
    const width = fakeTextWidth(text, r.font)
    // the ink from the text's own baseline, by the fake font metrics
    const ink = fakeInk(text, r.font, r.textBaseline)
    const x0 = r.textAlign === "left" ? at.x : r.textAlign === "right" ? at.x - width : at.x - width / 2
    boxes.push({ text, x0, x1: x0 + width, y0: at.y - ink.ascent, y1: at.y + ink.descent })
  }
  return boxes
}

const overlaps = (a: Written, b: Written) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
