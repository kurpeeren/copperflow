// The shapes of the packages that were plain boxes: BGA, DIP, TO-220, TO-92 and the tabbed SOT-223 / SOT-89, and the
// two helpers they are made with (a prism lying along an axis, a lathe).
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../src/engine/design.js"
import { solidModel } from "../src/engine/solid/model.js"
import { FAMILY_LOOKS, familyOf } from "../studio/src/look/parts/family.js"
import { partFaces } from "../studio/src/look/parts/index.js"
import { lathe, lying } from "../studio/src/look/parts/kit.js"
import type { Face, Vec3 } from "../studio/src/look/scene.js"

const EPS = 1e-6
const PARTS: [string, string, number, number, number][] = [
  ["U1", "bga64_8x8_p0.8", 15, 15, 0],
  ["U2", "bga256_17x17_p1", 45, 15, 90],
  ["U3", "dip8", 70, 15, 0],
  ["U4", "dip28_w15.24", 95, 30, 0],
  ["Q1", "to220", 15, 45, 0],
  ["Q2", "to92", 35, 45, 0],
  ["Q3", "sot223", 55, 45, 0],
  ["Q4", "sot89", 75, 45, 90],
  ["Q5", "to220", 95, 55, 180],
]
const CIRCUIT = `export default () => (
  <board width="120mm" height="70mm">
${PARTS.map(([name, footprint, x, y, turn]) => `    <chip name="${name}" footprint="${footprint}" pcbX={${x}} pcbY={${y}} pcbRotation={${turn}} />`).join("\n")}
  </board>
)
`
const design: Design = buildDesign({ "main.circuit.tsx": CIRCUIT }, "main.circuit.tsx")
const model = solidModel(design)
const allFaces = partFaces(design, model)

function partOf(name: string) {
  const index = model.parts.findIndex((part) => part.name === name)
  return { faces: allFaces.filter((face) => face.part === index), solid: model.parts[index]!, placed: design.pcb.parts[index]! }
}

const points = (faces: readonly Face[]): Vec3[] => faces.flatMap((face) => face.loops.flat())
const centre = (face: Face): [number, number] => {
  const loop = face.loops[0] as Vec3[]
  return [loop.reduce((s, p) => s + p[0], 0) / loop.length, loop.reduce((s, p) => s + p[1], 0) / loop.length]
}
const zs = (faces: readonly Face[]) => points(faces).map((p) => p[2])

function onPad(pad: { x: number; y: number; width: number; height: number; rotation: number }, x: number, y: number, slack = 0.02): boolean {
  const radians = (-pad.rotation * Math.PI) / 180
  const [dx, dy] = [x - pad.x, y - pad.y]
  const [u, v] = [dx * Math.cos(radians) - dy * Math.sin(radians), dx * Math.sin(radians) + dy * Math.cos(radians)]
  return Math.abs(u) <= pad.width / 2 + slack && Math.abs(v) <= pad.height / 2 + slack
}

/** The unit normal a loop's winding gives (Newell's method), counter-clockwise seen from outside. */
function windingNormal(loop: readonly Vec3[]): Vec3 {
  let [nx, ny, nz] = [0, 0, 0]
  loop.forEach((p, i) => {
    const q = loop[(i + 1) % loop.length] as Vec3
    nx += (p[1] - q[1]) * (p[2] + q[2])
    ny += (p[2] - q[2]) * (p[0] + q[0])
    nz += (p[0] - q[0]) * (p[1] + q[1])
  })
  const length = Math.hypot(nx, ny, nz)
  return [nx / length, ny / length, nz / length]
}

/** Every loop of a face lies in one plane with the face's unit normal, and the outline winds counter-clockwise about it. */
function expectFlat(face: { loops: readonly (readonly Vec3[])[]; normal: Vec3 }, label: string) {
  const [nx, ny, nz] = face.normal
  expect(Math.hypot(nx, ny, nz), label).toBeCloseTo(1, 6)
  const origin = (face.loops[0] as Vec3[])[0] as Vec3
  for (const loop of face.loops) {
    for (const p of loop) expect(Math.abs((p[0] - origin[0]) * nx + (p[1] - origin[1]) * ny + (p[2] - origin[2]) * nz), label).toBeLessThan(1e-6)
  }
  const wound = windingNormal(face.loops[0] as Vec3[])
  expect(wound[0] * nx + wound[1] * ny + wound[2] * nz, label).toBeGreaterThan(0.999)
}

