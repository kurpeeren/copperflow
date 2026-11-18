// A board text appears, placed and sized alike, everywhere the silkscreen goes: the Gerber legend files, the
// board-as-made pictures (and through them the 3D texture) and the Studio's PCB view.
import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { gerberFiles } from "../src/engine/fab/layers.js"
import { boardPicture } from "../src/engine/fab/picture/board-picture.js"
import { silkTextBox, silkTextLineWidth } from "../src/engine/fab/silk-text-strokes.js"
import type { Point, SilkText } from "../src/engine/model.js"
import { solidModel } from "../src/engine/solid/model.js"
import { boardTextures } from "../studio/src/look/texture.js"
import { PALETTE } from "../studio/src/pcb/ctx.js"
import { drawPcb } from "../studio/src/pcb/pcb-draw.js"
import { recorder } from "./helpers/fake-ctx.js"
import { readGerber } from "./helpers/gerber-read.js"

const MAIN = "main.circuit.tsx"
const CREATED = new Date(Date.UTC(2026, 10, 18, 12, 0, 0))
const circuit = (texts: string) => `export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-10} pcbY={-6} />
    ${texts}
  </board>
)`

const withText = buildDesign({ [MAIN]: circuit(`<silkscreentext text="BOARD 1" x={2} y={3} height={2} /><silkscreentext text="under" x={0} y={-4} layer="bottom" height={1.5} />`) }, MAIN)
const without = buildDesign({ [MAIN]: circuit("") }, MAIN)
const [topText, bottomText] = withText.pcb.silkTexts as [SilkText, SilkText]

const silkFile = (design: typeof withText, side: "F" | "B") =>
  readGerber(gerberFiles(design.pcb, design.rules.fabrication, "b", CREATED).find((f) => f.file.startsWith(`b-${side}_Silkscreen.`))?.text ?? "")
/** The draws made with a round aperture of this diameter. */
const drawnWith = (file: ReturnType<typeof silkFile>, diameter: number) => file.strokes.filter((s) => Math.abs(Number(s.aperture.shape["diameter"]) - diameter) < 1e-6)
const inside = (box: ReturnType<typeof silkTextBox>, p: Point) => p.x >= box.minX - 1e-6 && p.x <= box.maxX + 1e-6 && p.y >= box.minY - 1e-6 && p.y <= box.maxY + 1e-6

describe("the Gerber silkscreen files", () => {
  test("gain the text's draws inside its box, at its line width, each on its own side", () => {
    expect(withText.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    const [top, plainTop] = [silkFile(withText, "F"), silkFile(without, "F")]
    const added = drawnWith(top, silkTextLineWidth(2))
    expect(top.strokes.length).toBeGreaterThan(plainTop.strokes.length)
    expect(added.length).toBeGreaterThan(5)
    expect(added.every((s) => s.points.every((p) => inside(silkTextBox(topText), p)))).toBe(true)
    const bottom = drawnWith(silkFile(withText, "B"), silkTextLineWidth(1.5))
    expect(bottom.length).toBeGreaterThan(3)
    expect(bottom.every((s) => s.points.every((p) => inside(silkTextBox(bottomText), p)))).toBe(true)
  })
})

/** How many pixels of the picture differ between the two designs inside the board box. */
function changedIn(a: ReturnType<typeof boardPicture>, b: ReturnType<typeof boardPicture>, box: ReturnType<typeof silkTextBox>): { inside: number; outside: number } {
  let [inBox, outBox] = [0, 0]
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4
      if (a.rgba[i] === b.rgba[i] && a.rgba[i + 1] === b.rgba[i + 1] && a.rgba[i + 2] === b.rgba[i + 2]) continue
      const mm = { x: (a.mirrored ? a.origin.x - x - 0.5 : x + 0.5 - a.origin.x) * a.mmPerPx, y: (a.origin.y - y - 0.5) * a.mmPerPx }
      if (inside({ minX: box.minX - a.mmPerPx, minY: box.minY - a.mmPerPx, maxX: box.maxX + a.mmPerPx, maxY: box.maxY + a.mmPerPx }, mm)) inBox++
      else outBox++
    }
  }
  return { inside: inBox, outside: outBox }
}

describe("the board-as-made pictures", () => {
  test("change only inside the text's box, on its own side, the bottom one seen mirrored from below", () => {
    const top = changedIn(boardPicture(withText, { side: "top", pxPerMm: 10 }), boardPicture(without, { side: "top", pxPerMm: 10 }), silkTextBox(topText))
    expect(top.inside).toBeGreaterThan(50)
    expect(top.outside).toBe(0)
    const bottom = changedIn(boardPicture(withText, { side: "bottom", pxPerMm: 10 }), boardPicture(without, { side: "bottom", pxPerMm: 10 }), silkTextBox(bottomText))
    expect(bottom.inside).toBeGreaterThan(30)
    expect(bottom.outside).toBe(0)
  })

  test("the 3D view's board texture carries the text", () => {
    const textures = boardTextures(withText, solidModel(withText), {})
    const plain = boardTextures(without, solidModel(without), {})
    const [a, b] = [textures.top?.rgba, plain.top?.rgba]
    expect(a?.length).toBe(b?.length)
    expect(a?.some((v, i) => v !== b?.[i])).toBe(true)
  })
})

describe("the Studio's PCB view", () => {
  const VIEW = { camera: { cx: 0, cy: 0, scale: 20 }, size: { width: 800, height: 600 } }
  const textLines = (records: ReturnType<typeof recorder>["records"], colour: string, width: number) =>
    records.filter((r) => r.name === "stroke" && r.strokeStyle === colour && r.lineWidth === width)

  test("draws each text's strokes in its side's silk colour, and hides them with that silk layer", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, withText.pcb, VIEW, { ratio: 1 })
    expect(textLines(records, PALETTE.topSilk, silkTextLineWidth(2)).length).toBeGreaterThan(5)
    expect(textLines(records, PALETTE.bottomSilk, silkTextLineWidth(1.5)).length).toBeGreaterThan(3)
    const hidden = recorder()
    drawPcb(hidden.ctx, withText.pcb, VIEW, { ratio: 1, layers: { topSilk: false } })
    expect(textLines(hidden.records, PALETTE.topSilk, silkTextLineWidth(2))).toEqual([])
  })

  test("rings a selected text", () => {
    const { ctx, records } = recorder()
    drawPcb(ctx, withText.pcb, VIEW, { ratio: 1, silkTexts: { selected: new Set([topText.id]) } })
    expect(records.some((r) => r.name === "stroke" && r.strokeStyle === PALETTE.selection)).toBe(true)
  })
})
