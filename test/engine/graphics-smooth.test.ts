import { describe, expect, it } from "vitest"
import { arcSegments, cubic, quadratic } from "../../src/engine/graphics/curves.js"
import { CURVE_TOLERANCE_MM, parseGraphic, type GraphicShapes } from "../../src/engine/graphics/index.js"
import type { Point } from "../../src/engine/model.js"

const FULL_TURN = 2 * Math.PI
/** The control-point distance that makes a cubic Bézier a quarter circle. */
const KAPPA = 0.5522847498

function read(body: string, root: string): GraphicShapes {
  const result = parseGraphic(`<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`, "svg")
  if ("error" in result) throw new Error(result.error)
  return result
}

/** The largest distance of the ring's chords from the circle it stands for. */
function strays(ring: readonly Point[], radius: number): number {
  const cx = ring.reduce((sum, p) => sum + p.x, 0) / ring.length
  const cy = ring.reduce((sum, p) => sum + p.y, 0) / ring.length
  return Math.max(...ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length] as Point
    return radius - Math.hypot((p.x + q.x) / 2 - cx, (p.y + q.y) / 2 - cy)
  }))
}

/** A circle as four cubic Béziers, as drawing programs write one. */
const bezierCircle = (r: number, c: number) => {
  const k = r * KAPPA
  return `<path d="M${c + r} ${c} C${c + r} ${c + k} ${c + k} ${c + r} ${c} ${c + r} C${c - k} ${c + r} ${c - r} ${c + k} ${c - r} ${c} C${c - r} ${c - k} ${c - k} ${c - r} ${c} ${c - r} C${c + k} ${c - r} ${c + r} ${c - k} ${c + r} ${c} Z"/>`
}

describe("a small curve is not drawn with corners", () => {
  it("a circle of half a millimetre has at least 32 sides", () => {
    const r = read('<circle cx="5" cy="5" r="0.5"/>', 'width="10mm" height="10mm" viewBox="0 0 10 10"')
    expect(r.fills[0]?.outer.length).toBeGreaterThanOrEqual(32)
  })

  it("the same circle written as four Béziers has at least 32 sides", () => {
    const r = read(bezierCircle(0.5, 5), 'width="10mm" height="10mm" viewBox="0 0 10 10"')
    expect(r.fills[0]?.outer.length).toBeGreaterThanOrEqual(32)
  })

  it("an icon with no physical size, placed far larger than drawn, still has no fewer", () => {
    // 24 px is 6.35 mm: a disc of 2.6 mm that a board may show at 20 mm.
    const r = read('<circle cx="12" cy="12" r="10"/>', 'viewBox="0 0 24 24"')
    expect(r.fills[0]?.outer.length).toBeGreaterThanOrEqual(32)
  })

  it("a quarter turn is 8 chords, as an arc, a cubic and a quadratic", () => {
    expect(arcSegments(0.5, Math.PI / 2, CURVE_TOLERANCE_MM)).toBe(8)
    expect(arcSegments(1, Math.PI / 2, CURVE_TOLERANCE_MM)).toBe(8)
    const asCubic = cubic({ x: 1, y: 0 }, { x: 1, y: KAPPA }, { x: KAPPA, y: 1 }, { x: 0, y: 1 }, CURVE_TOLERANCE_MM).length
    const asQuadratic = quadratic({ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, CURVE_TOLERANCE_MM).length
    for (const count of [asCubic, asQuadratic]) {
      expect(count).toBeGreaterThanOrEqual(8)
      expect(count).toBeLessThanOrEqual(9)
    }
  })
})

describe("what the smoothness does not change", () => {
  it("a large circle is still held to the tolerance, with no more sides than that takes", () => {
    const r = read('<circle cx="50" cy="50" r="40"/>', 'width="100mm" height="100mm" viewBox="0 0 100 100"')
    const ring = r.fills[0]?.outer as Point[]
    expect(strays(ring, 40)).toBeLessThanOrEqual(CURVE_TOLERANCE_MM)
    // The reader may draw the circle as a few arcs, each rounded up to whole chords.
    expect(ring.length - arcSegments(40, FULL_TURN, CURVE_TOLERANCE_MM)).toBeGreaterThanOrEqual(0)
    expect(ring.length - arcSegments(40, FULL_TURN, CURVE_TOLERANCE_MM)).toBeLessThanOrEqual(4)
    expect(ring.length).toBeLessThan(210)
  })

  it("a curve of a few millimetres strays at most 5 µm, so a picture at 50 px per mm shows no corners", () => {
    const r = read('<circle cx="50" cy="50" r="3"/>' + bezierCircle(3, 20), 'width="100mm" height="100mm" viewBox="0 0 100 100"')
    expect(r.fills).toHaveLength(2)
    for (const fill of r.fills) expect(strays(fill.outer, 3)).toBeLessThanOrEqual(0.005)
  })

  it("detail too small to see stays coarse: a 10 µm circle is not 32 sides", () => {
    expect(arcSegments(0.01, FULL_TURN, CURVE_TOLERANCE_MM)).toBeLessThan(16)
    expect(cubic({ x: 0.01, y: 0 }, { x: 0.01, y: 0.01 * KAPPA }, { x: 0.01 * KAPPA, y: 0.01 }, { x: 0, y: 0.01 }, CURVE_TOLERANCE_MM).length).toBeLessThan(4)
  })

  it("a straight Bézier is one segment, and an arc of no radius does not run to the point limit", () => {
    expect(cubic({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, CURVE_TOLERANCE_MM)).toHaveLength(1)
    expect(arcSegments(0, FULL_TURN, CURVE_TOLERANCE_MM)).toBeLessThanOrEqual(4)
  })
})