describe("the helpers of kit.ts", () => {
  const rectangle = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 2 }, { x: -1, y: 2 }]

  test("lying: a polygon in the y-z plane swept along x, with both end faces, every face flat and outward", () => {
    const pieces = lying(rectangle, 0, 5, [100, 100, 100], "matt", "body")
    expect(pieces).toHaveLength(6)
    pieces.forEach((piece, i) => expectFlat(piece, `face ${i}`))
    const ends = pieces.filter((piece) => Math.abs(piece.normal[0]) > 0.99).map((piece) => piece.normal[0]).sort()
    expect(ends).toEqual([-1, 1])
    const xs = points(pieces.map((piece) => ({ ...piece, part: 0, alpha: 1 }))).map((p) => p[0])
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 5])
    // The polygon's x is the part's y, its y the part's z.
    const top = pieces.find((piece) => piece.normal[2] > 0.99)!
    expect(top.loops[0]!.every((p) => p[2] === 2)).toBe(true)
  })

  test("lying: a round body (a half disc) stays flat on every face", () => {
    const half = Array.from({ length: 9 }, (_, i) => ({ x: 2 * Math.cos((Math.PI * i) / 8), y: 2 * Math.sin((Math.PI * i) / 8) }))
    const pieces = lying(half, -3, 3, [1, 2, 3], "metal", "body")
    expect(pieces).toHaveLength(2 + 9)
    pieces.forEach((piece, i) => expectFlat(piece, `face ${i}`))
  })

  test("lying: nothing for a span of no length or fewer than three corners", () => {
    expect(lying(rectangle, 2, 2, [0, 0, 0], "matt", "body")).toEqual([])
    expect(lying(rectangle.slice(0, 2), 0, 1, [0, 0, 0], "matt", "body")).toEqual([])
  })

  test("lathe: a profile turned about a vertical axis gives trapezoids, flat and outward, and a flat top", () => {
    const pieces = lathe([[1, 0], [1.5, 1], [1, 2]], 0, 0, 8, [9, 9, 9], "metal", "pin")
    expect(pieces).toHaveLength(8 * 2 + 1)
    pieces.forEach((piece, i) => expectFlat(piece, `face ${i}`))
    const barrel = pieces.filter((piece) => piece.loops[0]!.length === 4)
    expect(barrel).toHaveLength(16)
    for (const piece of barrel) {
      const [x, y] = [piece.loops[0]!.reduce((s, p) => s + p[0], 0), piece.loops[0]!.reduce((s, p) => s + p[1], 0)]
      expect(x * piece.normal[0] + y * piece.normal[1]).toBeGreaterThan(0)
    }
    expect(pieces.filter((piece) => piece.normal[2] === 1)).toHaveLength(1)
  })

  test("lathe: a profile that ends on the axis makes triangles and no flat top; it moves to its centre", () => {
    const pieces = lathe([[1, 0], [0, 1]], 5, -2, 6, [9, 9, 9], "matt", "body")
    expect(pieces).toHaveLength(6)
    expect(pieces.every((piece) => piece.loops[0]!.length === 3)).toBe(true)
    pieces.forEach((piece, i) => expectFlat(piece, `face ${i}`))
    expect(Math.min(...pieces.flatMap((piece) => piece.loops[0]!.map((p) => p[0])))).toBeGreaterThanOrEqual(4 - EPS)
  })

  test("lathe: nothing for a profile of one point", () => {
    expect(lathe([[1, 0]], 0, 0, 8, [0, 0, 0], "matt", "body")).toEqual([])
  })
})

describe("the new families are picked from the footprint", () => {
  test("by package name", () => {
    expect(familyOf("chip", "bga64_8x8_p0.8").family).toBe("bga")
    expect(familyOf("chip", "dip8", true, "U1").family).toBe("dip")
    expect(familyOf("chip", "to220", true, "Q1").family).toBe("to220")
    expect(familyOf("chip", "to92", true, "Q1").family).toBe("to92")
    expect(familyOf("chip", "sot223").family).toBe("tab")
    expect(familyOf("chip", "sot89").family).toBe("tab")
    expect(familyOf("chip", "sot23_5").family).toBe("gullwing")
    for (const name of ["bga", "dip", "to220", "to92", "tab"] as const) expect(FAMILY_LOOKS[name].sentence.length).toBeGreaterThan(10)
  })
})

