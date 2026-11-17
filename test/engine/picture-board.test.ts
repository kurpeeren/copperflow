// The picture of a whole board: known places of a real board have the colours they should, the bottom is mirrored,
// and the scale the picture reports puts a board point on its pixel.
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { boardPicture, singleLayers } from "../../src/engine/fab/picture/board-picture.js"
import { gerberLayers } from "../../src/engine/fab/layers.js"
import { FINISHES, MASKS, SILKS } from "../../src/engine/fab/picture/looks.js"
import type { Point } from "../../src/engine/model.js"
import { board, OUTLINE, pad, part, throughPad } from "../helpers/fab-board.js"
import { filesIn } from "../helpers/place-fixtures.js"

const IO8 = fileURLToPath(new URL("../../examples/io-8", import.meta.url))
const PX_PER_MM = 40

type Picture = ReturnType<typeof boardPicture>

/** The colour at a board point, from the scale the picture reports. */
function colourAt(picture: Picture, p: Point): number[] {
  const x = Math.floor(picture.origin.x + (picture.mirrored ? -p.x : p.x) / picture.mmPerPx)
  const y = Math.floor(picture.origin.y - p.y / picture.mmPerPx)
  const i = (y * picture.width + x) * 4
  return [...picture.rgba.slice(i, i + 4)]
}

const close = (p: number[], rgb: readonly number[], tolerance: number) => rgb.every((v, i) => Math.abs((p[i] as number) - v) <= tolerance)
const brightness = (p: number[]) => (p[0] as number) + (p[1] as number) + (p[2] as number)

describe("the picture of io-8, top, at 40 px/mm", () => {
  const design = buildDesign(filesIn(IO8), "io-8.circuit.tsx")
  const picture = boardPicture(design, { side: "top", pxPerMm: PX_PER_MM })
  const layers = gerberLayers(design.pcb, design.rules.fabrication)
  const openings = layers.find((one) => one.name === "F_Mask")?.layer.objects ?? []

  test("covers the outline exactly, at the scale asked for, its origin where the board's 0, 0 is", () => {
    expect(picture.width).toBe(Math.ceil(43.4 * PX_PER_MM - 1e-9))
    expect(picture.mmPerPx).toBeCloseTo(1 / PX_PER_MM)
    expect(picture.box).toMatchObject({ minX: -20.8, maxY: 11.1 })
    expect(picture.origin.x).toBeCloseTo(20.8 * PX_PER_MM)
    expect(picture.origin.y).toBeCloseTo(11.1 * PX_PER_MM)
    expect(picture.rgba.length).toBe(picture.width * picture.height * 4)
  })

  test("an SMD pad's middle is the finish's colour", () => {
    const smd = design.pcb.parts.flatMap((one) => one.pads).find((one) => one.layers === "top" && one.drill === undefined && one.component.startsWith("R"))
    if (!smd) throw new Error("no SMD pad")
    expect(close(colourAt(picture, smd), FINISHES.enig.face, 45)).toBe(true)
  })

  test("a track's middle is copper under the mask: lighter than bare mask, not the finish", () => {
    const covered = (p: Point) =>
      !openings.some((object) => object.kind === "flash" && Math.hypot(object.at.x - p.x, object.at.y - p.y) < 2)
    const middle = design.pcb.tracks
      .filter((track) => track.layer === "top")
      .flatMap((track) => track.points.slice(1).map((b, i) => ({ a: track.points[i] as Point, b, width: track.width })))
      .filter(({ a, b }) => Math.hypot(b.x - a.x, b.y - a.y) > 3)
      .map(({ a, b }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }))
      .find(covered)
    if (!middle) throw new Error("no long track")
    const colour = colourAt(picture, middle)
    expect(close(colour, MASKS.green.onCopper, 30)).toBe(true)
    expect(brightness(colour)).toBeGreaterThan(brightness([...MASKS.green.over]) + 40)
  })

  test("a plated hole's middle is transparent", () => {
    const hole = design.pcb.parts.flatMap((one) => one.pads).find((one) => one.drill !== undefined)
    if (!hole) throw new Error("no plated hole")
    expect(colourAt(picture, hole)[3]).toBe(0)
  })

  test("a designator's stroke is the print's colour", () => {
    const silk = layers.find((one) => one.name === "F_Silkscreen")?.layer.objects ?? []
    // The designators come after the parts' outlines; a stroke of the last one, at its middle.
    const strokes = silk.flatMap((object) => (object.kind === "draw" ? [object.points] : []))
    const last = strokes.slice(-12).flatMap((points) => points.slice(1).map((b, i) => ({ a: points[i] as Point, b })))
    const long = last.sort((one, two) => Math.hypot(two.b.x - two.a.x, two.b.y - two.a.y) - Math.hypot(one.b.x - one.a.x, one.b.y - one.a.y))[0]
    if (!long) throw new Error("no designator")
    expect(close(colourAt(picture, { x: (long.a.x + long.b.x) / 2, y: (long.a.y + long.b.y) / 2 }), SILKS.white.colour, 30)).toBe(true)
  })

  test("outside the outline is transparent; each single layer has its own grey image", () => {
    const big = boardPicture(design, { side: "top", pxPerMm: 10, box: { minX: -22, minY: -14, maxX: 24, maxY: 12 } })
    expect(colourAt(big, { x: -21.5, y: 0 })[3]).toBe(0)
    expect(Object.keys(singleLayers(design, { side: "top", pxPerMm: 4 }))).toEqual(["body", "copper", "mask openings", "paste", "silkscreen", "plated holes", "unplated holes"])
  })
})

