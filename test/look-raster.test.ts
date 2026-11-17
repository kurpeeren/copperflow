import { describe, expect, test } from "vitest"
import { BOTTOM, project, START, TOP, viewFrame } from "../studio/src/look/orbit.js"
import { renderScene } from "../studio/src/look/raster.js"
import type { Face, Scene, Vec3 } from "../studio/src/look/scene.js"

const square = (x: number, y: number, size: number, z: number): Vec3[] => [
  [x, y, z],
  [x + size, y, z],
  [x + size, y + size, z],
  [x, y + size, z],
]
const face = (loop: Vec3[], color: [number, number, number], part: number, alpha = 1): Face => ({ loops: [loop], normal: [0, 0, 1], color, alpha, part })
const RED: [number, number, number] = [255, 0, 0]
const BLUE: [number, number, number] = [0, 0, 255]
const scene = (faces: Face[]): Scene => ({ faces, bounds: [[0, 0, 0], [10, 10, 2]] })
const BACK: [number, number, number] = [0, 0, 0]

/** The part index and colour at a board point, as the view from `orbit` draws it. */
function at(s: Scene, orbit: typeof TOP, p: Vec3) {
  const frame = renderScene(s, orbit, 100, 100, { background: BACK })
  const { x, y } = project(viewFrame(orbit, s, 100, 100), p)
  const i = Math.floor(y) * 100 + Math.floor(x)
  return { part: frame.ids[i], rgb: [frame.color[i * 4], frame.color[i * 4 + 1], frame.color[i * 4 + 2]] }
}

describe("the 3D view's drawing", () => {
  // Two squares overlapping where x and y are 4 to 6: part 0 at z = 2, part 1 at z = 0.
  const near = face(square(0, 0, 6, 2), RED, 0)
  const far = face(square(4, 4, 6, 0), BLUE, 1)

  test("what is in front hides what is behind, whichever is drawn first", () => {
    for (const faces of [[near, far], [far, near]]) {
      expect(at(scene(faces), TOP, [5, 5, 2]).part).toBe(0)
      expect(at(scene(faces), TOP, [8, 8, 0]).part).toBe(1)
      expect(at(scene(faces), TOP, [1, 1, 2]).part).toBe(0)
    }
  })

  test("from a slant too, and the depth kept is the face's own at that pixel", () => {
    expect(at(scene([far, near]), START, [5, 5, 2]).part).toBe(0)
    const wall: Face = { loops: [[[0, 5, 0], [10, 5, 0], [10, 5, 2], [0, 5, 2]]], normal: [0, -1, 0], color: RED, alpha: 1, part: 7 }
    const s = scene([wall])
    const frame = renderScene(s, START, 100, 100, { background: BACK })
    const point: Vec3 = [4, 5, 1]
    const { x, y, depth } = project(viewFrame(START, s, 100, 100), point)
    const i = Math.floor(y) * 100 + Math.floor(x)
    expect(frame.ids[i]).toBe(7)
    // The pixel's centre is at most half a pixel (under 0.1 mm here) from the point, so its depth is that close.
    expect(Math.abs((frame.depth[i] as number) - depth)).toBeLessThan(0.15)
  })

  test("from below the far square is the near one", () => {
    expect(at(scene([near, far]), BOTTOM, [5, 5, 0]).part).toBe(1)
  })

  test("a face is shaded by how squarely it faces the eye, and nothing is drawn outside the faces", () => {
    const top = at(scene([near]), TOP, [1, 1, 2])
    const slanted = at(scene([near]), START, [1, 1, 2])
    expect(top.rgb[0]).toBeGreaterThan(slanted.rgb[0] as number)
    expect(at(scene([near]), TOP, [9, 9, 2])).toEqual({ part: -1, rgb: [0, 0, 0] })
  })

  test("a holed face leaves its hole empty", () => {
    const holed: Face = { loops: [square(0, 0, 10, 0), [...square(3, 3, 4, 0)].reverse()], normal: [0, 0, 1], color: RED, alpha: 1, part: 0 }
    expect(at(scene([holed]), TOP, [1, 1, 0]).part).toBe(0)
    expect(at(scene([holed]), TOP, [5, 5, 0]).part).toBe(-1)
  })

  test("the see-through board tints a part behind it without hiding it, and does not cover a part in front", () => {
    const board = face(square(0, 0, 10, 1), [0, 255, 0], -1, 0.5)
    const below = face(square(2, 2, 2, 0), BLUE, 3)
    const above = face(square(6, 6, 2, 2), RED, 4)
    const s = scene([board, below, above])
    const under = at(s, TOP, [3, 3, 0])
    expect(under.part).toBe(3)
    expect(under.rgb[1]).toBeGreaterThan(0)
    expect(under.rgb[2]).toBeGreaterThan(0)
    const over = at(s, TOP, [7, 7, 2])
    expect(over).toEqual({ part: 4, rgb: [255, 0, 0] })
  })

  test("the highlighted part is drawn lighter", () => {
    const plain = renderScene(scene([near]), TOP, 100, 100, { background: BACK })
    const lit = renderScene(scene([near]), TOP, 100, 100, { background: BACK, highlight: 0 })
    const i = 50 * 100 + 30
    expect(lit.color[i * 4 + 1]).toBeGreaterThan(plain.color[i * 4 + 1] as number)
  })
})
