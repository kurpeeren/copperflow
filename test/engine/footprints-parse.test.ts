import { expect, test } from "vitest"
import { generateFootprint } from "../../src/engine/footprints/index.js"
import { unknownFootprint } from "../../src/engine/footprints/known.js"
import { isSimple, parseFootprint } from "../../src/engine/footprints/parse.js"

test("a body or grid segment <a>x<b> becomes the size", () => {
  expect(parseFootprint("qfn32_5x5_p0.5")).toEqual({ kind: "qfn", code: "32", size: [5, 5], params: { p: 0.5 } })
  expect(parseFootprint("LQFP64_10mmx10mm_p0.5mm")).toEqual({ kind: "lqfp", code: "64", size: [10, 10], params: { p: 0.5 } })
  expect(parseFootprint("dfn8_2.5x3_p0.5")?.size).toEqual([2.5, 3])
  expect(parseFootprint("qfn32_5x5_4x4")).toBeUndefined()
})

test("a keyed pair such as _rows16x16 or _ep1.6x2.4 goes to pairs; _ep3.1 stays a length", () => {
  expect(parseFootprint("bga256_17x17_p1_rows16x16")).toEqual({
    kind: "bga",
    code: "256",
    size: [17, 17],
    params: { p: 1 },
    pairs: { rows: [16, 16] },
  })
  expect(parseFootprint("dfn8_3x3_p0.65_ep1.6x2.4")?.pairs).toEqual({ ep: [1.6, 2.4] })
  expect(parseFootprint("qfn32_5x5_p0.5_ep3.1")?.params).toEqual({ p: 0.5, ep: 3.1 })
  expect(parseFootprint("bga4_3x3_p1_rows2x2_rows1x4")).toBeUndefined()
  expect(parseFootprint("qfn32_5x5_p0.5_ep3_ep2x2")).toBeUndefined()
})

test("the head may carry a cross after an x and letters after the code", () => {
  expect(parseFootprint("pinrow2x5")).toEqual({ kind: "pinrow", code: "2", cross: "5", params: {} })
  expect(parseFootprint("radial6.3x2.5")).toEqual({ kind: "radial", code: "6.3", cross: "2.5", params: {} })
  expect(parseFootprint("hc49s")).toEqual({ kind: "hc", code: "49", suffix: "s", params: {} })
  expect(parseFootprint("DO214AC")).toEqual({ kind: "do", code: "214", suffix: "ac", params: {} })
  expect(parseFootprint("sma")).toEqual({ kind: "sma", code: "", params: {} })
  expect(parseFootprint("dip8_w15.24")).toEqual({ kind: "dip", code: "8", params: { w: 15.24 } })
})

test("isSimple is false for any of the new parts", () => {
  expect(isSimple(parseFootprint("soic8_p1.27mm")!)).toBe(true)
  expect(isSimple(parseFootprint("sot23_5")!)).toBe(true)
  for (const text of ["pinrow2x5", "hc49s", "qfn32_5x5_p0.5", "qfn32_ep1x1"]) expect(isSimple(parseFootprint(text)!)).toBe(false)
})

test("the older families refuse strings with the new parts", () => {
  for (const text of ["0603x5", "0603s", "sod123s", "soic8_5x5", "soic8x2", "sot23s", "qfn32_ep2x2", "qfp48s", "pinrow4s", "pinrow4_rows2x2"]) {
    expect(generateFootprint(text)).toEqual({ error: unknownFootprint(text) })
  }
})
