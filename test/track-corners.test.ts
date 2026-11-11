import { describe, expect, test } from "vitest"
import { CORNER_MODES, cornerLeg, cornerModeName, nextCornerMode, routePoints } from "../studio/src/pcb/track-corners.js"

const p = (x: number, y: number) => ({ x, y })

describe("the corner modes", () => {
  test("Space and L step 45° → 45° reversed → 90° → arc and round again; 45° first, as EasyEDA", () => {
    expect(CORNER_MODES[0]).toBe("45")
    expect(nextCornerMode("45")).toBe("45r")
    expect(nextCornerMode("45r")).toBe("90")
    expect(nextCornerMode("90")).toBe("arc")
    expect(nextCornerMode("arc")).toBe("45")
    expect(CORNER_MODES.map(cornerModeName)).toEqual(["45°", "45° reversed", "90°", "Arc"])
  })

  test("arc: never tighter than half the track's width; a leg too short for that stays a square elbow", () => {
    // A 0.5 mm track on a 0.2 mm leg: an arc of radius 0.196 would pinch it, so the elbow stays square.
    expect(cornerLeg(p(0, 0), p(4, 0.2), "arc", 0.5)).toEqual([p(4, 0), p(4, 0.2)])
    const leg = cornerLeg(p(0, 0), p(4, 2), "arc", 0.5)
    expect(4 - (leg[0] ?? p(0, 0)).x).toBeGreaterThanOrEqual(0.25)
    expect(leg.length).toBeGreaterThan(3)
  })

  test("arc: the square elbow rounded into a quarter arc tangent to both legs, ending on the pointer", () => {
    const leg = cornerLeg(p(0, 0), p(4, 2), "arc")
    expect(leg.at(-1)).toEqual(p(4, 2))
    expect(leg.length).toBeGreaterThan(3)
    // The arc rounds the 90° elbow at (4, 0): it starts on the first leg at (4 − r, 0), its centre at (4 − r, r).
    const start = leg[0] ?? p(0, 0)
    const r = 4 - start.x
    expect(start.y).toBe(0)
    expect(r).toBeGreaterThan(1.9)
    for (const point of leg.slice(0, -1)) expect(Math.hypot(point.x - (4 - r), point.y - r)).toBeCloseTo(r, 3)
  })
})

describe("cornerLeg", () => {
  test("45°: the straight run first along the longer axis, then the 45° leg", () => {
    expect(cornerLeg(p(0, 0), p(10, 4), "45")).toEqual([p(6, 0), p(10, 4)])
    expect(cornerLeg(p(0, 0), p(-3, -10), "45")).toEqual([p(0, -7), p(-3, -10)])
  })

  test("45° reversed: the 45° leg first, then the straight run", () => {
    expect(cornerLeg(p(0, 0), p(10, 4), "45r")).toEqual([p(4, 4), p(10, 4)])
    expect(cornerLeg(p(0, 0), p(-3, -10), "45r")).toEqual([p(-3, -3), p(-3, -10)])
  })

  test("90°: the schematic's square rule, horizontal first", () => {
    expect(cornerLeg(p(0, 0), p(10, 4), "90")).toEqual([p(10, 0), p(10, 4)])
  })

  test("a leg already straight or at 45° has no elbow in any mode", () => {
    for (const mode of CORNER_MODES) {
      expect(cornerLeg(p(1, 1), p(1, 9), mode)).toEqual([p(1, 9)])
      expect(cornerLeg(p(1, 1), p(5, 1), mode)).toEqual([p(5, 1)])
    }
    expect(cornerLeg(p(0, 0), p(3, -3), "45")).toEqual([p(3, -3)])
    expect(cornerLeg(p(0, 0), p(3, -3), "45r")).toEqual([p(3, -3)])
  })

  test("elbows are rounded to 4 decimals", () => {
    expect(cornerLeg(p(0, 0), p(0.30001, 0.1), "45")).toEqual([p(0.2, 0), p(0.30001, 0.1)])
  })
})

describe("routePoints", () => {
  test("joins the legs from the start, each with its own mode, and drops points in a straight run", () => {
    const points = routePoints(p(0, 0), [
      { to: p(10, 4), mode: "45" },
      { to: p(10, 10), mode: "90" },
      { to: p(10, 12), mode: "45" },
    ])
    expect(points).toEqual([p(0, 0), p(6, 0), p(10, 4), p(10, 12)])
  })
})
