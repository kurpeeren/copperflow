import { describe, expect, test } from "vitest"
import { fitReference, invertMatrix, isAffine, mapPoint, referenceBox, type Matrix3, type ReferencePoint } from "../src/engine/reference-fit.js"

const IMAGE = { width: 1000, height: 800 }
const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 6) => {
  expect(a.x).toBeCloseTo(b.x, digits)
  expect(a.y).toBeCloseTo(b.y, digits)
}

/** A photo taken at an angle: a perspective from board mm to pixels, to make points from. */
const CAMERA: Matrix3 = [7.5, 0.4, 480, -0.3, -7.2, 410, 0.0004, -0.0002, 1]
const pixelOf = (board: { x: number; y: number }) => mapPoint(CAMERA, board)
const HOLES = [
  { x: -60.31, y: -50.31 },
  { x: -60.31, y: 50.02 },
  { x: 59.96, y: 50.02 },
  { x: 59.96, y: -50.31 },
]

describe("fitReference", () => {
  test("without points the image is centred on the board at the board's width", () => {
    const fit = fitReference({ ...IMAGE, mirror: false, points: [] }, { centre: { x: 5, y: -2 }, width: 100 })
    expect(fit.kind).toBe("placed")
    close(mapPoint(fit.matrix, { x: 500, y: 400 }), { x: 5, y: -2 })
    // 1000 pixels across a 100 mm board: 0.1 mm a pixel, the image's top to the board's +y.
    close(mapPoint(fit.matrix, { x: 1000, y: 0 }), { x: 55, y: 38 })
  })

  test("a Gerber's own pixel size wins over the board's width, and no board centres on the origin", () => {
    const fit = fitReference({ ...IMAGE, mirror: false, points: [], pixel: 0.05 })
    close(mapPoint(fit.matrix, { x: 1000, y: 400 }), { x: 25, y: 0 })
  })

  test("mirror flips the image left to right about its centre", () => {
    const fit = fitReference({ ...IMAGE, mirror: true, points: [] }, { centre: { x: 0, y: 0 }, width: 100 })
    close(mapPoint(fit.matrix, { x: 0, y: 400 }), { x: 50, y: 0 })
  })

  test("one point moves the image onto it at the default scale", () => {
    const fit = fitReference({ ...IMAGE, mirror: false, points: [{ image: { x: 100, y: 100 }, board: { x: 3, y: 4 } }] }, { centre: { x: 0, y: 0 }, width: 100 })
    close(mapPoint(fit.matrix, { x: 100, y: 100 }), { x: 3, y: 4 })
    close(mapPoint(fit.matrix, { x: 200, y: 100 }), { x: 13, y: 4 })
  })

  test("two points fix scale, turn and position exactly", () => {
    const points: ReferencePoint[] = [
      { image: { x: 100, y: 100 }, board: { x: 0, y: 0 } },
      { image: { x: 100, y: 300 }, board: { x: 20, y: 0 } },
    ]
    const fit = fitReference({ ...IMAGE, mirror: false, points })
    expect(fit.kind).toBe("similar")
    expect(fit.residuals.every((r) => r < 1e-9)).toBe(true)
    // Down the image is +x on the board: turned a quarter, 0.1 mm a pixel.
    close(mapPoint(fit.matrix, { x: 200, y: 100 }), { x: 0, y: 10 })
  })

  test("a mirrored two-point fit keeps the picked points and flips the rest", () => {
    const points: ReferencePoint[] = [
      { image: { x: 0, y: 0 }, board: { x: 0, y: 0 } },
      { image: { x: 100, y: 0 }, board: { x: 10, y: 0 } },
    ]
    const plain = fitReference({ ...IMAGE, mirror: false, points })
    const mirrored = fitReference({ ...IMAGE, mirror: true, points })
    close(mapPoint(mirrored.matrix, { x: 100, y: 0 }), { x: 10, y: 0 })
    expect(mapPoint(plain.matrix, { x: 0, y: 100 }).y).toBeCloseTo(-10)
    expect(mapPoint(mirrored.matrix, { x: 0, y: 100 }).y).toBeCloseTo(10)
  })

  test("three points are a least-squares fit, with each point's miss", () => {
    const points: ReferencePoint[] = [
      { image: { x: 0, y: 0 }, board: { x: 0, y: 0 } },
      { image: { x: 100, y: 0 }, board: { x: 10, y: 0 } },
      { image: { x: 0, y: 100 }, board: { x: 0, y: -11 } },
    ]
    const fit = fitReference({ ...IMAGE, mirror: false, points })
    expect(fit.kind).toBe("similar")
    expect(Math.max(...fit.residuals)).toBeGreaterThan(0.1)
    expect(Math.max(...fit.residuals)).toBeLessThan(1)
  })

  test("four or more points take out a photo's slant", () => {
    const points = HOLES.map((board) => ({ image: pixelOf(board), board }))
    const fit = fitReference({ ...IMAGE, mirror: false, points })
    expect(fit.kind).toBe("perspective")
    expect(isAffine(fit.matrix)).toBe(false)
    expect(Math.max(...fit.residuals)).toBeLessThan(1e-6)
    // A point that was not picked lands where the camera saw it.
    close(mapPoint(fit.matrix, pixelOf({ x: 12, y: -7 })), { x: 12, y: -7 }, 5)
  })

  test("a mirrored photo with four points still fits: the perspective takes the flip", () => {
    const flipped = HOLES.map((board) => {
      const p = pixelOf(board)
      return { image: { x: IMAGE.width - p.x, y: p.y }, board }
    })
    const fit = fitReference({ ...IMAGE, mirror: true, points: flipped })
    expect(fit.kind).toBe("perspective")
    expect(Math.max(...fit.residuals)).toBeLessThan(1e-6)
  })

  test("points that would fold the image fall back to scale and turn, and say so", () => {
    const points: ReferencePoint[] = [
      { image: { x: 0, y: 0 }, board: { x: 0, y: 0 } },
      { image: { x: 100, y: 0 }, board: { x: 10, y: 0 } },
      { image: { x: 100, y: 100 }, board: { x: 0, y: -10 } },
      { image: { x: 0, y: 100 }, board: { x: 10, y: -10 } },
    ]
    const fit = fitReference({ ...IMAGE, mirror: false, points })
    expect(fit.kind).toBe("similar")
    expect(fit.note).toMatch(/flat/)
  })

  test("points all on one pixel keep the default scale", () => {
    const one = { image: { x: 10, y: 10 }, board: { x: 1, y: 1 } }
    const fit = fitReference({ ...IMAGE, mirror: false, points: [one, { ...one, board: { x: 2, y: 2 } }] })
    expect(fit.kind).toBe("placed")
    expect(fit.note).toMatch(/one pixel/)
  })
})

describe("matrix helpers", () => {
  test("the inverse takes a board point back to its pixel", () => {
    const back = invertMatrix(CAMERA) as Matrix3
    close(mapPoint(back, mapPoint(CAMERA, { x: 3, y: 4 })), { x: 3, y: 4 })
    expect(invertMatrix([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeUndefined()
  })

  test("the box an image covers", () => {
    const box = referenceBox([0.1, 0, -50, 0, -0.1, 40, 0, 0, 1], 1000, 800)
    expect(box).toEqual({ minX: -50, minY: -40, maxX: 50, maxY: 40 })
  })
})
