// The shapes of the parts an Arduino Uno needs: the USB Type-B and Type-C receptacles, the barrel jack, the 6 × 6 tact
// switches (through-hole and surface-mount), the ceramic resonator and the shielded power inductors.
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../src/engine/design.js"
import { findPackages } from "../src/engine/footprints/catalogue.js"
import { generateFootprint } from "../src/engine/footprints/index.js"
import { partHeight } from "../src/engine/solid/heights.js"
import { solidModel } from "../src/engine/solid/model.js"
import { FAMILY_LOOKS, familyOf } from "../studio/src/look/parts/family.js"
import { partFaces } from "../studio/src/look/parts/index.js"
import type { Face, Vec3 } from "../studio/src/look/scene.js"

const EPS = 1e-6
const INDUCTORS = ["ind4x4", "ind5x5", "ind6x6", "ind8x8", "ind10x10", "ind12x12"]
/** [name, footprint, x, y] */
const PARTS: [string, string, number, number][] = [
  ["U1", "usb_b", 20, 25],
  ["U2", "usb_c16", 50, 22],
  ["J1", "dcjack", 80, 25],
  ["J2", "dcjack2.1", 105, 25],
  ["J3", "dcjack2.5", 130, 25],
  ["S1", "tact6x6", 20, 62],
  ["S2", "tact6x6_smd", 45, 62],
  ["Y1", "resonator3213", 70, 62],
  ...INDUCTORS.map((text, i): [string, string, number, number] => [`L${i + 1}`, text, 20 + i * 24, 95]),
]
const circuit = (heights: Readonly<Record<string, number>> = {}) => `export default () => (
  <board width="170mm" height="120mm">
${PARTS.map(([name, footprint, x, y]) => `    <chip name="${name}" footprint="${footprint}"${heights[name] === undefined ? "" : ` height="${heights[name]}mm"`} pcbX={${x}} pcbY={${y}} />`).join("\n")}
  </board>
)
`
const build = (heights: Readonly<Record<string, number>> = {}): Design => buildDesign({ "main.circuit.tsx": circuit(heights) }, "main.circuit.tsx")
const design = build()
const model = solidModel(design)
const allFaces = partFaces(design, model)

function partOf(name: string, from: { design: Design; model: ReturnType<typeof solidModel>; faces: readonly Face[] } = { design, model, faces: allFaces }) {
  const index = from.model.parts.findIndex((part) => part.name === name)
  return { faces: from.faces.filter((face) => face.part === index), solid: from.model.parts[index]!, placed: from.design.pcb.parts[index]! }
}

const points = (faces: readonly Face[]): Vec3[] => faces.flatMap((face) => face.loops.flat())
const centre = (face: Face): [number, number] => {
  const loop = face.loops[0] as Vec3[]
  return [loop.reduce((s, p) => s + p[0], 0) / loop.length, loop.reduce((s, p) => s + p[1], 0) / loop.length]
}
const dark = (face: Face) => Math.max(...face.color) < 40
const pale = (face: Face) => Math.min(...face.color) > 150

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

/** Every face is flat and wound as its normal says; every point of the body is in the courtyard and between the board and the height. */
function expectSound(name: string, from?: Parameters<typeof partOf>[1]) {
  const { faces, solid, placed } = partOf(name, from)
  const thickness = (from?.model ?? model).board?.thickness ?? 1.6
  const xs = placed.courtyard.map((p) => p.x)
  const ys = placed.courtyard.map((p) => p.y)
  expect(faces.length, name).toBeGreaterThan(0)
  for (const [x, y, z] of points(faces.filter((face) => face.role !== "lead"))) {
    expect(x, name).toBeGreaterThanOrEqual(Math.min(...xs) - EPS)
    expect(x, name).toBeLessThanOrEqual(Math.max(...xs) + EPS)
    expect(y, name).toBeGreaterThanOrEqual(Math.min(...ys) - EPS)
    expect(y, name).toBeLessThanOrEqual(Math.max(...ys) + EPS)
    expect(z, name).toBeGreaterThanOrEqual(solid.bottom - EPS)
    expect(z, name).toBeLessThanOrEqual(solid.top + EPS)
  }
  for (const [, , z] of points(faces.filter((face) => face.role === "lead"))) expect(z, name).toBeGreaterThanOrEqual(-thickness - 2.5 - EPS)
  faces.forEach((face, i) => expectFlat(face, `${name} face ${i}`))
}

