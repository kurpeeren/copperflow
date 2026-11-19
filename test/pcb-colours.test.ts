import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { PCB_DEFAULT_STEP, planGrid } from "../studio/src/pcb/grid.js"
import { PALETTE } from "../studio/src/pcb/ctx.js"
import { drawGrid, drawLockBadge, drawMark, drawNoteBox, drawOutline, drawSelectionBox, PCB_LOOK, SHEET_LOOK, type OverlayLook } from "../studio/src/pcb/overlays.js"
import { drawPcb } from "../studio/src/pcb/pcb-draw.js"
import { schematicTheme } from "../studio/src/pcb/schematic-theme.js"
import { SILK_WIDTH } from "../src/engine/fab/designators.js"
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
const PCB_GRID = { step: PCB_DEFAULT_STEP, style: "lines" } as const
/** The old warm overlay colours, from before the PCB took EasyEDA's theme. */
const OLD_WARM = ["#e0a46a", "#4f9a6c", "#e9e6df", "rgb(34 38 44 / 92%)"]

/** The colours a look's lock badge, note and note box are drawn in. */
function overlayColours(look: OverlayLook): Set<unknown> {
  const { ctx, records } = recorder()
  const camera = { cx: 0, cy: 0, scale: 20 }
  const size = { width: 400, height: 300 }
  drawLockBadge(ctx, camera, size, { minX: 0, minY: 0, maxX: 1, maxY: 1 }, look, 1)
  drawMark(ctx, camera, size, { at: { x: 2, y: 2 }, id: "N1", text: "route ground here" }, look, 1)
  drawNoteBox(ctx, { x: 10, y: 10 }, { x: 60, y: 40 }, look, 1)
  return new Set(records.flatMap((r) => (r.name === "fill" || r.name === "fillRect" || r.name === "fillText" ? [r.fillStyle] : r.name === "stroke" || r.name === "strokeRect" ? [r.strokeStyle] : [])))
}

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
      document: "#ffffff",
      grid: "rgb(255 255 255 / 30%)",
      gridFifth: "rgb(255 255 255 / 50%)",
      selection: "#ffffff",
      selectionFill: "rgb(255 255 255 / 50%)",
      hover: "rgb(255 255 255 / 60%)",
      selectionBox: "#00ffff",
      selectionBoxFill: "rgb(0 255 255 / 10%)",
      notePanel: "rgb(0 0 0 / 80%)",
      ringHaloOuter: "#ffffff",
      ringHaloInner: "#000000",
    })
  })

  test("the overlay look is white selection with a cyan dotted box, and notes and locks in white", () => {
    expect(PCB_LOOK).toEqual({
      selected: "#ffffff",
      selectedFill: "rgb(255 255 255 / 50%)",
      hover: "rgb(255 255 255 / 60%)",
      noteStroke: "#00ffff",
      noteFill: "rgb(0 255 255 / 10%)",
      noteDash: [1, 3],
      boxStroke: "#00ffff",
      boxFill: "rgb(0 255 255 / 10%)",
      boxDash: [1, 3],
      lockFill: "#ffffff",
      lockGlyph: "#000000",
      markPin: "#ffffff",
      markPanel: "rgb(0 0 0 / 80%)",
      markText: "#ffffff",
    })
  })

  test("every PCB overlay colour comes from the palette", () => {
    const colours = Object.values(PCB_LOOK).filter((v): v is string => typeof v === "string")
    for (const colour of colours) expect(Object.values(PALETTE)).toContain(colour)
  })

  test("the lock badge, note and note box draw in the PCB look, none in the old warm colours", () => {
    const colours = overlayColours(PCB_LOOK)
    expect(colours).toEqual(new Set([PALETTE.document, PALETTE.background, PALETTE.notePanel, PALETTE.selectionBox, PALETTE.selectionBoxFill]))
    for (const old of OLD_WARM) expect(colours.has(old)).toBe(false)
  })

  test("the PCB's CSS background is the palette's", () => {
    const css = readFileSync(new URL("../studio/src/styles.css", import.meta.url), "utf8")
    const theme = readFileSync(new URL("../studio/src/shell/theme.css", import.meta.url), "utf8")
    const block = css.slice(css.indexOf(".pcb-canvas {"))
    expect(block.slice(0, block.indexOf("}"))).toContain("background: var(--pcb-background)")
    expect(theme.toLowerCase()).toContain(`--pcb-background: ${PALETTE.background};`)
  })

  test("the grid is white, 30% on minor lines and 50% on every fifth", () => {
    const { ctx, records } = recorder()
    drawGrid(ctx, { cx: 0, cy: 0, scale: 20 }, { width: 400, height: 300 }, PCB_GRID, 1)
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
    drawOutline(ctx, { cx: 0, cy: 0, scale: 20 }, { width: 400, height: 300 }, box, { x: 0, y: 0 }, "selected", PCB_LOOK, 1)
    const wash = records.find((r) => r.name === "fillRect")
    expect(wash?.fillStyle).toBe("rgb(255 255 255 / 50%)")
    expect(records.find((r) => r.name === "strokeRect")?.strokeStyle).toBe("#ffffff")
  })

  test("a bottom part uses the bottom copper, silk and assembly colours", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, bottom, VIEW, { ratio: 1 })
    expect(bottom.parts[0]?.side).toBe("bottom")
    expect(records.some((r) => r.name === "fill" && r.fillStyle === "#0000ff")).toBe(true)
    expect(records.some((r) => r.name === "stroke" && r.strokeStyle === "#66cc33" && r.lineWidth === SILK_WIDTH)).toBe(true)
    expect(records.some((r) => r.name === "stroke" && r.strokeStyle === "#5555ff")).toBe(true)
  })

  test("every fifth grid line is the 50% one", () => {
    const { ctx, records } = recorder()
    const camera = { cx: 0, cy: 0, scale: 20 }
    drawGrid(ctx, camera, { width: 400, height: 300 }, PCB_GRID, 1)
    const minor = (planGrid(camera, { width: 400, height: 300 }, 0.5)?.spacing ?? 0) * camera.scale
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

/** The stroke colour and dash of a selection box dragged from `a` to `b`. */
function boxStroke(look: OverlayLook, mode: "inside" | "touching") {
  const { ctx, records } = recorder()
  drawSelectionBox(ctx, { x: 10, y: 10 }, { x: 60, y: 40 }, look, mode, 1)
  const stroke = records.find((r) => r.name === "strokeRect")
  return { colour: stroke?.strokeStyle, dash: records.filter((r) => r.name === "setLineDash").map((r) => r.args[0]) }
}

describe("the selection box", () => {
  test("on the PCB it is cyan: solid left to right, dotted right to left", () => {
    expect(boxStroke(PCB_LOOK, "inside")).toEqual({ colour: "#00ffff", dash: [[]] })
    expect(boxStroke(PCB_LOOK, "touching")).toEqual({ colour: "#00ffff", dash: [[1, 3]] })
  })

  test("on the schematic it is #0000FF: solid left to right, dashed right to left", () => {
    expect(schematicTheme.selectionBox).toBe("#0000FF")
    expect(boxStroke(SHEET_LOOK, "inside")).toEqual({ colour: "#0000FF", dash: [[]] })
    expect(boxStroke(SHEET_LOOK, "touching")).toEqual({ colour: "#0000FF", dash: [[5, 4]] })
  })
})

describe("schematic overlay look", () => {
  test("red selection and note box with a dashed edge, a blue selection box, and the sheet's own hover, lock and note colours", () => {
    expect(SHEET_LOOK).toEqual({
      selected: "#FF0000",
      hover: "rgb(255 0 0 / 45%)",
      noteStroke: "#FF0000",
      noteFill: "rgb(255 0 0 / 8%)",
      noteDash: [5, 4],
      boxStroke: "#0000FF",
      boxFill: "rgb(0 0 255 / 8%)",
      boxDash: [5, 4],
      lockFill: "#4f9a6c",
      lockGlyph: "#ffffff",
      markPin: "#e0a46a",
      markPanel: "rgb(34 38 44 / 92%)",
      markText: "#e9e6df",
    })
    expect(SHEET_LOOK.selectedFill).toBeUndefined()
  })

  test("every schematic overlay colour comes from the theme", () => {
    const colours = Object.values(SHEET_LOOK).filter((v): v is string => typeof v === "string")
    for (const colour of colours) expect(Object.values(schematicTheme)).toContain(colour)
  })

  test("the lock badge, note and note box draw in the sheet look, never in the PCB's white", () => {
    const colours = overlayColours(SHEET_LOOK)
    expect(colours).toEqual(new Set([schematicTheme.lockBadge, schematicTheme.lockGlyph, schematicTheme.notePanel, schematicTheme.noteText, schematicTheme.notePin, schematicTheme.selection, schematicTheme.selectionFill]))
  })

  test("a schematic selection outline is red with no wash", () => {
    const { ctx, records } = recorder()
    drawOutline(ctx, { cx: 0, cy: 0, scale: 20 }, { width: 400, height: 300 }, { minX: 0, minY: 0, maxX: 1, maxY: 1 }, { x: 0, y: 0 }, "selected", SHEET_LOOK, 1)
    expect(records.some((r) => r.name === "fillRect")).toBe(false)
    expect(records.find((r) => r.name === "strokeRect")?.strokeStyle).toBe(schematicTheme.selection)
  })
})
