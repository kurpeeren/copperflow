import { afterEach, describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { groundSymbol } from "../src/engine/symbols/index.js"
import { planGrid } from "../studio/src/pcb/grid.js"
import { drawOutline, sheetLookFor, SHEET_LOOK } from "../studio/src/pcb/overlays.js"
import { drawSchematic, type SchematicDrawOptions } from "../studio/src/pcb/schematic-draw.js"
import { drawSchematicGrid, sheetGridPaint } from "../studio/src/pcb/schematic-grid.js"
import { darkSchematicTheme as dark, resetSheetPalette, schematicTheme as light, setSheetPalette } from "../studio/src/pcb/schematic-theme.js"
import { sheetWireLookFor, SHEET_WIRE_LOOK } from "../studio/src/pcb/wire-overlay.js"
import { recorder } from "./helpers/fake-ctx.js"

const CIRCUIT = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
    <trace from=".R1 > .pin1" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.GND" />
    <trace from=".R1 > .pin2" to=".R2 > .pin2" />
  </board>
)`
const layout = buildDesign({ "main.circuit.tsx": CIRCUIT }, "main.circuit.tsx").schematic
const VIEW = { camera: { cx: 1.5, cy: 0, scale: 120 }, size: { width: 800, height: 600 } }

function draw(options: Partial<SchematicDrawOptions> = {}) {
  const rec = recorder()
  drawSchematic(rec.ctx as never, layout, VIEW, { ratio: 1, ...options })
  return rec
}

afterEach(resetSheetPalette)

/** The calls that put paint on the canvas. */
const PAINTS = new Set(["stroke", "fill", "fillText", "strokeRect", "fillRect"])

describe("the schematic in the dark palette", () => {
  test("wires, symbols, designators, values and flags take the dark colours", () => {
    setSheetPalette(dark)
    const { records } = draw()
    const strokes = new Set(records.filter((r) => r.name === "stroke").map((r) => r.strokeStyle))
    expect(strokes).toContain(dark.wire)
    expect(strokes).toContain(dark.symbolOutline)
    expect(strokes).not.toContain(light.wire)
    const text = (t: string) => records.find((r) => r.name === "fillText" && r.args[0] === t)?.fillStyle
    expect(text("R1")).toBe(dark.designator)
    expect(text("1k")).toBe(dark.value)
    const grounds = layout.labels.filter((label) => label.style === "ground").length
    expect(grounds).toBeGreaterThan(0)
    expect(records.filter((r) => r.name === "stroke" && r.strokeStyle === dark.flag)).toHaveLength(grounds * groundSymbol().length)
  })

  test("junctions are filled in the wire colour", () => {
    setSheetPalette(dark)
    const fills = draw().records.filter((r) => r.name === "fill").map((r) => r.fillStyle)
    if (layout.junctions.length > 0) expect(fills).toContain(dark.wire)
    expect(fills).not.toContain(light.junction)
  })

  test("violation rings keep red and amber, the dark sheet's own", () => {
    setSheetPalette(dark)
    const at = { x: 0, y: 0 }
    const { records } = draw({ violations: [{ id: "e", at, severity: "error" }, { id: "w", at, severity: "warning" }] })
    const strokes = records.filter((r) => r.name === "stroke").map((r) => r.strokeStyle)
    expect(strokes).toContain(dark.markerError)
    expect(strokes).toContain(dark.markerWarning)
  })

  test("a selected wire glows softly in the selection colour; nothing else glows", () => {
    setSheetPalette(dark)
    const wire = layout.wires[0]?.id as string
    const { records } = draw({ selectedWires: [wire] })
    const glowing = records.filter((r) => PAINTS.has(r.name) && r.shadowBlur > 0)
    expect(glowing.length).toBeGreaterThan(0)
    for (const r of glowing) expect([r.name, r.strokeStyle, r.shadowBlur, r.shadowColor]).toEqual(["stroke", dark.selection, 8, dark.selection])
    expect(records.filter((r) => r.name === "fillText").every((r) => r.shadowBlur === 0)).toBe(true)
  })

  test("a selected ground flag glows too", () => {
    setSheetPalette(dark)
    const flag = layout.labels.find((label) => label.style === "ground")?.id as string
    const glowing = draw({ selectedLabels: [flag] }).records.filter((r) => PAINTS.has(r.name) && r.shadowBlur > 0)
    expect(glowing).toHaveLength(groundSymbol().length)
  })

  test("the light sheet never glows", () => {
    const wire = layout.wires[0]?.id as string
    expect(draw({ selectedWires: [wire] }).records.some((r) => r.shadowBlur > 0)).toBe(false)
  })
})

describe("the dark grid", () => {
  const camera = { cx: 0, cy: 0, scale: 100 }
  const size = { width: 400, height: 300 }

  test("the grid paint per palette: dots and lines with a brighter fifth in dark, none in light", () => {
    expect(sheetGridPaint(dark)).toEqual({ lines: { minor: "#2B3038", fifth: "#3A4049" }, dots: { minor: "#2B3038", fifth: "#3A4049", px: 2 } })
    expect(sheetGridPaint(light)).toEqual({ lines: { minor: "#F0F0EB" }, dots: { minor: "#D9D9D2", px: 2 } })
  })

  test("dots are device-pixel squares, minor in the dot colour and every fifth crossing brighter", () => {
    for (const ratio of [1, 1.25, 1.5, 2]) {
      const { ctx, records } = recorder()
      drawSchematicGrid(ctx, camera, size, { step: 0.1, style: "dots" }, ratio, dark)
      const rects = records.filter((r) => r.name === "rect")
      expect(rects.length).toBeGreaterThan(50)
      for (const r of rects) {
        for (const v of r.args as number[]) expect(Math.abs(v * ratio - Math.round(v * ratio))).toBeLessThan(1e-9)
      }
      expect(records.filter((r) => r.name === "fill").map((r) => r.fillStyle)).toEqual(["#2B3038", "#3A4049"])
    }
  })

  test("the dots fade as the lines do: only the fifth crossings below 6 device px", () => {
    const at = { cx: 0, cy: 0, scale: 20 }
    const { ctx, records } = recorder()
    drawSchematicGrid(ctx, at, size, { step: 0.25, style: "dots" }, 1, dark)
    const plan = planGrid(at, size, 0.25)
    const count = (indices: number[] = []) => indices.filter((i) => i % 5 === 0).length
    expect(records.filter((r) => r.name === "rect")).toHaveLength(count(plan?.columns) * count(plan?.rows))
  })

  test("without a palette the grid takes the sheet's current one", () => {
    setSheetPalette(dark)
    const { ctx, records } = recorder()
    drawSchematicGrid(ctx, camera, size, { step: 0.1, style: "dots" }, 1)
    expect(records.find((r) => r.name === "fill")?.fillStyle).toBe(dark.gridDot)
  })
})

describe("the dark overlays", () => {
  test("the sheet look per palette: the light one is SHEET_LOOK; only the dark one glows", () => {
    expect(sheetLookFor(light)).toEqual(SHEET_LOOK)
    expect(sheetLookFor(dark)).toMatchObject({ selected: dark.selection, hover: dark.hover, boxStroke: dark.selectionBox, glow: 8 })
    expect(sheetWireLookFor(light)).toEqual(SHEET_WIRE_LOOK)
    expect(sheetWireLookFor(dark)).toEqual({ hover: dark.hover, selected: dark.selection, handleFill: dark.handleFill })
  })

  test("a part's selection outline glows in the dark look, its hover outline does not, and the hairline stays one device pixel", () => {
    const box = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
    const camera = { cx: 0, cy: 0, scale: 20 }
    const size = { width: 400, height: 300 }
    const selected = recorder()
    drawOutline(selected.ctx, camera, size, box, { x: 0, y: 0 }, "selected", sheetLookFor(dark), 1)
    expect(selected.records.find((r) => r.name === "strokeRect")).toMatchObject({ strokeStyle: dark.selection, shadowBlur: 8, shadowColor: dark.selection })
    const hover = recorder()
    drawOutline(hover.ctx, camera, size, box, { x: 0, y: 0 }, "hover", sheetLookFor(dark), 2)
    expect(hover.records.find((r) => r.name === "strokeRect")).toMatchObject({ strokeStyle: dark.hover, shadowBlur: 0, lineWidth: 0.5 })
  })
})

describe("the glow and a selection wash", () => {
  test("a look with a wash fills it without the glow; only the outline glows", () => {
    const { ctx, records } = recorder()
    const box = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
    drawOutline(ctx, { cx: 0, cy: 0, scale: 20 }, { width: 400, height: 300 }, box, { x: 0, y: 0 }, "selected", { ...sheetLookFor(dark), selectedFill: "rgb(0 0 0 / 10%)" }, 1)
    expect(records.find((r) => r.name === "fillRect")?.shadowBlur).toBe(0)
    expect(records.find((r) => r.name === "strokeRect")?.shadowBlur).toBe(8)
  })
})

describe("a sheet symbol", () => {
  const SHEET = `export default function Stage() {
  return (
    <sheet>
      <port name="VIN" />
      <port name="D[0:3]" bus />
      <resistor name="R1" footprint="0402" />
      <trace from="R1.pin1" to="net.VIN" />
      <trace from="R1.pin2" to="net.D0" />
    </sheet>
  )
}
`
  const MAIN = `import Stage from "./Stage.sheet"
