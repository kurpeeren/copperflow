import { describe, expect, test } from "vitest"
import { ALL_TEXT_FROM, capToWidth, OWN_TEXT_FROM, SHEET_LEVEL_SIZE, sheetLevelPx, devicePxFor, fontPxFor, PIN_NUMBERS_FROM, sharpenText, textAnchorAt, textLevel, textShown, TEXT_FROM } from "../studio/src/pcb/text-level.js"

const RATIOS = [1, 1.1, 1.25, 1.5, 2]
const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-9

describe("textLevel", () => {
  test("below 7 device px no text, from 7 names only, from 9 everything", () => {
    expect([TEXT_FROM, ALL_TEXT_FROM, PIN_NUMBERS_FROM]).toEqual([7, 9, 11])
    expect(textLevel(0)).toBe("none")
    expect(textLevel(6.99)).toBe("none")
    expect(textLevel(7)).toBe("names")
    expect(textLevel(8.99)).toBe("names")
    expect(textLevel(9)).toBe("all")
    expect(textLevel(40)).toBe("all")
  })

  test("by the level's size: designators and net names from 7, values and pin names from 9, pin numbers from 11", () => {
    expect([6, 7, 9].map((px) => textShown("name", px, px))).toEqual([false, true, true])
    expect([8, 9].map((px) => textShown("detail", px, px))).toEqual([false, true])
    expect([10, 11].map((px) => textShown("pin-number", px, px))).toEqual([false, true])
  })

  test("a text the level allows is drawn while its own size is at least 5 device px", () => {
    expect(OWN_TEXT_FROM).toBe(5)
    expect(textShown("detail", 10, 5)).toBe(true)
    expect(textShown("detail", 10, 4)).toBe(false)
    expect(textShown("pin-number", 11, 5)).toBe(true)
    expect(textShown("pin-number", 10, 9)).toBe(false)
  })

  test("the sheet's level is judged by its designator size, 0.16 in", () => {
    expect(SHEET_LEVEL_SIZE).toBe(0.16)
    expect(sheetLevelPx(60, 1)).toBe(10)
    expect(sheetLevelPx(42, 1.1)).toBe(7)
  })
})

describe("font sizes in whole device pixels", () => {
  test("rounds the world size times scale times ratio, never below 1", () => {
    expect(devicePxFor(0.16, 42, 1)).toBe(7)
    expect(devicePxFor(0.16, 42, 1.1)).toBe(7)
    expect(devicePxFor(0.12, 42, 1.25)).toBe(6)
    expect(devicePxFor(0.001, 1, 1)).toBe(1)
  })

  test.each(RATIOS)("the CSS size times the ratio is a whole number at ratio %s", (ratio) => {
    for (let scale = 5; scale < 400; scale += 3.7) {
      const css = fontPxFor(0.12, scale, ratio)
      expect(whole(css * ratio)).toBe(true)
      expect(css * ratio).toBeCloseTo(devicePxFor(0.12, scale, ratio), 9)
    }
  })

  test.each(RATIOS)("a text anchor lands on a device pixel in x and baseline at ratio %s", (ratio) => {
    const at = textAnchorAt({ x: 41.37, y: 12.61 }, ratio)
    expect(whole(at.x * ratio)).toBe(true)
    expect(whole(at.y * ratio)).toBe(true)
  })
})

describe("capToWidth", () => {
  test("a text that fits keeps its size", () => {
    expect(capToWidth(12, 50, 60)).toBe(12)
  })

  test("a wider one is made smaller, to the whole device pixel that fits", () => {
    expect(capToWidth(12, 120, 60)).toBe(6)
    expect(capToWidth(12, 100, 60)).toBe(7)
    expect(capToWidth(3, 1000, 1)).toBe(1)
  })
})

describe("sharpenText", () => {
  test("asks for geometric precision where the context has textRendering", () => {
    const ctx = { textRendering: "auto" }
    sharpenText(ctx)
    expect(ctx.textRendering).toBe("geometricPrecision")
  })

  test("leaves a context without it alone", () => {
    const ctx: Record<string, unknown> = {}
    sharpenText(ctx)
    expect("textRendering" in ctx).toBe(false)
  })
})
