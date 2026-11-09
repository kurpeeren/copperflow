import { describe, expect, test } from "vitest"
import type { PartBox } from "../studio/src/pcb/geometry.js"
import { areaCamera, FIT_PADDING, fitBoxCamera, fitSelectionPlan, NOTHING_TO_FIT } from "../studio/src/pcb/view-fit.js"

const SIZE = { width: 400, height: 200 }
const part = (name: string, minX: number, minY: number, maxX: number, maxY: number): PartBox => ({
  name,
  pcbComponentId: name,
  center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  box: { minX, minY, maxX, maxY },
})

describe("fitBoxCamera", () => {
  test("centres on the box and leaves the padding on each side of the tighter axis", () => {
    const camera = fitBoxCamera({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, SIZE, 0.1)
    expect(camera.cx).toBe(10)
    expect(camera.cy).toBe(5)
    // Both axes allow 20 px per unit; the padding takes 10% off each side: 0.8 * 20.
    expect(camera.scale).toBeCloseTo(16)
  })

  test("the taller box is held by the view's height", () => {
    const camera = fitBoxCamera({ minX: 0, minY: 0, maxX: 5, maxY: 20 }, SIZE, 0.1)
    expect(camera.scale).toBeCloseTo((200 / 20) * 0.8)
  })

  test("a box of no size does not divide by zero and stops at the zoom limit", () => {
    const camera = fitBoxCamera({ minX: 3, minY: 4, maxX: 3, maxY: 4 }, SIZE, FIT_PADDING)
    expect(Number.isFinite(camera.scale)).toBe(true)
    expect(camera.scale).toBe(2000)
    expect([camera.cx, camera.cy]).toEqual([3, 4])
  })

  test("a box smaller than one unit still fills the view (sheet units are inches)", () => {
    const camera = fitBoxCamera({ minX: 0, minY: 0, maxX: 0.4, maxY: 0.2 }, SIZE, 0.1)
    expect(camera.scale).toBeCloseTo((400 / 0.4) * 0.8)
  })

  test("no padding fills the view exactly", () => {
    expect(fitBoxCamera({ minX: 0, minY: 0, maxX: 40, maxY: 20 }, SIZE, 0).scale).toBeCloseTo(10)
  })
})

describe("fitSelectionPlan", () => {
  const boxes = [part("R1", 0, 0, 2, 1), part("R2", 10, 0, 12, 1), part("C1", 0, 8, 1, 9)]

  test("one part: its own box", () => {
    const plan = fitSelectionPlan(boxes, ["R2"], SIZE, 0)
    expect("camera" in plan && plan.camera).toMatchObject({ cx: 11, cy: 0.5 })
  })

  test("several parts: the box around all of them", () => {
    const plan = fitSelectionPlan(boxes, ["R1", "R2", "C1"], SIZE, 0)
    if (!("camera" in plan)) throw new Error("expected a camera")
    expect(plan.camera).toMatchObject({ cx: 6, cy: 4.5 })
    // 12 wide by 9 tall: the height holds, 200 / 9.
    expect(plan.camera.scale).toBeCloseTo(200 / 9)
  })

  test("padding shrinks the zoom", () => {
    const tight = fitSelectionPlan(boxes, ["R1", "R2"], SIZE, 0)
    const padded = fitSelectionPlan(boxes, ["R1", "R2"], SIZE, 0.2)
    if (!("camera" in tight) || !("camera" in padded)) throw new Error("expected cameras")
    expect(padded.camera.scale).toBeCloseTo(tight.camera.scale * 0.6)
  })

  test("a rotated part is fitted by the box the view draws for it", () => {
    // A 4 by 1 resistor turned a quarter is drawn 1 wide and 4 tall.
    const turned = [part("R1", 0, 0, 1, 4)]
    const plan = fitSelectionPlan(turned, ["R1"], SIZE, 0)
    if (!("camera" in plan)) throw new Error("expected a camera")
    expect(plan.camera.scale).toBeCloseTo(50)
  })

  test("parts the view does not draw are left out; none drawn says so", () => {
    const some = fitSelectionPlan(boxes, ["R1", "Q9"], SIZE, 0)
    expect("camera" in some && some.camera.cx).toBe(1)
    expect(fitSelectionPlan(boxes, ["Q9"], SIZE, 0)).toEqual({ message: NOTHING_TO_FIT })
    expect(fitSelectionPlan(boxes, [], SIZE, 0)).toEqual({ message: NOTHING_TO_FIT })
  })

  test("a view with no size yet gives nothing", () => {
    expect(fitSelectionPlan(boxes, ["R1"], { width: 0, height: 0 }, 0)).toEqual({ message: NOTHING_TO_FIT })
  })
})

describe("areaCamera", () => {
  test("any two opposite corners give the same camera and it fills the view", () => {
    const a = areaCamera({ x: 0, y: 0 }, { x: 40, y: 20 }, SIZE)
    const b = areaCamera({ x: 40, y: 20 }, { x: 0, y: 0 }, SIZE)
    const c = areaCamera({ x: 40, y: 0 }, { x: 0, y: 20 }, SIZE)
    expect(a).toEqual(b)
    expect(a).toEqual(c)
    expect(a).toEqual({ cx: 20, cy: 10, scale: 10 })
  })

  test("a thin box is held by the long side", () => {
    const camera = areaCamera({ x: 0, y: 0 }, { x: 100, y: 1 }, SIZE)
    expect(camera.scale).toBeCloseTo(4)
  })
})
