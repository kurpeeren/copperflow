// The picture put together from coverage images made by hand, so each step's answer is known.
import { describe, expect, test } from "vitest"
import { bodyStep, compose, type SideImages } from "../../src/engine/fab/picture/compose.js"
import { FINISHES, lookWords, MASK_NAMES, MASKS, resolveLook, SILKS } from "../../src/engine/fab/picture/looks.js"
import type { Coverage } from "../../src/engine/fab/picture/raster.js"

const SIZE = 24

/** A coverage image full where `inside(x, y)`. */
const image = (inside: (x: number, y: number) => boolean = () => false): Coverage => {
  const data = new Float32Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) data[y * SIZE + x] = inside(x, y) ? 1 : 0
  return { width: SIZE, height: SIZE, data }
}

const all = () => image(() => true)
const square = (x0: number, y0: number, x1: number, y1: number) => image((x, y) => x >= x0 && x < x1 && y >= y0 && y < y1)

const blank = (fields: Partial<SideImages> = {}): SideImages => ({
  body: all(),
  copper: image(),
  otherCopper: image(),
  openings: image(),
  silk: image(),
  plated: image(),
  bore: image(),
  nonPlated: image(),
  ...fields,
})

/** The pixel's red, green, blue and alpha. */
const pixel = (rgba: Uint8ClampedArray, x: number, y: number) => [...rgba.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4)]
const brightness = (p: number[]) => (p[0] as number) + (p[1] as number) + (p[2] as number)
const near = (p: number[], rgb: readonly number[], tolerance: number) => rgb.every((v, i) => Math.abs((p[i] as number) - v) <= tolerance)

const look = resolveLook()
const PX_PER_MM = 10

describe("the picture put together", () => {
  test("print is cut where the mask is open, and over a hole", () => {
    const rgba = compose(blank({ silk: all(), openings: square(0, 0, 12, 24), copper: square(0, 0, 6, 24), nonPlated: square(18, 8, 22, 16) }), look, PX_PER_MM)
    expect(near(pixel(rgba, 15, 12), SILKS.white.colour, 12)).toBe(true)
    expect(near(pixel(rgba, 9, 12), SILKS.white.colour, 40)).toBe(false)
    expect(near(pixel(rgba, 3, 12), SILKS.white.colour, 40)).toBe(false)
    expect(pixel(rgba, 20, 12)[3]).toBe(0)
  })

  test("a plated hole: through in its middle, a dark barrel, a ring of the finish round it", () => {
    const ring = image((x, y) => Math.hypot(x - 11.5, y - 11.5) < 10)
    const plated = image((x, y) => Math.hypot(x - 11.5, y - 11.5) < 6)
    const bore = image((x, y) => Math.hypot(x - 11.5, y - 11.5) < 4.5)
    const rgba = compose(blank({ copper: ring, openings: ring, plated, bore }), look, PX_PER_MM)
    expect(pixel(rgba, 11, 11)[3]).toBe(0)
    const barrel = pixel(rgba, 11, 6)
    expect(barrel[3]).toBe(255)
    expect(brightness(barrel)).toBeLessThan(brightness([...FINISHES.enig.face]) * 0.6)
    expect(near(pixel(rgba, 11, 3), FINISHES.enig.face, 40)).toBe(true)
  })

  test("copper under the mask is lighter than the mask alone", () => {
    const rgba = compose(blank({ copper: square(0, 0, 12, 24) }), look, PX_PER_MM)
    expect(brightness(pixel(rgba, 6, 12))).toBeGreaterThan(brightness(pixel(rgba, 18, 12)) + 30)
    expect(near(pixel(rgba, 18, 12), MASKS.green.over, 25)).toBe(true)
  })

  test("light comes through the body only where both sides are bare", () => {
    const images = blank({ copper: square(0, 0, 12, 12), otherCopper: square(0, 12, 12, 24) })
    const rgb = bodyStep(images)
    const at = (x: number, y: number) => [0, 1, 2].map((c) => rgb[(y * SIZE + x) * 3 + c] as number)
    const bare = brightness(at(18, 6))
    expect(bare).toBeGreaterThan(brightness(at(6, 6)) + 30)
    expect(bare).toBeGreaterThan(brightness(at(6, 18)) + 30)
    expect(brightness(at(18, 18))).toBe(bare)
  })

  test("outside the body is transparent, or the background colour asked for", () => {
    const images = blank({ body: square(4, 4, 20, 20) })
    expect(pixel(compose(images, look, PX_PER_MM), 1, 1)[3]).toBe(0)
    expect(pixel(compose(images, resolveLook({ background: "#102030" }), PX_PER_MM), 1, 1)).toEqual([16, 32, 48, 255])
  })

  test("each mask colour, the print's colour and the finish change the picture as named", () => {
    const images = blank({ copper: square(0, 0, 12, 24), openings: square(0, 0, 6, 24), silk: square(14, 0, 24, 24) })
    for (const mask of MASK_NAMES) expect(near(pixel(compose(images, resolveLook({ mask }), PX_PER_MM), 20, 12), MASKS[mask].over, 30), mask).toBe(false)
    for (const mask of MASK_NAMES) expect(near(pixel(compose(blank(), resolveLook({ mask }), PX_PER_MM), 12, 12), MASKS[mask].over, 25), mask).toBe(true)
    expect(near(pixel(compose(images, resolveLook({ mask: "white" }), PX_PER_MM), 20, 12), SILKS.black.colour, 12)).toBe(true)
    expect(near(pixel(compose(images, resolveLook({ silk: "black" }), PX_PER_MM), 20, 12), SILKS.black.colour, 12)).toBe(true)
    expect(near(pixel(compose(images, resolveLook({ finish: "hasl" }), PX_PER_MM), 3, 12), FINISHES.hasl.face, 40)).toBe(true)
    expect(near(pixel(compose(images, look, PX_PER_MM), 3, 12), FINISHES.enig.face, 40)).toBe(true)
  })

  test("the look's words, defaults and refusals", () => {
    expect(lookWords(resolveLook())).toBe("green mask, ENIG")
    expect(lookWords(resolveLook({ mask: "white" }))).toBe("white mask, ENIG")
    expect(lookWords(resolveLook({ mask: "black", finish: "hasl", silk: "black" }))).toBe("black mask, HASL, black print")
    expect(() => resolveLook({ mask: "pink" as never })).toThrow("mask must be one of green, black, matte-black, blue, red, white, yellow, purple")
    expect(() => resolveLook({ background: "blue" })).toThrow('background must be a colour written "#rrggbb"')
  })
})
