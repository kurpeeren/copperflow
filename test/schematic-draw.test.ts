import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { groundSymbol } from "../src/engine/symbols/index.js"
import { HIGHLIGHT_DIM, PALETTE } from "../studio/src/pcb/ctx.js"
import { worldToScreen } from "../studio/src/pcb/geometry.js"
import { SCHEMATIC_PALETTE, drawSchematic, sheetBoxes, type SchematicDrawOptions } from "../studio/src/pcb/schematic-draw.js"
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

const FILE = "main.circuit.tsx"
const LABELLED = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
    <trace from=".R1 > .pin1" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.GND" schematicRouteHints={[{ x: 2, y: 1 }]} />
    <trace from=".R1 > .pin2" to="net.EN" schematicRouteHints={[{ x: 1, y: 1 }]} />
  </board>
)`

const design = buildDesign({ "main.circuit.tsx": CIRCUIT }, "main.circuit.tsx")
const layout = design.schematic
const VIEW = { camera: { cx: 1.5, cy: 0, scale: 100 }, size: { width: 800, height: 600 } }

function draw(options: Partial<SchematicDrawOptions> = {}) {
  const rec = recorder()
  drawSchematic(rec.ctx as never, layout, VIEW, { ratio: 1, ...options })
  return rec
}

describe("drawSchematic", () => {
  test("draws a resistor polyline and both pin numbers", () => {
    const { calls, records } = draw()
    expect(calls).toContain("lineTo")
    const texts = records.filter((r) => r.name === "fillText").map((r) => r.args[0])
    expect(texts).toEqual(expect.arrayContaining(["1", "2"]))
  })

  test("draws the reference designators", () => {
    const texts = draw().records.filter((r) => r.name === "fillText").map((r) => r.args[0])
    expect(texts).toEqual(expect.arrayContaining(["R1", "R2"]))
  })

  test("an active pin is drawn in activePort", () => {
    const { records } = draw({ activePins: ["R1.pin1"] })
    expect(records.some((r) => r.name === "fill" && r.fillStyle === SCHEMATIC_PALETTE.activePort)).toBe(true)
    expect(draw().records.some((r) => r.fillStyle === SCHEMATIC_PALETTE.activePort)).toBe(false)
  })

  test("showPins marks every pin", () => {
    const fills = (rec: ReturnType<typeof draw>) => rec.records.filter((r) => r.name === "fill" && r.fillStyle === SCHEMATIC_PALETTE.port).length
    expect(fills(draw({ showPins: true }))).toBe(4)
    expect(fills(draw())).toBe(0)
  })

  test("a ground label draws the ground shape", () => {
    expect(layout.labels.some((l) => l.style === "ground")).toBe(true)
    const labels = layout.labels.filter((l) => l.style === "ground").length
    const strokes = draw().records.filter((r) => r.name === "stroke" && r.strokeStyle === SCHEMATIC_PALETTE.netLabel)
    expect(strokes.length).toBe(labels * groundSymbol().length)
  })

  test("every pending wire is drawn dashed", () => {
    const rec = draw({
      pending: [
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        [
          { x: 2, y: 0 },
          { x: 2, y: 1 },
        ],
      ],
    })
    expect(rec.records.some((r) => r.name === "setLineDash" && (r.args[0] as number[]).length > 0)).toBe(true)
    const starts = rec.records.filter((r) => r.name === "moveTo").map((r) => r.args)
    expect(starts).toEqual(expect.arrayContaining([[0, 0], [2, 0]]))
    const plain = draw().records.filter((r) => r.name === "moveTo").length
    expect(rec.records.filter((r) => r.name === "moveTo").length - plain).toBe(2)
  })

  test("an auto-placed symbol is drawn at 60% alpha inside a dashed box", () => {
    const auto = buildDesign(
      {
        "main.circuit.tsx": `export default () => (
          <board width="30mm" height="18mm">
            <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
            <resistor name="R2" resistance="1k" footprint="0402" />
          </board>
        )`,
      },
      "main.circuit.tsx",
    ).schematic
    expect(auto.symbols.map((s) => [s.component, s.autoPlaced])).toEqual([
      ["R1", false],
      ["R2", true],
    ])
    const rec = recorder()
    drawSchematic(rec.ctx as never, auto, VIEW, { ratio: 1 })
    const outlines = rec.records.filter((r) => r.name === "stroke" && r.strokeStyle === SCHEMATIC_PALETTE.outline)
    expect(new Set(outlines.map((r) => r.globalAlpha))).toEqual(new Set([1, 0.6]))
    expect(rec.records.filter((r) => r.name === "stroke" && r.strokeStyle === SCHEMATIC_PALETTE.autoBox)).toHaveLength(1)
    expect(rec.records.find((r) => r.name === "fillText" && r.args[0] === "R2")?.globalAlpha).toBe(0.6)
    expect(rec.records.find((r) => r.name === "fillText" && r.args[0] === "R1")?.globalAlpha).toBe(1)
  })

  test("the moving part is drawn shifted", () => {
    const r1 = layout.symbols.find((s) => s.component === "R1")
    const moved = draw({ moving: { component: "R1", by: { x: 1, y: 0 } } }).records.filter((r) => r.name === "translate")
    expect(moved.some((r) => r.args[0] === (r1?.x ?? 0) + 1)).toBe(true)
  })
})

describe("highlight", () => {
  const wiresOf = (net: string) => layout.wires.filter((w) => w.net === net).length
  const strokes = (rec: ReturnType<typeof draw>, color: unknown) => rec.records.filter((r) => r.name === "stroke" && r.strokeStyle === color)

  test("wires of the net use the highlight colour and the others are dimmed", () => {
    const rec = draw({ highlight: { net: "net:R1.pin2" } })
    expect(strokes(rec, PALETTE.highlight).filter((r) => r.globalAlpha === 1)).toHaveLength(wiresOf("net:R1.pin2"))
    const others = strokes(rec, SCHEMATIC_PALETTE.wire)
    expect(others).toHaveLength(layout.wires.length - wiresOf("net:R1.pin2"))
    expect(others.every((r) => r.globalAlpha === HIGHLIGHT_DIM)).toBe(true)
  })

  test("the dimmed alpha is the one the PCB uses", () => {
    expect(HIGHLIGHT_DIM).toBe(0.3)
  })

  test("without a highlight nothing is dimmed or lit", () => {
    const rec = draw()
    expect(strokes(rec, PALETTE.highlight)).toHaveLength(0)
    expect(strokes(rec, SCHEMATIC_PALETTE.wire).every((r) => r.globalAlpha === 1)).toBe(true)
  })

  test("labels of the net are lit and other labels are dimmed", () => {
    const power = buildDesign({ [FILE]: LABELLED }, FILE).schematic
    const rec = recorder()
    drawSchematic(rec.ctx as never, power, VIEW, { ratio: 1, highlight: { net: "net.GND" } })
    const lit = rec.records.filter((r) => r.name === "stroke" && r.strokeStyle === PALETTE.highlight)
    const dim = rec.records.filter((r) => r.name === "stroke" && r.strokeStyle === SCHEMATIC_PALETTE.netLabel)
    expect(lit.length).toBeGreaterThan(0)
    expect(dim.length).toBeGreaterThan(0)
    expect(dim.every((r) => r.globalAlpha === HIGHLIGHT_DIM)).toBe(true)
    expect(rec.records.find((r) => r.name === "fillText" && r.args[0] === "EN")?.globalAlpha).toBe(HIGHLIGHT_DIM)
  })

  test("symbols are dimmed, except those with a pin on the net", () => {
    const outline = (rec: ReturnType<typeof draw>) => new Set(strokes(rec, SCHEMATIC_PALETTE.outline).map((r) => r.globalAlpha))
    expect(outline(draw({ highlight: { net: "net.GND" } }))).toEqual(new Set([HIGHLIGHT_DIM]))
    expect(outline(draw({ highlight: { net: "net.GND", pins: ["R1.pin1"] } }))).toEqual(new Set([1, HIGHLIGHT_DIM]))
    expect(draw({ highlight: { net: "net.GND" } }).records.find((r) => r.name === "fillText" && r.args[0] === "R1")?.globalAlpha).toBe(HIGHLIGHT_DIM)
  })

  test("pins on the net are marked even when pins are not shown", () => {
    const lit = (rec: ReturnType<typeof draw>) => rec.records.filter((r) => r.name === "fill" && r.fillStyle === PALETTE.highlight).length
    const without = lit(draw({ highlight: { net: "net:R1.pin2" } }))
    expect(lit(draw({ highlight: { net: "net:R1.pin2", pins: ["R1.pin2", "R2.pin2"] } })) - without).toBe(2)
  })

  test("a label on another name of the highlighted net is lit through its aliases", () => {
    const aliased = buildDesign(
      {
        [FILE]: `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
    <trace from=".R1 > .pin1" to="net.A" />
    <trace from=".R1 > .pin1" to="net.B" />
    <trace from=".R2 > .pin1" to="net.B" schematicRouteHints={[{ x: 2, y: 1 }]} />
  </board>
)`,
      },
      FILE,
    ).schematic
    const lit = (highlight: SchematicDrawOptions["highlight"]) => {
      const rec = recorder()
      drawSchematic(rec.ctx as never, aliased, VIEW, { ratio: 1, ...(highlight ? { highlight } : {}) })
      return rec.records.filter((r) => r.name === "stroke" && r.strokeStyle === PALETTE.highlight).length
    }
    expect(lit({ net: "net.A" })).toBeLessThan(lit({ net: "net.A", aliases: ["net.A", "net.B"] }))
    expect(lit({ net: "net.A", aliases: ["net.A", "net.B"] })).toBeGreaterThan(0)
  })

  test("pin markers stay small at low zoom", () => {
    const radii = (scale: number, pins: string[]) => {
      const rec = recorder()
      drawSchematic(rec.ctx as never, layout, { camera: { cx: 1.5, cy: 0, scale }, size: VIEW.size }, { ratio: 1, highlight: { net: "net:R1.pin2", pins } })
      return rec.records.filter((r) => r.name === "arc" && r.fillStyle === PALETTE.highlight).map((r) => (r.args[2] as number) * scale)
    }
    for (const scale of [10, 21, 100, 400]) {
      const rest = radii(scale, [])
      const extra = radii(scale, ["R1.pin2"]).filter((r) => {
        const at = rest.findIndex((w) => Math.abs(w - r) < 1e-9)
        if (at >= 0) rest.splice(at, 1)
        return at < 0
      })
      expect(extra).toHaveLength(1)
      expect(extra[0]).toBeLessThanOrEqual(3.5 + 1e-9)
    }
  })

  test("ghost labels are drawn dashed", () => {
    const rec = draw({ ghostLabels: [{ id: "g", net: "net.EN", text: "EN", at: { x: 5, y: 0 }, side: "right", style: "label" }] })
    expect(rec.records.some((r) => r.name === "fillText" && r.args[0] === "EN")).toBe(true)
    const dashes = rec.records.filter((r) => r.name === "setLineDash" && (r.args[0] as number[]).length > 0)
    expect(dashes.length).toBeGreaterThan(0)
  })
})

describe("violation markers", () => {
  test("an error violation strokes a 6 px ring in the error colour at its position", () => {
    const at = { x: 1, y: 0.5 }
    const rec = draw({ violations: [{ id: "pin-unconnected:R1.pin1", at, severity: "error" }] })
    const p = worldToScreen(VIEW.camera, VIEW.size, at)
    const rings = rec.records.filter((r) => r.name === "arc" && r.strokeStyle === PALETTE.error)
    expect(rings.map((r) => r.args.slice(0, 3))).toEqual([[p.x, p.y, 6]])
    expect(rec.records.filter((r) => r.name === "stroke" && r.strokeStyle === PALETTE.error)).toHaveLength(1)
  })

  test("the active violation is drawn thicker", () => {
    const violations = [
      { id: "a", at: { x: 0, y: 0 }, severity: "warning" as const },
      { id: "b", at: { x: 1, y: 0 }, severity: "warning" as const },
    ]
    const strokes = draw({ violations, activeViolation: "a" }).records.filter((r) => r.name === "stroke" && r.strokeStyle === PALETTE.warning)
    const [active, plain] = strokes.map((r) => r.lineWidth)
    expect(active).toBeGreaterThan(plain ?? Infinity)
  })
})

describe("sheetBoxes", () => {
  test("gives one box per symbol, named by its component", () => {
    const boxes = sheetBoxes(layout)
    expect(boxes.map((b) => b.name).sort()).toEqual(["R1", "R2"])
    const r2 = boxes.find((b) => b.name === "R2")
    const x = layout.symbols.find((s) => s.component === "R2")?.x ?? 0
    expect(r2?.box.minX).toBeLessThan(x)
    expect(r2?.box.maxX).toBeGreaterThan(x)
  })
})