describe("the picture of a made-up board", () => {
  const holePad = throughPad("1", -5, 0, 1)
  const smd = pad("2", { x: 5, y: 2, width: 1.6, height: 1.2 })
  const design = {
    pcb: board({ parts: [part([holePad, smd])], holes: [{ id: "H1", x: 0, y: -2, diameter: 2, source: { file: "a.circuit.tsx", line: 1, column: 1, offset: 0 } }] }),
    rules: { fabrication: {} },
  } as unknown as Parameters<typeof boardPicture>[0]

  test("the bottom is seen from below: left and right swapped, the top's SMD pad not there", () => {
    const top = boardPicture(design, { side: "top", pxPerMm: 20 })
    const bottom = boardPicture(design, { side: "bottom", pxPerMm: 20 })
    expect(bottom.mirrored).toBe(true)
    expect(bottom.origin.x).toBeCloseTo(10 * 20)
    expect(close(colourAt(top, { x: 5, y: 2 }), FINISHES.enig.face, 45)).toBe(true)
    expect(close(colourAt(bottom, { x: 5, y: 2 }), FINISHES.enig.face, 45)).toBe(false)
    // The through pad's ring is on both sides, at its own place on the board: on the left from above, right from below.
    const ring = { x: -5 + 0.65, y: 0 }
    expect(close(colourAt(bottom, ring), FINISHES.enig.face, 60)).toBe(true)
    const rgbaX = (picture: Picture) => Math.floor(picture.origin.x + (picture.mirrored ? 5 : -5) / picture.mmPerPx)
    expect(rgbaX(top)).toBeLessThan(top.width / 2)
    expect(rgbaX(bottom)).toBeGreaterThan(bottom.width / 2)
  })

  test("a mounting hole's middle is transparent on both sides", () => {
    for (const side of ["top", "bottom"] as const) expect(colourAt(boardPicture(design, { side, pxPerMm: 20 }), { x: 0, y: -2 })[3]).toBe(0)
  })

  test("a board without an outline, or a picture over 4000 px, is refused", () => {
    const bare = { ...design, pcb: { ...design.pcb, board: { ...design.pcb.board, outline: [] } } } as unknown as typeof design
    expect(() => boardPicture(bare, {})).toThrow("The board has no outline to draw")
    expect(() => boardPicture(design, { pxPerMm: 201 })).toThrow("The picture would be 4020 x 2010 px; at most 4000 on its long side")
    expect(OUTLINE).toHaveLength(4)
  })
})