describe("every new shape stays in its courtyard and height, flat and outward", () => {
  for (const [name, footprint] of PARTS) {
    test(`${name} ${footprint}`, () => {
      const { faces, solid, placed } = partOf(name)
      expect(faces.length).toBeGreaterThan(0)
      const xs = placed.courtyard.map((p) => p.x)
      const ys = placed.courtyard.map((p) => p.y)
      const thickness = model.board?.thickness ?? 1.6
      for (const [x, y, z] of points(faces.filter((face) => face.role !== "lead"))) {
        expect(x).toBeGreaterThanOrEqual(Math.min(...xs) - EPS)
        expect(x).toBeLessThanOrEqual(Math.max(...xs) + EPS)
        expect(y).toBeGreaterThanOrEqual(Math.min(...ys) - EPS)
        expect(y).toBeLessThanOrEqual(Math.max(...ys) + EPS)
        expect(z).toBeGreaterThanOrEqual(solid.bottom - EPS)
        expect(z).toBeLessThanOrEqual(solid.top + EPS)
      }
      for (const face of faces.filter((one) => one.role === "lead")) {
        const [x, y] = centre(face)
        expect(placed.pads.some((pad) => pad.layers === "through" && onPad(pad, x, y)), "a lead sits in its hole").toBe(true)
        for (const [, , z] of face.loops.flat()) expect(z).toBeGreaterThanOrEqual(-thickness - 2.5 - EPS)
      }
      faces.forEach((face, i) => expectFlat(face, `${name} face ${i}`))
      for (const pad of placed.pads) {
        const metal = faces.filter((face) => face.material === "metal" && face.role !== "board")
        expect(metal.some((face) => onPad(pad, ...centre(face))), `${name} pad ${pad.number}`).toBe(true)
      }
    })
  }
})

describe("a BGA", () => {
  test("a ball under every pad, a dark cap smaller than the substrate, pin 1 at ball A1", () => {
    for (const name of ["U1", "U2"]) {
      const { faces, placed, solid } = partOf(name)
      const balls = faces.filter((face) => face.role === "pin" && face.normal[2] > 0.99)
      expect(balls.length, name).toBe(placed.pads.length)
      for (const pad of placed.pads) expect(balls.some((face) => onPad(pad, ...centre(face))), `${name} ${pad.number}`).toBe(true)
      const bodies = faces.filter((face) => face.role === "body" && face.normal[2] > 0.99)
      expect(bodies.length, name).toBe(2)
      const [low, high] = [...bodies].sort((a, b) => a.loops[0]![0]![2] - b.loops[0]![0]![2]) as [Face, Face]
      const width = (face: Face) => Math.max(...face.loops[0]!.map((p) => p[0])) - Math.min(...face.loops[0]!.map((p) => p[0]))
      const depth = (face: Face) => Math.max(...face.loops[0]!.map((p) => p[1])) - Math.min(...face.loops[0]!.map((p) => p[1]))
      expect(width(high) * depth(high)).toBeLessThan(width(low) * depth(low))
      expect(Math.max(...high.color)).toBeLessThan(90)
      expect(high.loops[0]![0]![2]).toBeGreaterThan(low.loops[0]![0]![2])
      const dot = faces.find((face) => face.role === "pin1")!
      const [dx, dy] = centre(dot)
      const nearest = [...placed.pads].sort((a, b) => Math.hypot(a.x - dx, a.y - dy) - Math.hypot(b.x - dx, b.y - dy))[0]
      expect(nearest?.number, name).toBe("A1")
      expect(Math.max(...zs(faces))).toBeCloseTo(solid.top, 6)
    }
  })

  test("a 256-ball part stays cheap", () => {
    expect(partOf("U2").faces.length).toBeLessThan(3000)
    expect(partOf("U1").faces.length).toBeLessThan(1200)
  })
})

describe("a DIP", () => {
  test("a dark body raised off the board, a notch and a dot at pin 1, a leg and a lead on every pad", () => {
    for (const name of ["U3", "U4"]) {
      const { faces, placed, solid } = partOf(name)
      const body = faces.filter((face) => face.role === "body")
      expect(body.length, name).toBeGreaterThan(0)
      expect(Math.min(...zs(body)), name).toBeGreaterThan(solid.bottom + 0.1)
      expect(Math.max(...body.filter((face) => face.normal[2] > 0.99).flatMap((face) => face.color)), name).toBeLessThan(90)
      const marks = faces.filter((face) => face.role === "pin1" && face.normal[2] > 0.99)
      expect(marks.length, name).toBe(2)
      const one = placed.pads.find((pad) => pad.number === "1")!
      for (const mark of marks) {
        const [mx, my] = centre(mark)
        expect(Math.hypot(mx - one.x, my - one.y), name).toBeLessThan(Math.hypot(mx - one.x, my - (2 * placed.y - one.y)) + 1e-6)
      }
      for (const pad of placed.pads) {
        expect(faces.some((face) => face.role === "leg" && onPad(pad, ...centre(face))), `${name} leg ${pad.number}`).toBe(true)
        expect(faces.some((face) => face.role === "lead" && onPad(pad, ...centre(face))), `${name} lead ${pad.number}`).toBe(true)
      }
      expect(Math.min(...zs(faces.filter((face) => face.role === "lead")))).toBeLessThan(solid.bottom - 1.5)
    }
  })
})

