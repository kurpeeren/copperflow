import { describe, expect, test } from "vitest"
import {
  centredCamera,
  fitCamera,
  gridSteps,
  hitTest,
  pointBounds,
  rightAngles,
  screenToWorld,
  snap,
  unionBoxes,
  worldToScreen,
  zoomAt,
  type PartBox,
} from "../studio/src/pcb/geometry.js"

const SIZE = { width: 800, height: 600 }
const box = (name: string, minX: number, minY: number, maxX: number, maxY: number): PartBox => ({
  name,
  pcbComponentId: name,
  center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  box: { minX, minY, maxX, maxY },
})

describe("camera", () => {
  test("world and screen coordinates convert both ways, with y pointing up", () => {
    const camera = { cx: 10, cy: 5, scale: 20 }
    expect(worldToScreen(camera, SIZE, { x: 10, y: 5 })).toEqual({ x: 400, y: 300 })
    expect(worldToScreen(camera, SIZE, { x: 11, y: 6 })).toEqual({ x: 420, y: 280 })
    expect(screenToWorld(camera, SIZE, { x: 420, y: 280 })).toEqual({ x: 11, y: 6 })
  })

  test("fit shows the whole box with some margin", () => {
    const camera = fitCamera({ minX: -15, minY: -9, maxX: 15, maxY: 9 }, SIZE)
    expect(camera.cx).toBe(0)
    expect(camera.cy).toBe(0)
    expect(camera.scale * 30).toBeLessThan(800)
    expect(camera.scale * 30).toBeGreaterThan(600)
  })

  test("zooming keeps the point under the cursor in place", () => {
    const camera = { cx: 0, cy: 0, scale: 20 }
    const cursor = { x: 600, y: 200 }
    const before = screenToWorld(camera, SIZE, cursor)
    const after = screenToWorld(zoomAt(camera, SIZE, cursor, 2), SIZE, cursor)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(zoomAt(camera, SIZE, cursor, 1e9).scale).toBeLessThanOrEqual(2000)
  })

  test("centring puts the point in the middle of the view at the same zoom", () => {
    const camera = { cx: 10, cy: 5, scale: 37 }
    const at = { x: -3, y: 8 }
    const centred = centredCamera(camera, at)
    expect(centred).toEqual({ cx: -3, cy: 8, scale: 37 })
    expect(worldToScreen(centred, SIZE, at)).toEqual({ x: 400, y: 300 })
    expect(camera).toEqual({ cx: 10, cy: 5, scale: 37 })
  })
})

describe("grid and snapping", () => {
  test("grid spacing stays readable at every zoom", () => {
    for (const scale of [2, 10, 40, 200]) {
      const { minor, major } = gridSteps(scale)
      expect(minor * scale).toBeGreaterThanOrEqual(8)
      expect(major / minor).toBeGreaterThanOrEqual(4)
    }
  })

  test("snap rounds to the step without floating-point noise", () => {
    expect(snap(2.26, 0.5)).toBe(2.5)
    expect(snap(-4.04, 0.1)).toBe(-4)
    expect(snap(0.3, 0.1)).toBe(0.3)
  })
})

describe("wires", () => {
  test("a wire through clicked points turns at right angles, horizontal first", () => {
    expect(rightAngles([{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 3 }])).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 3 },
    ])
  })

  test("repeated points are dropped", () => {
    expect(rightAngles([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 3, y: 1 }])).toEqual([
      { x: 1, y: 1 },
      { x: 3, y: 1 },
    ])
  })
})

describe("parts on the board", () => {
  const boxes = [box("R1", -4.8, 1.6, -3.2, 2.4), box("J1", -10, -2.5, 0, 6.5)]

  test("a click picks the smallest part under the cursor", () => {
    expect(hitTest(boxes, { x: -4, y: 2 })?.name).toBe("R1")
    expect(hitTest(boxes, { x: -8, y: 0 })?.name).toBe("J1")
    expect(hitTest(boxes, { x: 10, y: 0 })).toBeUndefined()
  })

  test("bounds come from points, such as the board outline, or from part boxes", () => {
    const outline = [{ x: -15, y: -9 }, { x: 15, y: -9 }, { x: 15, y: 9 }, { x: -15, y: 9 }]
    expect(pointBounds(outline)).toEqual({ minX: -15, minY: -9, maxX: 15, maxY: 9 })
    expect(pointBounds([])).toBeUndefined()
    expect(unionBoxes(boxes.map((b) => b.box))).toEqual({ minX: -10, minY: -2.5, maxX: 0, maxY: 6.5 })
    expect(unionBoxes([])).toBeUndefined()
  })
})