describe("the families are picked from the footprint string", () => {
  test("one family per kind of part", () => {
    expect(familyOf("chip", "usb_b", true, "U1").family).toBe("usbb")
    expect(familyOf("chip", "usb_c16", true, "U1").family).toBe("usbc")
    for (const text of ["dcjack", "dcjack2.1", "dcjack2.5"]) expect(familyOf("chip", text, true, "J1").family, text).toBe("dcjack")
    for (const text of ["tact6x6", "tact6x6_smd"]) expect(familyOf("chip", text, false, "S1").family, text).toBe("tact")
    expect(familyOf("chip", "resonator3213", false, "Y1").family).toBe("resonator")
    for (const text of INDUCTORS) expect(familyOf("inductor", text, false, "L1").family, text).toBe("inductor")
  })

  test("each look says in a sentence what is drawn", () => {
    for (const name of ["usbb", "usbc", "dcjack", "tact", "resonator", "inductor"] as const) {
      expect(FAMILY_LOOKS[name].sentence.length, name).toBeGreaterThan(30)
    }
  })
})

describe("every shape stays in its courtyard and height, flat and outward", () => {
  for (const [name, footprint] of PARTS) test(`${name} ${footprint}`, () => expectSound(name))
})

describe("the heights are known, none assumed", () => {
  test("a row for every string, typical or read", () => {
    for (const [, footprint] of PARTS) {
      const found = partHeight({ footprint, props: {} })
      expect(found.assumed, footprint).toBe(false)
      expect(["typical", "read"], footprint).toContain(found.state)
      expect(found.height, footprint).toBeGreaterThan(0.5)
    }
  })

  test("the sizes the task names", () => {
    const height = (text: string) => partHeight({ footprint: text, props: {} }).height
    expect(height("usb_b")).toBeCloseTo(11, 1)
    expect(height("usb_c16")).toBeCloseTo(3.2, 1)
    expect(height("dcjack")).toBeCloseTo(11, 1)
    expect(height("dcjack2.5")).toBeCloseTo(11, 1)
    expect(height("tact6x6")).toBeCloseTo(4.3, 1)
    expect(height("tact6x6_smd")).toBeCloseTo(4.3, 1)
    expect(height("resonator3213")).toBeCloseTo(0.9, 1)
    expect(height("ind4x4")).toBeCloseTo(2, 1)
    expect(height("ind12x12")).toBeCloseTo(6, 1)
    const rising = INDUCTORS.map(height)
    rising.slice(1).forEach((h, i) => expect(h).toBeGreaterThan(rising[i]!))
  })
})

describe("face counts stay bounded", () => {
  test("each part, under 600", () => {
    for (const [name] of PARTS) expect(partOf(name).faces.length, name).toBeLessThan(600)
  })
  test("the receptacles, which have the most, under 300", () => {
    for (const name of ["U1", "U2", "J1"]) expect(partOf(name).faces.length, name).toBeLessThan(300)
  })
})

describe("a part three times as tall or 0.1 mm tall keeps flat faces inside its bounds", () => {
  const tall = Object.fromEntries(PARTS.map(([name, footprint]) => [name, 3 * partHeight({ footprint, props: {} }).height]))
  const flat = Object.fromEntries(PARTS.map(([name]) => [name, 0.1]))
  for (const [label, heights] of [["3 x", tall], ["0.1 mm", flat]] as const) {
    const changed = build(heights)
    const changedModel = solidModel(changed)
    const from = { design: changed, model: changedModel, faces: partFaces(changed, changedModel) }
    for (const [name, footprint] of PARTS) {
      test(`${name} ${footprint} at ${label}`, () => {
        expect(partOf(name, from).solid.height).toBeCloseTo(heights[name]!, 6)
        expectSound(name, from)
      })
    }
  }
})

