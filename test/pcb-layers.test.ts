import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { PALETTE } from "../studio/src/pcb/ctx.js"
import { pcbNetAt } from "../studio/src/pcb/highlight.js"
import { drawPcb, padAt } from "../studio/src/pcb/pcb-draw.js"
import {
  DEFAULT_LAYERS,
  anyLayerShown,
  layerRows,
  padLayer,
  partLayers,
  swatchBackground,
  toggleLayer,
  type LayerId,
} from "../studio/src/pcb/layers.js"
import { recorder } from "./helpers/fake-ctx.js"

const CIRCUIT = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-4} pcbY={2} />
    <chip name="J1" footprint="pinrow2_p2.54mm" pinCount={2} pcbX={0} pcbY={6} />
    <trace from=".R1 > .pin1" to=".J1 > .pin1" />
  </board>
)`
const design = buildDesign({ "main.circuit.tsx": CIRCUIT }, "main.circuit.tsx")
const layout = design.pcb
const VIEW = { camera: { cx: 0, cy: 0, scale: 20 }, size: { width: 800, height: 600 } }
const part = (name: string) => {
  const found = layout.parts.find((p) => p.component === name)
  if (!found) throw new Error(`no part ${name}`)
  return found
}

describe("the layer list", () => {
  test("lists the eleven layers the PCB draws, in the panel's order, with their palette colours", () => {
    const rows = layerRows(false, "all")
    expect(rows.map((row) => row.name)).toEqual([
      "Top Layer", "Bottom Layer", "Top Silkscreen", "Bottom Silkscreen", "Top Assembly", "Bottom Assembly", "Courtyard", "Board Outline", "Multi-Layer", "Hole", "Ratline",
    ])
    expect(rows.find((row) => row.id === "top")?.color).toBe(PALETTE.topCopper)
    expect(rows.find((row) => row.id === "boardOutline")?.color).toBe(PALETTE.boardEdge)
    expect(rows.find((row) => row.id === "ratline")?.color).toBe(PALETTE.ratsnest)
  })

  test("the Courtyard swatch shows the top and the bottom courtyard colours, since each side draws in its own", () => {
    const courtyard = layerRows(false, "all").find((row) => row.id === "courtyard")
    expect(courtyard).toMatchObject({ color: PALETTE.topAssembly, bottomColor: PALETTE.bottomAssembly })
    expect(courtyard && swatchBackground(courtyard)).toBe(`linear-gradient(135deg, ${PALETTE.topAssembly} 50%, ${PALETTE.bottomAssembly} 50%)`)
    expect(swatchBackground({ color: PALETTE.topCopper })).toBe(PALETTE.topCopper)
    expect(layerRows(false, "all").filter((row) => row.bottomColor).map((row) => row.id)).toEqual(["courtyard"])
  })

  test("Keepout is listed only when the board has keepouts", () => {
    expect(layerRows(false, "all").some((row) => row.id === "keepout")).toBe(false)
    expect(layerRows(true, "all").at(-1)).toMatchObject({ id: "keepout", name: "Keepout", color: PALETTE.keepout })
  })

  test("Copper holds the two copper layers and Multi-Layer; Non-copper holds the rest", () => {
    expect(layerRows(true, "copper").map((row) => row.name)).toEqual(["Top Layer", "Bottom Layer", "Multi-Layer"])
    const other = layerRows(true, "non-copper").map((row) => row.name)
    expect(other).toEqual(["Top Silkscreen", "Bottom Silkscreen", "Top Assembly", "Bottom Assembly", "Courtyard", "Board Outline", "Hole", "Ratline", "Keepout"])
    expect(layerRows(true, "all")).toHaveLength(12)
  })
})

describe("layer visibility", () => {
  test("every layer starts shown except the two assembly layers, so the board looks as it always has", () => {
    expect(Object.entries(DEFAULT_LAYERS).filter(([, shown]) => !shown).map(([id]) => id)).toEqual(["topAssembly", "bottomAssembly"])
    expect(DEFAULT_LAYERS.courtyard).toBe(true)
  })

  test("toggling one layer returns a new record and leaves the rest", () => {
    const hidden = toggleLayer(DEFAULT_LAYERS, "topSilk")
    expect(hidden).not.toBe(DEFAULT_LAYERS)
    expect(hidden.topSilk).toBe(false)
    expect(DEFAULT_LAYERS.topSilk).toBe(true)
    expect(Object.entries(hidden).filter(([, shown]) => !shown)).toHaveLength(3)
    expect(toggleLayer(hidden, "topSilk")).toEqual(DEFAULT_LAYERS)
  })
})

describe("the layers a part draws", () => {
  test("a surface-mount part draws only the layers of its side", () => {
    const layers = partLayers(part("R1"))
    expect(layers).toEqual(expect.arrayContaining<LayerId>(["top", "topAssembly"]))
    expect(layers).not.toContain("bottom")
    expect(layers).not.toContain("hole")
  })

  test("a through-hole part draws Multi-Layer and Hole", () => {
    expect(partLayers(part("J1"))).toEqual(expect.arrayContaining<LayerId>(["multiLayer", "hole"]))
  })

  test("every part draws its courtyard, and fabrication only where it has an outline", () => {
    expect(partLayers(part("R1"))).toContain("courtyard")
  })

  test("a part shows while any layer it draws is shown", () => {
    const layers = partLayers(part("R1"))
    const hiddenAll = Object.fromEntries(Object.keys(DEFAULT_LAYERS).map((id) => [id, false])) as typeof DEFAULT_LAYERS
    expect(anyLayerShown(layers, hiddenAll)).toBe(false)
    expect(anyLayerShown(layers, { ...hiddenAll, top: true })).toBe(true)
  })
})

describe("what each layer hides in the draw", () => {
  const fillsOf = (colour: string, layers?: Partial<Record<LayerId, boolean>>) => {
    const { ctx, records } = recorder()
    drawPcb(ctx, layout, VIEW, { ratio: 1, layers })
    return records.filter((r) => r.name === "fill" && r.fillStyle === colour)
  }

  test("a hidden Top Layer draws no #FF0000", () => {
    expect(fillsOf("#ff0000").length).toBeGreaterThan(0)
    expect(fillsOf("#ff0000", { top: false })).toHaveLength(0)
  })

  test("a hidden Multi-Layer draws no through pads, and a hidden Hole no drills", () => {
    expect(fillsOf(PALETTE.multiLayer).length).toBeGreaterThan(0)
    expect(fillsOf(PALETTE.multiLayer, { multiLayer: false })).toHaveLength(0)
    expect(fillsOf(PALETTE.drill).length).toBeGreaterThan(0)
    expect(fillsOf(PALETTE.drill, { hole: false })).toHaveLength(0)
    expect(fillsOf(PALETTE.drill, { multiLayer: false }).length).toBeGreaterThan(0)
  })

  const strokesOf = (colour: string, layers?: Partial<Record<LayerId, boolean>>) => {
    const { ctx, records } = recorder()
    drawPcb(ctx, layout, VIEW, { ratio: 1, layers })
    return records.filter((r) => r.name === "stroke" && r.strokeStyle === colour)
  }

  test("silkscreen, assembly, the board outline and the ratline each follow their own layer", () => {
    const cases: Array<[LayerId, string]> = [
      ["topSilk", PALETTE.topSilk],
      ["courtyard", PALETTE.topAssembly],
      ["boardOutline", PALETTE.boardEdge],
      ["ratline", PALETTE.ratsnest],
    ]
    for (const [id, colour] of cases) {
      expect([id, strokesOf(colour).length > 0]).toEqual([id, true])
      expect([id, strokesOf(colour, { [id]: false }).length]).toEqual([id, 0])
    }
  })

  test("Top Assembly draws only the fabrication outlines, which are off at first; the courtyards are on the Courtyard layer", () => {
    const strokes = (layers?: Partial<Record<LayerId, boolean>>) => strokesOf(PALETTE.topAssembly, layers).length
    const courtyards = strokes()
    expect(courtyards).toBeGreaterThan(0)
    expect(strokes({ topAssembly: true })).toBeGreaterThan(courtyards)
    expect(strokes({ courtyard: false, topAssembly: true })).toBeGreaterThan(0)
    expect(strokes({ courtyard: false })).toBe(0)
  })

  test("a hidden Top Silkscreen also hides the designators", () => {
    const text = (layers?: Partial<Record<LayerId, boolean>>) => {
      const { ctx, calls } = recorder()
      drawPcb(ctx, layout, VIEW, { ratio: 1, layers })
      return calls.filter((c) => c === "fillText").length
    }
    expect(text()).toBeGreaterThan(0)
    expect(text({ topSilk: false })).toBe(0)
  })
})

describe("what the pointer finds on hidden layers", () => {
  const pad = layout.parts.flatMap((p) => p.pads).find((p) => p.id === "R1#1")!
  const at = { x: pad.x, y: pad.y }

  test("a pad on a hidden layer is not under the pointer, and its net is not found", () => {
    expect(padAt(layout, at)?.id).toBe("R1#1")
    expect(padAt(layout, at, DEFAULT_LAYERS)?.id).toBe("R1#1")
    expect(padAt(layout, at, { ...DEFAULT_LAYERS, top: false })).toBeUndefined()
    expect(pcbNetAt(layout, at, { ...DEFAULT_LAYERS, top: false })).toBeUndefined()
  })

  test("a through pad follows Multi-Layer", () => {
    const through = layout.parts.flatMap((p) => p.pads).find((p) => p.id === "J1#2")!
    expect(padAt(layout, { x: through.x, y: through.y }, { ...DEFAULT_LAYERS, multiLayer: false })).toBeUndefined()
    expect(padLayer(through)).toBe("multiLayer")
  })
})
