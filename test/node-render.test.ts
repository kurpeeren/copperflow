import { describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { loadImage, createCanvas } from "@napi-rs/canvas"
import { buildDesign } from "../src/engine/design.js"
import { renderDesign } from "../studio/src/render/node-render.js"
import { PALETTE } from "../studio/src/pcb/ctx.js"
import { CAN_MAIN, filesIn } from "./helpers/place-fixtures.js"

const PROOF = fileURLToPath(new URL("./fixtures/can-proof-3", import.meta.url))
const DEMO = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`

/** The colours of the decoded picture, as "#rrggbb", each with how many pixels have it. */
async function colours(png: Uint8Array): Promise<{ width: number; height: number; counts: Map<string, number> }> {
  const image = await loadImage(Buffer.from(png))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext("2d")
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(0, 0, image.width, image.height).data
  const counts = new Map<string, number>()
  for (let i = 0; i < data.length; i += 4) {
    const key = hex(data[i] as number, data[i + 1] as number, data[i + 2] as number)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return { width: image.width, height: image.height, counts }
}

describe("render in Node", () => {
  const design = buildDesign(filesIn(PROOF), CAN_MAIN)

  test("the PCB: a PNG of the width asked for, the height from the board's shape, with outline, pad and background colours", async () => {
    const rendered = await renderDesign(design, { view: "pcb", width: 800 })
    expect([...rendered.png.slice(0, 8)]).toEqual(PNG_SIGNATURE)
    const outline = design.pcb.board?.outline ?? []
    const across = Math.max(...outline.map((p) => p.x)) - Math.min(...outline.map((p) => p.x))
    const down = Math.max(...outline.map((p) => p.y)) - Math.min(...outline.map((p) => p.y))
    expect(rendered.width).toBe(800)
    // A margin of 4% of the longer side all round.
    const pad = 2 * 0.04 * Math.max(across, down)
    expect(rendered.height).toBe(Math.round((800 * (down + pad)) / (across + pad)))
    expect(rendered.what).toMatch(/^PCB, whole board [\d.]+ x [\d.]+ mm$/)
    const picture = await colours(rendered.png)
    expect([picture.width, picture.height]).toEqual([rendered.width, rendered.height])
    expect(picture.counts.get(PALETTE.background) ?? 0).toBeGreaterThan(0)
    expect(picture.counts.get(PALETTE.boardEdge) ?? 0).toBeGreaterThan(0)
    expect((picture.counts.get(PALETTE.topCopper) ?? 0) + (picture.counts.get(PALETTE.multiLayer) ?? 0)).toBeGreaterThan(0)
  })

  test("parts zoom to a different picture that names them", async () => {
    const whole = await renderDesign(design, { view: "pcb", width: 640 })
    const zoomed = await renderDesign(design, { view: "pcb", parts: ["U1"], width: 640 })
    expect(zoomed.what).toBe("PCB, around U1")
    expect(Buffer.from(zoomed.png).equals(Buffer.from(whole.png))).toBe(false)
  })

  test("a schematic page renders on the light sheet; a missing page or part is refused by name; a page for the PCB is refused", async () => {
    const demo = buildDesign(filesIn(DEMO), "index.circuit.tsx")
    const sheet = await renderDesign(demo, { view: "schematic" })
    expect(sheet.what).toBe('Schematic page "Main"')
    expect(sheet.page).toBe("Main")
    expect(sheet.width).toBe(1024)
    expect((await colours(sheet.png)).counts.size).toBeGreaterThan(2)
    await expect(renderDesign(demo, { view: "schematic", page: "Power" })).rejects.toThrow('No schematic page "Power"; the pages are "Main"')
    await expect(renderDesign(demo, { view: "schematic", parts: ["Q9"] })).rejects.toThrow('No part named Q9 on page "Main"')
    await expect(renderDesign(design, { view: "pcb", parts: ["U1", "X7", "X8"] })).rejects.toThrow("No parts named X7, X8 on the board")
    await expect(renderDesign(design, { view: "pcb", page: "Main" })).rejects.toThrow("page is for the schematic only")
    await expect(renderDesign(design, { view: "pcb", width: 100 })).rejects.toThrow("width must be a whole number of pixels from 320 to 2000")
  })
})