describe("a TO-220", () => {
  test("the tab with its hole behind a dark body, three leads down into the holes, as tall as the part", () => {
    for (const name of ["Q1", "Q5"]) {
      const { faces, solid, placed } = partOf(name)
      const holed = faces.filter((face) => face.loops.length === 2 && face.material === "metal")
      expect(holed.length, name).toBe(2)
      expect(Math.max(...zs(faces.filter((face) => face.role !== "lead"))), name).toBeCloseTo(solid.top, 6)
      const body = faces.filter((face) => face.role === "body" && face.material === "matt")
      expect(body.length, name).toBeGreaterThan(0)
      expect(Math.max(...body.filter((face) => face.normal[2] > 0.99).flatMap((face) => face.color)), name).toBeLessThan(90)
      // The plastic stands in front of the tab (towards -y at rotation 0) and the tab rises above it.
      const [, by] = centre(body.find((face) => face.normal[2] > 0.99)!)
      const [, ty] = centre(holed[0]!)
      if (placed.rotation === 0) expect(by, name).toBeLessThan(ty - 0.5)
      if (placed.rotation === 180) expect(by, name).toBeGreaterThan(ty + 0.5)
      const plasticTop = Math.max(...zs(body))
      expect(Math.max(...zs(holed)), name).toBeGreaterThan(plasticTop + 2)
      for (const pad of placed.pads) expect(faces.filter((face) => face.role === "leg" && onPad(pad, ...centre(face))).length, `${name} ${pad.number}`).toBeGreaterThan(0)
    }
  })
})

describe("a TO-92", () => {
  test("a D-shaped body, flat face to the front and round back, raised on three leads", () => {
    const { faces, placed, solid } = partOf("Q2")
    const body = faces.filter((face) => face.role === "body")
    expect(Math.min(...zs(body))).toBeGreaterThan(solid.bottom + 0.1)
    const flat = body.filter((face) => face.normal[1] < -0.99)
    expect(flat.length).toBeGreaterThan(0)
    const round = body.filter((face) => face.normal[1] > 0.2 && Math.abs(face.normal[2]) < 1e-9)
    expect(round.length).toBeGreaterThan(4)
    for (const pad of placed.pads) expect(faces.some((face) => face.role === "leg" && onPad(pad, ...centre(face))), pad.number).toBe(true)
    expect(Math.max(...zs(faces.filter((face) => face.role !== "lead")))).toBeCloseTo(solid.top, 6)
  })
})

describe("a tabbed SOT", () => {
  test("a leg on every narrow pad and a flat tab as wide as the wide pad", () => {
    for (const name of ["Q3", "Q4"]) {
      const { faces, placed } = partOf(name)
      const wide = [...placed.pads].sort((a, b) => b.width * b.height - a.width * a.height)[0]!
      // The pad's size across the way the tab leaves the body (board frame: the pad's rotation is already placed).
      const turn = (wide.rotation * Math.PI) / 180
      const [ex, ey] = [Math.abs(wide.width * Math.cos(turn)) + Math.abs(wide.height * Math.sin(turn)), Math.abs(wide.width * Math.sin(turn)) + Math.abs(wide.height * Math.cos(turn))]
      const across = Math.abs(wide.x - placed.x) > Math.abs(wide.y - placed.y) ? ey : ex
      const feet = faces.filter((face) => face.role === "leg" && face.normal[2] > 0.99 && onPad(wide, ...centre(face)))
      expect(feet.length, name).toBeGreaterThan(0)
      const widest = Math.max(...feet.map((face) => {
        const loop = face.loops[0] as Vec3[]
        const spans = [Math.max(...loop.map((p) => p[0])) - Math.min(...loop.map((p) => p[0])), Math.max(...loop.map((p) => p[1])) - Math.min(...loop.map((p) => p[1]))]
        return Math.max(...spans)
      }))
      expect(widest, name).toBeGreaterThan(across * 0.9)
      expect(widest, name).toBeLessThanOrEqual(across + 0.02)
      for (const pad of placed.pads) expect(faces.some((face) => face.role === "leg" && face.normal[2] > 0.99 && onPad(pad, ...centre(face))), `${name} ${pad.number}`).toBe(true)
      const dot = faces.find((face) => face.role === "pin1")
      expect(dot, name).toBeDefined()
    }
  })
})
