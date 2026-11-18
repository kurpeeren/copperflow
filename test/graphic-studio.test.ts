// A board drawing in the Studio: drawn on the PCB canvas in its layer's colour and hidden with that layer, ringed when
// selected, picked under the pointer, moved by a drag as one edit, edited in Properties, deleted, and the File →
// Import a drawing answers read into a request. Plain logic and draw calls; no DOM.
import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { boardTextures } from "../studio/src/look/texture.js"
import { solidModel } from "../src/engine/solid/model.js"
import { PALETTE } from "../studio/src/pcb/ctx.js"
import { graphicAt } from "../studio/src/pcb/graphic-draw.js"
import { DEFAULT_LAYERS } from "../studio/src/pcb/layers.js"
import { drawPcb } from "../studio/src/pcb/pcb-draw.js"
import { boardFieldEdit, boardProperties } from "../studio/src/pcb/pour-props.js"
import { boardRemoval } from "../studio/src/pcb/pour-tool.js"
import { silkTextMove } from "../studio/src/pcb/silk-text-edit.js"
import { graphicImportRequest, readPickedDrawing, startForm } from "../studio/src/shell/graphic-import-form.js"
import { analyzeCircuit } from "../src/core/analyze.js"
import { recorder } from "./helpers/fake-ctx.js"