export default () => (
  <board width="30mm" height="18mm">
    <Stage name="S1" connections={{ VIN: "VIN", "D[0:3]": "D[0:3]" }} schX={0} schY={0} />
    <resistor name="R9" resistance="1k" footprint="0402" schX={4} schY={0} />
  </board>
)`
  const built = buildDesign({ "main.circuit.tsx": MAIN, "Stage.sheet.tsx": SHEET }, "main.circuit.tsx").schematic
  const drawn = () => {
    const rec = recorder()
    drawSchematic(rec.ctx as never, built, { camera: { cx: 1, cy: 0, scale: 200 }, size: { width: 1200, height: 800 } }, { ratio: 1 })
    return rec.records
  }

  test("draws its bus pin in the bus colour, in both palettes", () => {
    expect(built.symbols.find((s) => s.component === "S1")?.symbol.kind).toBe("sheet")
    for (const palette of [light, dark]) {
      setSheetPalette(palette)
      const painted = drawn().filter((r) => r.name === "stroke" || r.name === "fill")
      expect(painted.some((r) => (r.name === "stroke" ? r.strokeStyle : r.fillStyle) === palette.bus)).toBe(true)
    }
  })

  test("draws no pin numbers; a part beside it still does", () => {
    const texts = drawn().filter((r) => r.name === "fillText").map((r) => String(r.args[0]))
    expect(texts).toContain("VIN")
    expect(texts.filter((t) => /^\d+$/.test(t))).toEqual(["1", "2"])
  })
})