describe("a USB Type-B receptacle", () => {
  const { faces, placed, solid } = partOf("U1")
  const shell = faces.filter((face) => face.material === "metal" && face.role === "body")
  test("a metal shell as tall as the part, open at the mating face with a dark opening and a pale tongue inside", () => {
    expect(Math.max(...points(shell).map((p) => p[2]))).toBeCloseTo(solid.top, 6)
    const frontY = Math.min(...points(faces.filter((face) => face.role !== "lead")).map((p) => p[1]))
    const openings = faces.filter((face) => dark(face) && face.normal[1] > 0.99 === false && face.normal[1] < -0.99)
    expect(openings.length).toBeGreaterThan(0)
    for (const face of openings) expect(centre(face)[1]).toBeGreaterThan(frontY + 1)
    expect(shell.filter((face) => face.normal[1] < -0.99).length).toBeGreaterThan(2)
    const tongue = faces.filter((face) => pale(face) && face.material === "matt")
    expect(tongue.length).toBeGreaterThan(2)
    expect(tongue.some((face) => face.normal[2] > 0.99)).toBe(true)
  })

  test("two shell legs and four pins, each through its hole", () => {
    const leads = faces.filter((face) => face.role === "lead")
    for (const pad of placed.pads) expect(leads.some((face) => onPad(pad, ...centre(face))), `pad ${pad.number}`).toBe(true)
    expect(placed.pads.filter((pad) => pad.number === "5").length).toBe(2)
  })
})

describe("a USB Type-C receptacle", () => {
  const { faces, placed, solid } = partOf("U2")
  test("a low shell with rounded ends, a dark stadium opening on the mating face and a thin pale tongue", () => {
    const shell = faces.filter((face) => face.material === "metal" && face.role === "body")
    expect(Math.max(...points(shell).map((p) => p[2]))).toBeCloseTo(solid.top, 6)
    const ring = shell.filter((face) => face.normal[1] < -0.99)
    expect(ring.length).toBeGreaterThan(8)
    const wide = Math.max(...points(ring).map((p) => p[0])) - Math.min(...points(ring).map((p) => p[0]))
    expect(wide).toBeGreaterThan(8)
    const tongue = faces.filter((face) => pale(face) && face.material === "matt")
    const thick = Math.max(...points(tongue).map((p) => p[2])) - Math.min(...points(tongue).map((p) => p[2]))
    expect(thick).toBeLessThan(1)
    expect(faces.filter((face) => dark(face) && face.normal[1] < -0.99).length).toBeGreaterThan(0)
  })

  test("metal on every signal pad and a lead in every shell slot", () => {
    for (const pad of placed.pads) {
      const found = pad.layers === "through" ? faces.some((face) => face.role === "lead" && onPad(pad, ...centre(face))) : faces.some((face) => face.material === "metal" && face.normal[2] > 0.99 && onPad(pad, ...centre(face)))
      expect(found, `pad ${pad.number}`).toBe(true)
    }
  })
})

describe("a DC barrel jack", () => {
  test("a black body with a round opening on the mating face, a metal pin in its middle, a terminal through each slot", () => {
    for (const name of ["J1", "J2", "J3"]) {
      const { faces, placed, solid } = partOf(name)
      const body = faces.filter((face) => face.role === "body" && face.material === "matt" && !dark(face))
      expect(Math.max(...body.flatMap((face) => face.color)), name).toBeLessThan(70)
      const front = faces.filter((face) => face.loops.length === 2 && face.normal[1] < -0.99)
      expect(front.length, name).toBe(1)
      expect((front[0]!.loops[1] as Vec3[]).length, name).toBeGreaterThan(8)
      const pin = faces.filter((face) => face.material === "metal" && face.role === "pin")
      expect(pin.length, name).toBeGreaterThan(6)
      const cx = placed.x
      for (const face of pin) expect(Math.abs(centre(face)[0] - cx), name).toBeLessThan(1.1)
      expect(Math.max(...points(faces.filter((face) => face.role !== "lead")).map((p) => p[2])), name).toBeCloseTo(solid.top, 6)
      for (const pad of placed.pads) expect(faces.some((face) => face.role === "lead" && onPad(pad, ...centre(face))), `${name} terminal ${pad.number}`).toBe(true)
    }
  })
})

