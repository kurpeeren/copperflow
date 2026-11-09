import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { gridSteps } from "../studio/src/pcb/geometry.js"
import { PALETTE } from "../studio/src/pcb/ctx.js"
import { drawGrid, drawOutline, PCB_LOOK } from "../studio/src/pcb/overlays.js"
import { drawPcb } from "../studio/src/pcb/pcb-draw.js"
import { recorder } from "./helpers/fake-ctx.js"

const CIRCUIT = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-4} pcbY={2} />
    <chip name="J1" footprint="pinrow2_p2.54mm" pinCount={2} pcbX={0} pcbY={6} />
  </board>
)`
const layout = buildDesign({ "main.circuit.tsx": CIRCUIT }, "main.circuit.tsx").pcb
const WIRED = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-4} pcbY={2} />
    <resistor name="R2" resistance="1k" footprint="0402" pcbX={4} pcbY={-2} />
    <trace from=".R1 > .pin1" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.GND" />
    <trace from=".R1 > .pin2" to=".R2 > .pin2" />
  </board>
)`
const BOTTOM = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={0} pcbY={0} layer="bottom" />
  </board>
)`
const wired = buildDesign({ "main.circuit.tsx": WIRED }, "main.circuit.tsx").pcb
const bottom = buildDesign({ "main.circuit.tsx": BOTTOM }, "main.circuit.tsx").pcb
const VIEW = { camera: { cx: 0, cy: 0, scale: 20 }, size: { width: 800, height: 600 } }

describe("PCB colours (spec section 6)", () => {
  test("the palette holds EasyEDA's default PCB theme", () => {
    expect(PALETTE).toMatchObject({
      background: "#000000",
      boardEdge: "#ff00ff",
      topCopper: "#ff0000",
      bottomCopper: "#0000ff",
      multiLayer: "#c0c0c0",
      viaRing: "#c0c0c0",
      highlight: "#ffffff",
      drill: "#222222",
      topSilk: "#ffcc00",
      bottomSilk: "#66cc33",
      topAssembly: "#33cc99",
      bottomAssembly: "#5555ff",
      ratsnest: "#6464ff",
      keepout: "#f022f0",
    })
  })

  test("the overlay look is white selection with a cyan dotted box", () => {
    expect(PCB_LOOK.selected).toBe("#ffffff")
    expect(PCB_LOOK.selectedFill).toBe("rgb(255 255 255 / 50%)")
    expect(PCB_LOOK.noteStroke).toBe("#00ffff")
    expect(PCB_LOOK.noteDash).toEqual([1, 3])
  })

  test("the grid is white, 30% on minor lines and 50% on every fifth", () => {
    const { ctx, records } = recorder()
    drawGrid(ctx, { cx: 0, cy: 0, scale: 20 }, { width: 400, height: 300 })
    const colours = new Set(records.filter((r) => r.name === "stroke").map((r) => r.strokeStyle))
    expect(colours).toEqual(new Set(["rgb(255 255 255 / 30%)", "rgb(255 255 255 / 50%)"]))
  })

  test("plated pads are multi-layer grey, top SMD pads red, no board fill", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, layout, VIEW, { ratio: 1 })
    const fills = new Set(records.filter((r) => r.name === "fill").map((r) => r.fillStyle))
    expect(fills.has("#c0c0c0")).toBe(true)
    expect(fills.has("#ff0000")).toBe(true)
    expect(fills.has("#222222")).toBe(true)
    expect(records.some((r) => r.name === "fill" && r.fillStyle === "#15231b")).toBe(false)
  })

  test("a lit pad keeps its layer colour and gains a white wash and outline", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, wired, VIEW, { ratio: 1, highlight: { nets: ["net.GND"] } })
    const washes = records.filter((r) => r.name === "fill" && r.fillStyle === "#ffffff")
    const outlines = records.filter((r) => r.name === "stroke" && r.strokeStyle === "#ffffff" && Math.abs(r.lineWidth - 1.5 / 20) < 1e-9)
    expect(washes.length).toBeGreaterThan(0)
    expect(washes.every((r) => r.globalAlpha === 0.35)).toBe(true)
    expect(outlines).toHaveLength(washes.length)
    expect(records.some((r) => r.name === "fill" && r.fillStyle === "#ff0000" && r.globalAlpha === 1)).toBe(true)
  })

  test("the ratsnest of a lit net is white at full alpha, the others dim", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, wired, VIEW, { ratio: 1, highlight: { nets: ["net.GND"] } })
    const lines = records.filter((r) => r.name === "stroke" && (r.strokeStyle === "#ffffff" || r.strokeStyle === "#6464ff") && r.lineWidth === 1 / 20)
    expect(lines.filter((r) => r.strokeStyle === "#ffffff").every((r) => r.globalAlpha === 1)).toBe(true)
    expect(lines.filter((r) => r.strokeStyle === "#6464ff").every((r) => r.globalAlpha === 0.3)).toBe(true)
    expect(lines.some((r) => r.strokeStyle === "#ffffff")).toBe(true)
  })

  test("a selection outline gets the 50% white wash", () => {
    const { ctx, records } = recorder()
    const box = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
    drawOutline(ctx, { cx: 0, cy: 0, scale: 20 }, { width: 400, height: 300 }, box, { x: 0, y: 0 }, "selected", PCB_LOOK)
    const wash = records.find((r) => r.name === "fillRect")
    expect(wash?.fillStyle).toBe("rgb(255 255 255 / 50%)")
    expect(records.find((r) => r.name === "strokeRect")?.strokeStyle).toBe("#ffffff")
  })

  test("a bottom part uses the bottom copper, silk and assembly colours", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, bottom, VIEW, { ratio: 1 })
    expect(bottom.parts[0]?.side).toBe("bottom")
    expect(records.some((r) => r.name === "fill" && r.fillStyle === "#0000ff")).toBe(true)
    expect(records.some((r) => r.name === "fillText" && r.fillStyle === "#66cc33")).toBe(true)
    expect(records.some((r) => r.name === "stroke" && r.strokeStyle === "#5555ff")).toBe(true)
  })

  test("every fifth grid line is the 50% one", () => {
    const { ctx, records } = recorder()
    const camera = { cx: 0, cy: 0, scale: 20 }
    drawGrid(ctx, camera, { width: 400, height: 300 })
    const minor = gridSteps(camera.scale).minor * camera.scale
    const verticals = records.filter((r) => r.name === "moveTo" && r.args[1] === 0)
    const strong = verticals.filter((r) => r.strokeStyle === "rgb(255 255 255 / 50%)").map((r) => (r.args[0] as number) - 0.5)
    expect(strong.length).toBeGreaterThan(0)
    for (const x of strong) expect(Math.abs(Math.round((x - 200) / minor / 5) * 5 * minor - (x - 200))).toBeLessThan(1)
    expect(verticals.filter((r) => r.strokeStyle === "rgb(255 255 255 / 30%)").length).toBeGreaterThan(strong.length)
  })

  test("violation rings get a white outer and a black inner halo on the PCB", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, layout, VIEW, { ratio: 1, violations: [{ id: "v", at: { x: 0, y: 0 }, severity: "error" }] })
    const arcs = records.filter((r) => r.name === "arc" && [r.strokeStyle].some((c) => c === "#ffffff" || c === "#000000" || c === "#e5534b"))
    expect(arcs.map((r) => r.strokeStyle)).toEqual(["#ffffff", "#000000", "#e5534b"])
    expect(arcs.map((r) => r.args[2] as number)).toEqual([6 + 1.25, 6 - 1.25, 6])
  })
})
