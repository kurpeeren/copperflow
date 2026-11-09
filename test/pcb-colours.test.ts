import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { PALETTE } from "../studio/src/pcb/ctx.js"
import { drawGrid, PCB_LOOK } from "../studio/src/pcb/overlays.js"
import { drawPcb } from "../studio/src/pcb/pcb-draw.js"
import { recorder } from "./helpers/fake-ctx.js"

const CIRCUIT = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-4} pcbY={2} />
    <chip name="J1" footprint="pinrow2_p2.54mm" pinCount={2} pcbX={0} pcbY={6} />
  </board>
)`
const layout = buildDesign({ "main.circuit.tsx": CIRCUIT }, "main.circuit.tsx").pcb
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
})