const MAIN = "main.circuit.tsx"
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="5mm" viewBox="0 0 10 5"><path d="M0 0 H10 V5 H0 Z M2 1 H4 V4 H2 Z" fill="black" fill-rule="evenodd"/></svg>`
const SOURCE = `export default () => (
  <board width="30mm" height="20mm">
    <boardgraphic file="graphics/logo.svg" layer="top-silkscreen" x={2} y={3} width={8} />
    <boardgraphic file="graphics/logo.svg" layer="bottom-mask" x={-6} y={-4} width={6} />
  </board>
)`
const design = buildDesign({ [MAIN]: SOURCE, "graphics/logo.svg": SVG }, MAIN)
const plain = buildDesign({ [MAIN]: SOURCE.replace(/<boardgraphic[^>]*\/>/g, ""), "graphics/logo.svg": SVG }, MAIN)
const VIEW = { camera: { cx: 0, cy: 0, scale: 20 }, size: { width: 800, height: 600 } }

describe("the PCB canvas", () => {
  test("fills the silkscreen drawing in the top silk colour and hides it with that layer", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, design.pcb, VIEW, { ratio: 1 })
    expect(records.some((r) => r.name === "fill" && r.fillStyle === PALETTE.topSilk && r.args[0] === "evenodd")).toBe(true)
    expect(records.some((r) => r.name === "fill" && r.fillStyle === PALETTE.bottomCopper && r.globalAlpha < 1)).toBe(true)
    const hidden = recorder()
    drawPcb(hidden.ctx, design.pcb, VIEW, { ratio: 1, layers: { topSilk: false } })
    expect(hidden.records.some((r) => r.name === "fill" && r.fillStyle === PALETTE.topSilk && r.args[0] === "evenodd")).toBe(false)
  })

  test("rings a selected drawing, and a point on it picks it", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, design.pcb, VIEW, { ratio: 1, silkTexts: { selected: new Set(["boardgraphic:1"]) } })
    expect(records.some((r) => r.name === "stroke" && r.strokeStyle === PALETTE.selection)).toBe(true)
    expect(graphicAt(design.pcb.graphics ?? [], { x: 2, y: 3 }, DEFAULT_LAYERS, 0)?.id).toBe("boardgraphic:1")
    expect(graphicAt(design.pcb.graphics ?? [], { x: 12, y: 3 }, DEFAULT_LAYERS, 0)).toBeUndefined()
  })

  test("a drawing on copper is drawn in its layer's copper colour, dimmed off the working layer and hidden with the layer", () => {
    const onCopper = buildDesign({ [MAIN]: SOURCE.replace('layer="top-silkscreen"', 'layer="top"'), "graphics/logo.svg": SVG }, MAIN)
    const fills = (records: ReturnType<typeof recorder>["records"]) => records.filter((r) => r.name === "fill" && r.fillStyle === PALETTE.topCopper && r.args[0] === "evenodd")
    const active = recorder()
    drawPcb(active.ctx, onCopper.pcb, VIEW, { ratio: 1 })
    expect(fills(active.records).map((r) => r.globalAlpha)).toEqual([1])
    const other = recorder()
    drawPcb(other.ctx, onCopper.pcb, VIEW, { ratio: 1, copper: { tracks: [], vias: [], selected: new Set(), activeLayer: "bottom" } as never })
    expect(fills(other.records).map((r) => r.globalAlpha)).toEqual([0.4])
    const hidden = recorder()
    drawPcb(hidden.ctx, onCopper.pcb, VIEW, { ratio: 1, layers: { top: false } })
    expect(fills(hidden.records)).toEqual([])
  })

  test("the 3D view's board texture carries the drawings", () => {
    const [a, b] = [boardTextures(design, solidModel(design), {}), boardTextures(plain, solidModel(plain), {})]
    expect(a.top?.rgba.some((v, i) => v !== b.top?.rgba[i])).toBe(true)
    expect(a.bottom?.rgba.some((v, i) => v !== b.bottom?.rgba[i])).toBe(true)
  })
})

describe("editing it", () => {
  const graphic = design.pcb.graphics![0]!

  test("a drag writes its new centre as one edit", () => {
    const move = silkTextMove(graphic, { id: graphic.id, start: { x: 0, y: 0 }, to: { x: 1.5, y: -1 }, moved: true })
    expect(move?.edit).toEqual({ kind: "setBoardGraphic", id: "boardgraphic:1", props: { x: 3.5, y: 2 } })
  })

  test("Properties shows its layer, place, size, turn and fill, and a changed row is one edit", () => {
    const rows = boardProperties(design, graphic.id)
    expect(rows?.title).toBe("Drawing")
    expect(rows?.rows.map((row) => `${row.label}=${row.value}`)).toEqual(["File=graphics/logo.svg", "Layer=top-silkscreen", "X (mm)=2", "Y (mm)=3", "Width (mm)=8", "Height (mm)=4", "Rotation (°)=0", "Fill=false"])
    expect(boardFieldEdit(design, graphic.id, "width", "12")).toEqual({ edit: { kind: "setBoardGraphic", id: graphic.id, props: { width: 12, scale: null } }, summary: "set boardgraphic:1 width=12" })
    expect((boardFieldEdit(design, graphic.id, "layer", "bottom-silkscreen") as { edit: unknown }).edit).toEqual({ kind: "setBoardGraphic", id: graphic.id, props: { layer: "bottom-silkscreen" } })
    expect((boardFieldEdit(design, graphic.id, "fill", "true") as { edit: unknown }).edit).toEqual({ kind: "setBoardGraphic", id: graphic.id, props: { fill: true } })
    expect(boardFieldEdit(design, graphic.id, "width", "-1")).toEqual({ message: "width must be above 0" })
  })

  test("Delete removes it", () => {
    const removal = boardRemoval(analyzeCircuit(SOURCE), new Set())(["boardgraphic:2"])
    expect(removal.edits).toEqual([{ kind: "removeBoardGraphic", id: "boardgraphic:2" }])
  })
})

describe("File → Import a drawing", () => {
  test("the dialog's request for the picked file: the chosen layer and the width, or why not (graphic-import-dialog.test.ts has the rest)", () => {
    const picked = readPickedDrawing("logo.svg", SVG)
    if ("message" in picked) throw new Error(picked.message)
    const form = startForm(picked)
    expect(graphicImportRequest(picked, { ...form, layer: "bottom-silkscreen" })).toEqual({ name: "logo.svg", text: SVG, layer: "bottom-silkscreen", width: 10, title: "logo" })
    expect(graphicImportRequest(picked, { ...form, layer: "top-mask", width: "12.5" })).toMatchObject({ layer: "top-mask", width: 12.5 })
    expect(graphicImportRequest(picked, { ...form, width: "wide" })).toEqual({ message: "The width must be a number of mm above 0" })
  })
})
