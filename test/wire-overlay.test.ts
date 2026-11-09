import { describe, expect, test } from "vitest"
import { schematicTheme } from "../studio/src/pcb/schematic-theme.js"
import { drawWireHandles, drawWireHover, SHEET_WIRE_LOOK, WIRE_HANDLE_PX, wireHoverPadPx, wireOutline } from "../studio/src/pcb/wire-overlay.js"
import { recorder } from "./helpers/fake-ctx.js"

const p = (x: number, y: number) => ({ x, y })
// One pixel per sheet unit, the sheet's origin at the view's centre.
const CAMERA = { cx: 0, cy: 0, scale: 1 }
const SIZE = { width: 0, height: 0 }

describe("the outline round a hovered wire", () => {
  test("a straight wire gets a box 3 px round it, as a hovered part does", () => {
    expect(wireOutline([p(0, 0), p(10, 0)], 3)).toEqual([p(-3, 3), p(13, 3), p(13, -3), p(-3, -3)])
  })

  test("a bent wire gets a mitred outline that turns with it", () => {
    expect(wireOutline([p(0, 0), p(10, 0), p(10, 10)], 3)).toEqual([p(-3, 3), p(7, 3), p(7, 13), p(13, 13), p(13, -3), p(-3, -3)])
  })

  test("repeated points are skipped and a single point has no outline", () => {
    expect(wireOutline([p(0, 0), p(0, 0), p(10, 0)], 3)).toEqual(wireOutline([p(0, 0), p(10, 0)], 3))
    expect(wireOutline([p(0, 0)], 3)).toEqual([])
  })

  test("stands 3 px off the wire, or off the drawn stroke's edge by 2 px once the stroke is wider", () => {
    expect(wireHoverPadPx(100)).toBe(3)
    expect(wireHoverPadPx(2000)).toBe(22)
    const rec = recorder()
    drawWireHover(rec.ctx, { cx: 0, cy: 0, scale: 2000 }, SIZE, [p(0, 0), p(1, 0)], SHEET_WIRE_LOOK, 1)
    expect(rec.records.find((r) => r.name === "moveTo")?.args).toEqual([-22, 22])
  })

  test("is drawn dashed in the hover colour, one pixel wide", () => {
    const rec = recorder()
    drawWireHover(rec.ctx, CAMERA, SIZE, [p(0, 0), p(10, 0)], SHEET_WIRE_LOOK, 1)
    const stroke = rec.records.find((r) => r.name === "stroke")
    expect(stroke).toMatchObject({ strokeStyle: schematicTheme.hover, lineWidth: 1 })
    expect(rec.records.find((r) => r.name === "setLineDash")?.args[0]).toEqual([4, 3])
  })
})

describe("the handles of a selected wire", () => {
  test("each corner gets a white square outlined in the selection colour; the two ends a hollow square", () => {
    const rec = recorder()
    // On screen (y down): the corner at (10, -1), the ends at (1, -1) and (10, -10).
    drawWireHandles(rec.ctx, CAMERA, SIZE, [p(1, 1), p(10, 1), p(10, 10)], SHEET_WIRE_LOOK, 1)
    const fills = rec.records.filter((r) => r.name === "fillRect")
    const outlines = rec.records.filter((r) => r.name === "strokeRect")
    expect(WIRE_HANDLE_PX).toBe(6)
    expect(fills.map((r) => [r.args, r.fillStyle])).toEqual([[[7, -4, 6, 6], "#FFFFFF"]])
    expect(outlines.map((r) => r.args)).toEqual([
      [7.5, -3.5, 5, 5],
      [-1.5, -3.5, 5, 5],
      [7.5, -12.5, 5, 5],
    ])
    // The one-device-pixel outline runs inside the square's edge, on pixel centres.
    expect(outlines.every((r) => r.strokeStyle === schematicTheme.selection)).toBe(true)
  })

  test("a straight wire has no corner handle, only its two ends", () => {
    const rec = recorder()
    drawWireHandles(rec.ctx, CAMERA, SIZE, [p(1, 1), p(10, 1)], SHEET_WIRE_LOOK, 1)
    expect(rec.records.filter((r) => r.name === "fillRect")).toEqual([])
    expect(rec.records.filter((r) => r.name === "strokeRect")).toHaveLength(2)
  })
})