describe("a 6 x 6 tact switch", () => {
  test("a black base, a tinned cover plate over it and a round black button out of its middle", () => {
    for (const name of ["S1", "S2"]) {
      const { faces, placed, solid } = partOf(name)
      const cover = faces.filter((face) => face.material === "metal" && face.normal[2] > 0.99 && face.role === "cap")
      expect(cover.length, name).toBe(1)
      const button = faces.filter((face) => face.role === "pin" && face.normal[2] > 0.99)
      expect(button.length, name).toBe(1)
      expect(Math.max(...button[0]!.loops[0]!.map((p) => p[2])), name).toBeCloseTo(solid.top, 6)
      expect(Math.abs(centre(button[0]!)[0] - placed.x), name).toBeLessThan(0.05)
      expect(Math.abs(centre(button[0]!)[1] - placed.y), name).toBeLessThan(0.05)
      expect(button[0]!.loops[0]!.length, name).toBeGreaterThan(8)
      expect(Math.max(...button[0]!.color), name).toBeLessThan(90)
    }
  })

  test("pins through the holes, or terminals on the pads", () => {
    const through = partOf("S1")
    expect(through.faces.filter((face) => face.role === "lead").length).toBeGreaterThan(0)
    const surface = partOf("S2")
    expect(surface.faces.some((face) => face.role === "lead")).toBe(false)
    for (const pad of surface.placed.pads) expect(surface.faces.some((face) => face.role === "leg" && face.normal[2] > 0.99 && onPad(pad, ...centre(face))), `pad ${pad.number}`).toBe(true)
  })
})

describe("the ceramic resonator", () => {
  test("a pale body under a tinned cap, a terminal on each of its three pads, 0.9 mm tall", () => {
    const { faces, placed, solid } = partOf("Y1")
    expect(solid.height).toBeCloseTo(0.9, 6)
    const body = faces.filter((face) => face.material === "matt" && face.role === "body")
    expect(body.length).toBeGreaterThan(3)
    expect(pale(body[0]!)).toBe(true)
    const cap = faces.filter((face) => face.material === "metal" && face.role === "cap" && face.normal[2] > 0.99)
    expect(cap.length).toBe(1)
    expect(Math.max(...points(cap).map((p) => p[2]))).toBeCloseTo(solid.top, 6)
    const across = (r: readonly Vec3[], axis: 0 | 1) => Math.max(...r.map((p) => p[axis])) - Math.min(...r.map((p) => p[axis]))
    expect(across(cap[0]!.loops[0]!, 0)).toBeGreaterThan(2.6)
    expect(placed.pads.length).toBe(3)
    for (const pad of placed.pads) expect(faces.some((face) => face.role === "leg" && onPad(pad, ...centre(face))), `pad ${pad.number}`).toBe(true)
  })
})

describe("the shielded power inductors", () => {
  test("a dark grey block with clipped corners, a lighter top with a small mark, a tinned terminal at each pad", () => {
    for (const [i, text] of INDUCTORS.entries()) {
      const name = `L${i + 1}`
      const { faces, placed, solid } = partOf(name)
      const top = faces.filter((face) => face.role === "body" && face.normal[2] > 0.99)
      expect(top.length, text).toBe(1)
      const [block] = top as [Face]
      const mark = faces.find((face) => face.role === "pin1" && face.normal[2] > 0.99)!
      expect(block.loops[0]!.length, text).toBeGreaterThanOrEqual(8)
      expect(Math.max(...block.color), text).toBeLessThan(110)
      const side = faces.find((face) => face.role === "body" && Math.abs(face.normal[2]) < 1e-9 && face.material === "matt")!
      expect(block.color[0], text).toBeGreaterThan(side.color[0])
      expect(Math.max(...mark.color), text).toBeGreaterThan(Math.max(...block.color))
      expect(Math.max(...mark.loops[0]!.map((p) => p[2])), text).toBeCloseTo(solid.top, 6)
      for (const pad of placed.pads) expect(faces.some((face) => face.material === "metal" && face.normal[2] > 0.99 && onPad(pad, ...centre(face))), `${text} pad ${pad.number}`).toBe(true)
    }
  })
})

describe("every package of the catalogue is drawn as more than a plain box", () => {
  test("a family other than box and block, and a height that is not assumed", () => {
    const failures: string[] = []
    for (const entry of findPackages([])) {
      const generated = generateFootprint(entry.footprint)
      if ("error" in generated) continue
      const through = generated.pads.some((pad) => pad.layers === "through")
      const { family } = familyOf("chip", entry.footprint, through, "U1")
      const found = partHeight({ footprint: entry.footprint, props: {} })
      if (family === "box" || family === "block" || found.assumed) failures.push(`${entry.footprint}: ${family}${found.assumed ? ", height assumed" : ""}`)
    }
    expect(failures).toEqual([])
  })
})
