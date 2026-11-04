import { describe, expect, test } from "vitest"
import {
  boardBounds,
  componentBoxes,
  fitCamera,
  gridSteps,
  hitTest,
  parseMatrix,
  schematicBoxes,
  screenToWorld,
  svgTransform,
  snap,
  toMatrix,
  worldToScreen,
  zoomAt,
} from "../studio/src/pcb/geometry.js"

const SIZE = { width: 800, height: 600 }
const JSON_ = [
  { type: "pcb_board", center: { x: 0, y: 0 }, width: 30, height: 18 },
  { type: "source_component", source_component_id: "s1", name: "R1" },
  { type: "pcb_component", pcb_component_id: "p1", source_component_id: "s1", center: { x: -4, y: 2 }, width: 1.6, height: 0.8 },
  { type: "source_component", source_component_id: "s2", name: "J1" },
  { type: "pcb_component", pcb_component_id: "p2", source_component_id: "s2", center: { x: -5, y: 2 }, width: 10, height: 9 },
]

describe("camera", () => {
  test("world and screen coordinates convert both ways, with y pointing up", () => {
    const camera = { cx: 10, cy: 5, scale: 20 }
    expect(worldToScreen(camera, SIZE, { x: 10, y: 5 })).toEqual({ x: 400, y: 300 })
    expect(worldToScreen(camera, SIZE, { x: 11, y: 6 })).toEqual({ x: 420, y: 280 })
    expect(screenToWorld(camera, SIZE, { x: 420, y: 280 })).toEqual({ x: 11, y: 6 })
  })

  test("the drawing matrix matches worldToScreen, scaled for the pixel ratio", () => {
    const m = toMatrix({ cx: 10, cy: 5, scale: 20 }, SIZE, 2)
    expect([m.a * 11 + m.e, m.d * 6 + m.f]).toEqual([840, 560])
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

describe("schematic", () => {
  const SCH = [
    { type: "source_component", source_component_id: "s1", name: "R1" },
    { type: "schematic_component", schematic_component_id: "c1", source_component_id: "s1", center: { x: 2, y: 1 }, size: { width: 1, height: 0.4 } },
  ]

  test("reads the real-to-screen matrix the SVG carries", () => {
    expect(parseMatrix("matrix(51.36,0,0,-51.36,75.37,263.8)")).toEqual({ a: 51.36, b: 0, c: 0, d: -51.36, e: 75.37, f: 263.8 })
    expect(parseMatrix("rotate(3)")).toBeUndefined()
  })

  test("schematic parts have boxes from their centre and size", () => {
    expect(schematicBoxes(SCH)).toEqual([{ name: "R1", pcbComponentId: "c1", center: { x: 2, y: 1 }, box: { minX: 1.5, minY: 0.8, maxX: 2.5, maxY: 1.2 } }])
  })

  test("the SVG transform puts world points where the camera says", () => {
    const m = { a: 50, b: 0, c: 0, d: -50, e: 100, f: 300 }
    const camera = { cx: 2, cy: 1, scale: 80 }
    const t = svgTransform(camera, SIZE, m)
    const world = { x: 3, y: 2 }
    const svg = { x: m.a * world.x + m.e, y: m.d * world.y + m.f }
    const onScreen = { x: t.zoom * svg.x + t.x, y: t.zoom * svg.y + t.y }
    expect(onScreen.x).toBeCloseTo(worldToScreen(camera, SIZE, world).x)
    expect(onScreen.y).toBeCloseTo(worldToScreen(camera, SIZE, world).y)
  })
})

describe("parts on the board", () => {
  const boxes = componentBoxes(JSON_)

  test("every placed component has a named box", () => {
    expect(boxes.map((b) => [b.name, b.box])).toEqual([
      ["R1", { minX: -4.8, minY: 1.6, maxX: -3.2, maxY: 2.4 }],
      ["J1", { minX: -10, minY: -2.5, maxX: 0, maxY: 6.5 }],
    ])
  })

  test("a click picks the smallest part under the cursor", () => {
    expect(hitTest(boxes, { x: -4, y: 2 })?.name).toBe("R1")
    expect(hitTest(boxes, { x: -8, y: 0 })?.name).toBe("J1")
    expect(hitTest(boxes, { x: 10, y: 0 })).toBeUndefined()
  })

  test("board bounds come from the board, or from the parts without one", () => {
    expect(boardBounds(JSON_)).toEqual({ minX: -15, minY: -9, maxX: 15, maxY: 9 })
    expect(boardBounds(JSON_.filter((e) => e.type !== "pcb_board"))).toEqual({ minX: -10, minY: -2.5, maxX: 0, maxY: 6.5 })
  })
})
