import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { PALETTE } from "../studio/src/pcb/ctx.js"
import { drawPcb, padAt, pcbBoxes } from "../studio/src/pcb/pcb-draw.js"
import { recorder } from "./helpers/fake-ctx.js"

const CIRCUIT = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-4} pcbY={2} />
    <resistor name="R2" resistance="1k" footprint="0402" pcbX={4} pcbY={-2} />
    <chip name="J1" footprint="pinrow2_p2.54mm" pinCount={2} pcbX={0} pcbY={6} />
    <trace from=".R1 > .pin1" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.GND" />
    <trace from=".R1 > .pin2" to=".R2 > .pin2" />
  </board>
)`

const design = buildDesign({ "main.circuit.tsx": CIRCUIT }, "main.circuit.tsx")
const layout = design.pcb
const VIEW = { camera: { cx: 0, cy: 0, scale: 20 }, size: { width: 800, height: 600 } }

function pad(id: string) {
  const found = layout.parts.flatMap((p) => p.pads).find((p) => p.id === id)
  if (!found) throw new Error(`no pad ${id}`)
  return found
}

describe("drawPcb", () => {
  test("a roundrect pad is drawn with rounded corners", () => {
    expect(pad("R1#1").shape).toBe("roundrect")
    const { ctx, calls } = recorder()
    drawPcb(ctx, layout, VIEW, { ratio: 1 })
    expect(calls).toContain("arcTo")
  })

  test("a through pad draws its drill", () => {
    expect(pad("J1#2").layers).toBe("through")
    const { ctx, records } = recorder()
    drawPcb(ctx, layout, VIEW, { ratio: 1 })
    const drills = records.filter((r) => r.name === "fill" && r.fillStyle === PALETTE.drill)
    expect(drills).toHaveLength(2)
    const hole = records.filter((r) => r.name === "arc" && r.fillStyle === PALETTE.drill)
    expect(hole.map((r) => r.args[2])).toEqual([0.5, 0.5].map((_, i) => (pad(i === 0 ? "J1#1" : "J1#2").drill?.width ?? 0) / 2))
  })

  test("highlighting a net dims the other copper to 0.3", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, layout, VIEW, { ratio: 1, highlight: { net: "net.GND" } })
    const copper = records.filter((r) => r.name === "fill" && r.fillStyle === PALETTE.topCopper)
    const lit = records.filter((r) => r.name === "fill" && r.fillStyle === PALETTE.highlight)
    expect(copper.length).toBeGreaterThan(0)
    expect(copper.every((r) => r.globalAlpha === 0.3)).toBe(true)
    expect(lit.length).toBe(2)
    expect(lit.every((r) => r.globalAlpha === 1)).toBe(true)
  })

  test("ratsnest lines are drawn by default and left out when switched off", () => {
    const on = recorder()
    drawPcb(on.ctx, layout, VIEW, { ratio: 1 })
    const lines = on.records.filter((r) => r.name === "stroke" && r.strokeStyle === PALETTE.ratsnest)
    expect(lines).toHaveLength(layout.ratsnest.length)
    expect(lines.every((r) => r.globalAlpha === 0.6)).toBe(true)
    const off = recorder()
    drawPcb(off.ctx, layout, VIEW, { ratio: 1, ratsnest: false })
    expect(off.records.some((r) => r.strokeStyle === PALETTE.ratsnest)).toBe(false)
  })

  test("a moving part carries its ratsnest ends with it", () => {
    const at = (moving?: { component: string; by: { x: number; y: number } }) => {
      const { ctx, records } = recorder()
      drawPcb(ctx, layout, VIEW, { ratio: 1, ...(moving ? { moving } : {}) })
      return records.filter((r) => r.name === "moveTo" && r.strokeStyle === PALETTE.ratsnest).map((r) => r.args)
    }
    const still = at()
    const moved = at({ component: "R1", by: { x: 1, y: 0 } })
    expect(still).toHaveLength(2)
    expect(moved.map((a) => a[0])).toEqual(still.map((a) => (a[0] as number) + 1))
  })

  test("reference designators are silkscreen text above the courtyard", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, layout, VIEW, { ratio: 1 })
    const texts = records.filter((r) => r.name === "fillText")
    expect(texts.map((r) => r.args[0]).sort()).toEqual(["J1", "R1", "R2"])
    expect(texts.every((r) => r.fillStyle === PALETTE.topSilk)).toBe(true)
  })

  test("designators are skipped when they would be too small to read", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, layout, { ...VIEW, camera: { ...VIEW.camera, scale: 1 } }, { ratio: 1 })
    expect(records.some((r) => r.name === "fillText")).toBe(false)
  })

  test("an auto-placed part is drawn at 60% alpha with its courtyard dashed, even with courtyards hidden", () => {
    const auto = buildDesign(
      {
        "main.circuit.tsx": `export default () => (
          <board width="30mm" height="18mm">
            <resistor name="R1" resistance="1k" footprint="0402" pcbX={-4} pcbY={2} />
            <resistor name="R2" resistance="1k" footprint="0402" />
          </board>
        )`,
      },
      "main.circuit.tsx",
    ).pcb
    expect(auto.parts.map((p) => [p.component, p.autoPlaced])).toEqual([
      ["R1", false],
      ["R2", true],
    ])
    const { ctx, records } = recorder()
    drawPcb(ctx, auto, VIEW, { ratio: 1, layers: { courtyard: false } })
    const copper = records.filter((r) => r.name === "fill" && r.fillStyle === PALETTE.topCopper)
    expect(copper.map((r) => r.globalAlpha).sort()).toEqual([0.6, 0.6, 1, 1])
    const courtyards = records.filter((r) => r.name === "stroke" && r.strokeStyle === PALETTE.courtyard)
    expect(courtyards).toHaveLength(1)
    expect(records.some((r) => r.name === "setLineDash" && (r.args[0] as number[]).length > 0)).toBe(true)
    const r2 = records.find((r) => r.name === "fillText" && r.args[0] === "R2")
    expect(r2?.globalAlpha).toBe(0.6)
  })

  test("a board with nothing in it still draws", () => {
    const { ctx, calls } = recorder()
    drawPcb(ctx, { parts: [], ratsnest: [] }, VIEW, { ratio: 1 })
    expect(calls).toContain("save")
    expect(calls).toContain("restore")
  })
})

describe("padAt", () => {
  test("finds R1 pad 1 at its centre and nothing 5 mm away", () => {
    const p = pad("R1#1")
    expect(padAt(layout, { x: p.x, y: p.y })?.id).toBe("R1#1")
    expect(padAt(layout, { x: p.x + 5, y: p.y })).toBeUndefined()
  })

  test("respects the pad's rotation", () => {
    const long = { ...pad("R1#1"), x: 0, y: 0, width: 2, height: 0.5, rotation: 90 }
    const turned = { ...layout, parts: [{ ...(layout.parts[0] as (typeof layout.parts)[number]), pads: [long] }] }
    expect(padAt(turned, { x: 0, y: 0.9 })?.id).toBe("R1#1")
    expect(padAt(turned, { x: 0.9, y: 0 })).toBeUndefined()
  })

  test("hits a round pad inside its radius only", () => {
    const p = pad("J1#2")
    expect(padAt(layout, { x: p.x + p.width / 2 - 0.01, y: p.y })?.id).toBe("J1#2")
    expect(padAt(layout, { x: p.x + p.width / 2 + 0.05, y: p.y })).toBeUndefined()
  })
})

describe("pcbBoxes", () => {
  test("gives one box per part, named by its component", () => {
    const boxes = pcbBoxes(layout)
    expect(boxes.map((b) => b.pcbComponentId)).toEqual(layout.parts.map((p) => p.component))
    const r1 = boxes.find((b) => b.pcbComponentId === "R1")
    const part = layout.parts.find((p) => p.component === "R1")
    expect(r1?.box.minX).toBe(Math.min(...(part?.courtyard.map((c) => c.x) ?? [])))
    expect(r1?.center.x).toBeCloseTo(-4, 5)
  })
})

describe("keepouts", () => {
  const withKeepout = buildDesign({ "main.circuit.tsx": CIRCUIT.replace("</board>", '<keepout pcbX={10} pcbY={0} width={4} height={4} /></board>') }, "main.circuit.tsx").pcb

  test("a keepout is stroked in the keepout colour, dashed, before the copper", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, withKeepout, VIEW, { ratio: 1 })
    const strokes = records.filter((r) => r.name === "stroke" && r.strokeStyle === PALETTE.keepout)
    expect(strokes.length).toBeGreaterThan(1)
    expect(strokes.every((r) => r.globalAlpha === 0.7)).toBe(true)
    const first = records.findIndex((r) => r.name === "stroke" && r.strokeStyle === PALETTE.keepout)
    const copper = records.findIndex((r) => r.name === "fill" && r.fillStyle === PALETTE.topCopper)
    expect(first).toBeLessThan(copper)
  })

  test("a board without keepouts draws none", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, layout, VIEW, { ratio: 1 })
    expect(records.some((r) => r.strokeStyle === PALETTE.keepout)).toBe(false)
  })
})
