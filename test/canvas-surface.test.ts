import { describe, expect, test } from "vitest"
import { backingSize, fitBackingStore, resetContext, type ResettableContext } from "../studio/src/pcb/canvas-surface.js"

/** A context without `reset`, as older browsers have, that keeps the calls. */
function oldContext() {
  const calls: string[] = []
  const ctx: ResettableContext = {
    globalAlpha: 0.3,
    globalCompositeOperation: "multiply",
    setTransform: (...args) => void calls.push(`setTransform ${args.join(",")}`),
    setLineDash: (segments) => void calls.push(`setLineDash ${segments.length}`),
  }
  return { ctx, calls }
}

describe("canvas backing store", () => {
  test("is the CSS size times the device pixel ratio, in whole pixels", () => {
    expect(backingSize({ width: 800, height: 600 }, 1)).toEqual({ width: 800, height: 600 })
    expect(backingSize({ width: 333, height: 201 }, 1.25)).toEqual({ width: 416, height: 251 })
  })

  test("is left alone while the size and the ratio stay the same", () => {
    const canvas = { width: 0, height: 0 }
    expect(fitBackingStore(canvas, { width: 800, height: 600 }, 1.5)).toBe(true)
    expect(canvas).toEqual({ width: 1200, height: 900 })
    let writes = 0
    const watched = {
      get width() {
        return 1200
      },
      set width(_: number) {
        writes++
      },
      get height() {
        return 900
      },
      set height(_: number) {
        writes++
      },
    }
    for (let paint = 0; paint < 5; paint++) expect(fitBackingStore(watched, { width: 800, height: 600 }, 1.5)).toBe(false)
    expect(writes).toBe(0)
  })

  test("is resized when the size or the ratio changes", () => {
    const canvas = { width: 1200, height: 900 }
    expect(fitBackingStore(canvas, { width: 801, height: 600 }, 1.5)).toBe(true)
    expect(canvas).toEqual({ width: 1202, height: 900 })
    expect(fitBackingStore(canvas, { width: 801, height: 600 }, 2)).toBe(true)
    expect(canvas).toEqual({ width: 1602, height: 1200 })
  })
})

describe("resetContext", () => {
  test("uses the context's own reset when there is one", () => {
    let resets = 0
    const { ctx, calls } = oldContext()
    resetContext({ ...ctx, reset: () => void resets++ })
    expect(resets).toBe(1)
    expect(calls).toEqual([])
  })

  test("otherwise puts back the transform, alpha, blending and dashes the last paint may have left", () => {
    const { ctx, calls } = oldContext()
    resetContext(ctx)
    expect(ctx.globalAlpha).toBe(1)
    expect(ctx.globalCompositeOperation).toBe("source-over")
    expect(calls).toEqual(["setTransform 1,0,0,1,0,0", "setLineDash 0"])
  })
})
