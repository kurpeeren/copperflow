// The shapes of the surface-mount packages that were plain boxes: the smallest and largest chips, small diodes, MELF
// cylinders, small SOTs and exposed-pad chips, power SOTs with a tab, tantalum capacitors, resistor arrays, aluminium
// cans, crystals, PLCC LEDs and PLCC chips.
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../src/engine/design.js"
import { generateFootprint } from "../src/engine/footprints/index.js"
import { solidModel } from "../src/engine/solid/model.js"
import { FAMILY_LOOKS, familyOf } from "../studio/src/look/parts/family.js"
import { partFaces } from "../studio/src/look/parts/index.js"
import type { Face, Vec3 } from "../studio/src/look/scene.js"

const EPS = 1e-6

/** Every string, by the family it is drawn as. */
const FAMILIES: Record<string, string[]> = {
  chip: ["01005", "2220"],
  molded: ["sod523", "sod923", "sod123f", "sod128"],
  melf: ["minimelf", "sod80", "do213aa", "melf", "do213ab"],
  gullwing: [
    ...["sot323", "sot353", "sot363", "sc70", "sc70_5", "sc70_6", "sot523", "sot563", "sot723", "sot143", "sot23_8"],
    ...["msop8", "msop10", "qsop16", "qsop20", "qsop24", "qsop28", "smdip4", "smdip6", "smdip8", "smdip16"],
    ...["soic8_ep2.4x3.1", "tssop20_ep3x4.2", "msop8_ep1.6x1.8"],
  ],
  tab: ["dpak", "to252", "d2pak", "to263", "d2pak_5", "d2pak_7"],
  tantalum: ["tant_a", "tant_b", "tant_c", "tant_d", "tant_e", "tant3216", "tant3528", "tant6032", "tant7343"],
  array: ["array4x0603", "array4x0402", "array2x0402"],
  smdcan: ["smdcan4x5.4", "smdcan5x5.4", "smdcan6.3x5.4", "smdcan6.3x7.7", "smdcan8x6.5", "smdcan8x10.2", "smdcan10x10.2"],
  xtal: ["xtal2016", "xtal2520", "xtal3225", "xtal5032", "xtal7050", "xtal5032_2", "xtal3215", "hc49smd"],
  ledsmd: ["led3528", "led5050", "led5050_6"],
  plcc: ["plcc20", "plcc28", "plcc32", "plcc44", "plcc52", "plcc68", "plcc84"],
}
const STRINGS = Object.values(FAMILIES).flat()

/** The most faces a typical part of the family may have: the cost of drawing a board full of them. */
const FACE_LIMITS: Record<string, number> = { chip: 30, molded: 40, melf: 140, gullwing: 700, tab: 400, tantalum: 60, array: 160, smdcan: 360, xtal: 220, ledsmd: 160, plcc: 2000 }

/** Parts in rows on a wide board, each with room for its courtyard. */
function circuit(): string {
  const GAP = 3
  const WIDTH = 160
  let [x, y, rowHeight] = [GAP, GAP, 0]
  const lines = STRINGS.map((footprint, i) => {
    const found = generateFootprint(footprint)
    if ("error" in found) throw new Error(`${footprint}: ${found.error}`)
    const [xs, ys] = [found.courtyard.map((p) => p.x), found.courtyard.map((p) => p.y)]
    const [w, h] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
    if (x + w + GAP > WIDTH && x > GAP) [x, y, rowHeight] = [GAP, y + rowHeight + GAP, 0]
    const at = { x: x + w / 2 - (Math.max(...xs) + Math.min(...xs)) / 2, y: y + h / 2 - (Math.max(...ys) + Math.min(...ys)) / 2 }
    x += w + GAP
    rowHeight = Math.max(rowHeight, h)
    return { footprint, i, at }
  })
  const height = y + rowHeight + GAP
  const body = lines.map(({ footprint, i, at }) => `    <chip name="P${i}" footprint="${footprint}" pcbX={${at.x.toFixed(3)}} pcbY={${(height - at.y).toFixed(3)}} />`)
  return `export default () => (\n  <board width="${WIDTH}mm" height="${height.toFixed(2)}mm">\n${body.join("\n")}\n  </board>\n)\n`
}

const design: Design = buildDesign({ "main.circuit.tsx": circuit() }, "main.circuit.tsx")
const model = solidModel(design)
const allFaces = partFaces(design, model)

function partOf(footprint: string) {
  const name = `P${STRINGS.indexOf(footprint)}`
  const index = model.parts.findIndex((part) => part.name === name)
  return { faces: allFaces.filter((face) => face.part === index), solid: model.parts[index]!, placed: design.pcb.parts[index]! }
}

const points = (faces: readonly Face[]): Vec3[] => faces.flatMap((face) => face.loops.flat())
const centre = (face: Face): [number, number] => {
  const loop = face.loops[0] as Vec3[]
  return [loop.reduce((s, p) => s + p[0], 0) / loop.length, loop.reduce((s, p) => s + p[1], 0) / loop.length]
}
const top = (face: Face) => face.normal[2] > 0.99

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

function expectFlat(face: Face, label: string) {
  const [nx, ny, nz] = face.normal
  expect(Math.hypot(nx, ny, nz), label).toBeCloseTo(1, 6)
  const origin = (face.loops[0] as Vec3[])[0] as Vec3
  for (const loop of face.loops) {
    for (const p of loop) expect(Math.abs((p[0] - origin[0]) * nx + (p[1] - origin[1]) * ny + (p[2] - origin[2]) * nz), label).toBeLessThan(1e-6)
  }
  const wound = windingNormal(face.loops[0] as Vec3[])
  expect(wound[0] * nx + wound[1] * ny + wound[2] * nz, label).toBeGreaterThan(0.999)
}

const padOf = (placed: { pads: readonly { number: string }[] }, number: string) => placed.pads.find((pad) => pad.number === number)! as ReturnType<typeof partOf>["placed"]["pads"][number]
const nearest = (placed: ReturnType<typeof partOf>["placed"], face: Face) => {
  const [x, y] = centre(face)
  return [...placed.pads].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]!
}
const colour = (face: Face) => Math.max(...face.color)
const area = (face: Face) => {
  const xs = (face.loops[0] as Vec3[]).map((p) => p[0])
  const ys = (face.loops[0] as Vec3[]).map((p) => p[1])
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
}

describe("each package is drawn as the family made for it", () => {
  for (const [family, strings] of Object.entries(FAMILIES)) {
    test(family, () => {
      for (const footprint of strings) expect(familyOf("chip", footprint).family, footprint).toBe(family)
      expect(FAMILY_LOOKS[familyOf("chip", strings[0]!).look].sentence.length).toBeGreaterThan(20)
    })
  }

  test("a chip LED, resistor or capacitor of the big and tiny sizes keeps the kind's look", () => {
    expect(familyOf("resistor", "01005").look).toBe("resistor")
    expect(familyOf("capacitor", "2220").look).toBe("capacitor")
  })
})

describe("every shape stays in its courtyard and height, flat and outward, with metal over every pad", () => {
  for (const footprint of STRINGS) {
    test(footprint, () => {
      const { faces, solid, placed } = partOf(footprint)
      expect(faces.length).toBeGreaterThan(0)
      const [xs, ys] = [placed.courtyard.map((p) => p.x), placed.courtyard.map((p) => p.y)]
      for (const [x, y, z] of points(faces)) {
        expect(x).toBeGreaterThanOrEqual(Math.min(...xs) - EPS)
        expect(x).toBeLessThanOrEqual(Math.max(...xs) + EPS)
        expect(y).toBeGreaterThanOrEqual(Math.min(...ys) - EPS)
        expect(y).toBeLessThanOrEqual(Math.max(...ys) + EPS)
        expect(z).toBeGreaterThanOrEqual(solid.bottom - EPS)
        expect(z).toBeLessThanOrEqual(solid.top + EPS)
      }
      faces.forEach((face, i) => expectFlat(face, `${footprint} face ${i}`))
      const metal = faces.filter((face) => face.material === "metal" && face.role !== "board")
      for (const pad of placed.pads) expect(metal.some((face) => onPad(pad, ...centre(face))), `${footprint} pad ${pad.number}`).toBe(true)
    })
  }

  test("a part reaches its own height, and stays low enough to read from the number", () => {
    for (const footprint of STRINGS) {
      const { faces, solid } = partOf(footprint)
      const highest = Math.max(...points(faces).map((p) => p[2]))
      expect(highest, footprint).toBeGreaterThan(solid.bottom + solid.height * 0.9)
    }
  })

  test("the face counts stay cheap", () => {
    for (const [family, strings] of Object.entries(FAMILIES)) {
      for (const footprint of strings) expect(partOf(footprint).faces.length, footprint).toBeLessThan(FACE_LIMITS[family]!)
    }
    expect(partOf("plcc84").faces.length).toBeLessThan(2000)
  })
})

describe("the exposed pad under a body gets no leg", () => {
  for (const footprint of ["soic8_ep2.4x3.1", "tssop20_ep3x4.2", "msop8_ep1.6x1.8"]) {
    test(footprint, () => {
      const { faces, placed } = partOf(footprint)
      const exposed = placed.pads.reduce((best, pad) => (pad.width * pad.height > best.width * best.height ? pad : best))
      expect(faces.filter((face) => face.role === "leg" && onPad(exposed, ...centre(face)))).toEqual([])
      const others = placed.pads.filter((pad) => pad !== exposed)
      for (const pad of others) expect(faces.some((face) => face.role === "leg" && onPad(pad, ...centre(face))), `${footprint} ${pad.number}`).toBe(true)
      // The body is the whole outline, not the half that one row of legs would leave.
      const body = faces.find((face) => face.role === "body" && top(face))!
      const wide = (face: Face) => Math.max(...face.loops[0]!.map((p) => p[0])) - Math.min(...face.loops[0]!.map((p) => p[0]))
      expect(wide(body)).toBeGreaterThan(Math.abs(exposed.width) * 0.9)
    })
  }
})

describe("a MELF cylinder", () => {
  test("lies on the board between two metal caps, a band on the body at pad 2", () => {
    for (const footprint of FAMILIES["melf"]!) {
      const { faces, placed, solid } = partOf(footprint)
      const round = faces.filter((face) => face.role === "body" && Math.abs(face.normal[2]) < 0.99 && Math.abs(face.normal[0]) < 0.01)
      expect(round.length, footprint).toBeGreaterThanOrEqual(12)
      expect(Math.min(...points(faces).map((p) => p[2])) - solid.bottom, footprint).toBeLessThan(0.05)
      expect(Math.max(...points(faces).map((p) => p[2])) - solid.bottom, footprint).toBeCloseTo(solid.height, 2)
      const caps = faces.filter((face) => face.role === "cap" && face.material === "metal")
      expect(caps.length, footprint).toBeGreaterThan(8)
      for (const pad of placed.pads) expect(caps.some((face) => onPad(pad, ...centre(face))), `${footprint} ${pad.number}`).toBe(true)
      const band = faces.filter((face) => face.role === "cathode")
      expect(band.length, footprint).toBeGreaterThan(8)
      const [bx] = band.map((face) => centre(face)[0]).sort((a, b) => a - b).slice(-1)
      expect(bx! - placed.x, footprint).toBeGreaterThan(0)
      expect(Math.max(...band.flatMap((face) => face.color)), footprint).toBeGreaterThan(150)
    }
  })
})

describe("a power SOT with a tab", () => {
  test("a leg on every narrow pad, the tab as wide as its pad, a body that is not the tab's length", () => {
    for (const footprint of FAMILIES["tab"]!) {
      const { faces, placed } = partOf(footprint)
      const wide = placed.pads.reduce((best, pad) => (pad.width * pad.height > best.width * best.height ? pad : best))
      const narrow = placed.pads.filter((pad) => pad !== wide)
      for (const pad of narrow) expect(faces.some((face) => face.role === "leg" && top(face) && onPad(pad, ...centre(face))), `${footprint} ${pad.number}`).toBe(true)
      const feet = faces.filter((face) => face.role === "leg" && top(face) && onPad(wide, ...centre(face)))
      expect(feet.length, footprint).toBeGreaterThan(0)
      const across = Math.min(wide.width, wide.height)
      const widest = Math.max(...feet.map((face) => Math.max(...[0, 1].map((k) => Math.max(...face.loops[0]!.map((p) => p[k]!)) - Math.min(...face.loops[0]!.map((p) => p[k]!))))))
      expect(widest, footprint).toBeGreaterThan(across * 0.9)
      const body = faces.find((face) => face.role === "body" && top(face))!
      const ys = body.loops[0]!.map((p) => p[1])
      const tabEnd = Math.max(...placed.courtyard.map((p) => p.y))
      expect(Math.max(...ys), footprint).toBeLessThan(tabEnd - 0.5)
    }
  })

  test("two, five and seven legs", () => {
    for (const [footprint, legs] of [["dpak", 2], ["d2pak", 2], ["d2pak_5", 5], ["d2pak_7", 7]] as const) {
      const { faces, placed } = partOf(footprint)
      const wide = placed.pads.reduce((best, pad) => (pad.width * pad.height > best.width * best.height ? pad : best))
      const narrow = placed.pads.filter((pad) => pad !== wide)
      expect(narrow.length, footprint).toBe(legs)
      for (const pad of narrow) expect(faces.filter((face) => face.role === "leg" && top(face) && onPad(pad, ...centre(face))).length, `${footprint} ${pad.number}`).toBeGreaterThan(0)
    }
  })
})

describe("a tantalum capacitor", () => {
  test("an amber block with a darker stripe over the plus end (pad 1) and tinned ends", () => {
    for (const footprint of FAMILIES["tantalum"]!) {
      const { faces, placed } = partOf(footprint)
      const stripe = faces.filter((face) => face.role === "pin1" && top(face))
      expect(stripe.length, footprint).toBe(1)
      const [sx] = centre(stripe[0]!)
      const [one, two] = [padOf(placed, "1"), padOf(placed, "2")]
      expect(Math.abs(sx - one.x), footprint).toBeLessThan(Math.abs(sx - two.x))
      const body = faces.find((face) => face.role === "body" && top(face))!
      expect(colour(stripe[0]!), footprint).toBeLessThan(colour(body))
      const [r, g, b] = body.color
      expect(r, footprint).toBeGreaterThan(g)
      expect(g, footprint).toBeGreaterThan(b)
      for (const pad of [one, two]) expect(faces.some((face) => face.role === "cap" && face.material === "metal" && onPad(pad, ...centre(face))), `${footprint} ${pad.number}`).toBe(true)
      // The stripe lies inside the body's top, not on the terminals.
      const xs = body.loops[0]!.map((p) => p[0])
      for (const p of stripe[0]!.loops[0]!) expect(p[0]).toBeGreaterThanOrEqual(Math.min(...xs) - EPS)
    }
  })
})

describe("a resistor array", () => {
  test("one dark-topped body and a tinned terminal on every pad", () => {
    for (const footprint of FAMILIES["array"]!) {
      const { faces, placed } = partOf(footprint)
      const bodies = faces.filter((face) => face.role === "body" && top(face))
      expect(bodies.length, footprint).toBe(1)
      expect(colour(bodies[0]!), footprint).toBeLessThan(90)
      for (const pad of placed.pads) expect(faces.filter((face) => face.material === "metal" && top(face) && onPad(pad, ...centre(face))).length, `${footprint} ${pad.number}`).toBeGreaterThan(0)
    }
  })
})

describe("an aluminium can", () => {
  test("a clipped plastic base under a rounded can, a dark segment on the lid at pad 2", () => {
    for (const footprint of FAMILIES["smdcan"]!) {
      const { faces, placed, solid } = partOf(footprint)
      const base = faces.filter((face) => face.role === "body" && face.material === "matt" && top(face))
      expect(base.length, footprint).toBeGreaterThanOrEqual(1)
      // Six corners: a square with two corners clipped on the plus side.
      const outline = base.find((face) => face.loops[0]!.length === 6)
      expect(outline, footprint).toBeDefined()
      const [one, two] = [padOf(placed, "1"), padOf(placed, "2")]
      const clipped = outline!.loops[0]!.map((p) => p[0])
      expect(Math.abs(Math.min(...clipped) - one.x), footprint).toBeLessThan(Math.abs(Math.min(...clipped) - two.x))
      expect(Math.max(...faces.filter((face) => face.role === "body").flatMap((face) => face.loops[0]!.map((p) => p[2]))) - solid.bottom, footprint).toBeCloseTo(solid.height, 1)
      const lathed = faces.filter((face) => face.material === "metal" && face.loops[0]!.length === 4 && Math.abs(face.normal[2]) < 0.99)
      expect(lathed.length, footprint).toBeGreaterThan(20)
      const lid = faces.filter((face) => face.role === "cathode" && top(face))
      expect(lid.length, footprint).toBe(1)
      const [lx] = centre(lid[0]!)
      expect(Math.abs(lx - two.x), footprint).toBeLessThan(Math.abs(lx - one.x))
      expect(colour(lid[0]!), footprint).toBeLessThan(90)
      for (const pad of placed.pads) expect(faces.some((face) => face.material === "metal" && face.role === "leg" && onPad(pad, ...centre(face))), `${footprint} ${pad.number}`).toBe(true)
    }
  })
})

describe("a crystal", () => {
  test("a metal lid smaller than the ceramic base on the four-pad and two-pad packages", () => {
    for (const footprint of FAMILIES["xtal"]!.filter((one) => one !== "hc49smd")) {
      const { faces } = partOf(footprint)
      const tops = faces.filter((face) => face.role === "body" && top(face)).sort((a, b) => a.loops[0]![0]![2] - b.loops[0]![0]![2])
      expect(tops.length, footprint).toBeGreaterThanOrEqual(2)
      const [base, lid] = [tops[0]!, tops[tops.length - 1]!]
      expect(area(lid), footprint).toBeLessThan(area(base))
      expect(lid.loops[0]![0]![2], footprint).toBeGreaterThan(base.loops[0]![0]![2])
      expect(lid.material, footprint).toBe("metal")
    }
  })

  test("the HC-49 SMD is a can with rounded ends on a low base, a flat lead on each pad", () => {
    const { faces, placed } = partOf("hc49smd")
    const can = faces.filter((face) => face.role === "body" && face.material === "metal" && top(face))
    expect(can.length).toBe(1)
    expect(can[0]!.loops[0]!.length).toBeGreaterThan(16)
    const seat = faces.filter((face) => face.role === "body" && face.material === "matt" && top(face))
    expect(seat.length).toBeGreaterThan(0)
    expect(seat[0]!.loops[0]![0]![2]).toBeLessThan(can[0]!.loops[0]![0]![2] - 1)
    for (const pad of placed.pads) expect(faces.some((face) => face.role === "leg" && top(face) && onPad(pad, ...centre(face))), pad.number).toBe(true)
  })
})

describe("an SMD LED", () => {
  test("a white body with a round pale lens and a mark: a clipped corner at pad 1 on the four- and six-pad, the cathode on the two-pad", () => {
    for (const footprint of FAMILIES["ledsmd"]!) {
      const { faces, placed } = partOf(footprint)
      const bodies = faces.filter((face) => face.role === "body" && top(face) && face.material === "matt")
      const body = bodies.reduce((best, face) => (area(face) > area(best) ? face : best))
      expect(Math.min(...body.color), footprint).toBeGreaterThan(200)
      const lens = faces.filter((face) => face.role === "body" && top(face) && face.loops[0]!.length > 8)
      expect(lens.length, footprint).toBeGreaterThan(0)
      expect(area(lens[0]!), footprint).toBeLessThan(area(body))
      if (placed.pads.length === 2) {
        const mark = faces.find((face) => face.role === "cathode" && top(face))!
        const [mx] = centre(mark)
        expect(Math.abs(mx - padOf(placed, "2").x), footprint).toBeLessThan(Math.abs(mx - padOf(placed, "1").x))
      } else {
        expect(body.loops[0]!.length, footprint).toBe(5)
        const [one] = [padOf(placed, "1")]
        const corners = body.loops[0]!
        const cx = (Math.min(...corners.map((p) => p[0])) + Math.max(...corners.map((p) => p[0]))) / 2
        const cy = (Math.min(...corners.map((p) => p[1])) + Math.max(...corners.map((p) => p[1]))) / 2
        const missing = [[-1, -1], [1, -1], [1, 1], [-1, 1]].find(([sx, sy]) => !corners.some((p) => Math.abs(p[0] - (cx + sx! * 2.5)) < 0.05 && Math.abs(p[1] - (cy + sy! * 2.5)) < 0.05))!
        expect(Math.sign(one.x - cx), footprint).toBe(missing[0])
        expect(Math.sign(one.y - cy), footprint).toBe(missing[1])
      }
      for (const pad of placed.pads) expect(faces.some((face) => face.role === "cap" && face.material === "metal" && onPad(pad, ...centre(face))), `${footprint} ${pad.number}`).toBe(true)
    }
  })
})

describe("a PLCC", () => {
  test("a dark body with a clipped corner and a dot at pin 1, a J-lead of riser and foot on every pad", () => {
    for (const footprint of FAMILIES["plcc"]!) {
      const { faces, placed, solid } = partOf(footprint)
      const body = faces.find((face) => face.role === "body" && top(face))!
      expect(colour(body), footprint).toBeLessThan(90)
      expect(body.loops[0]!.length, footprint).toBe(5)
      const dot = faces.filter((face) => face.role === "pin1" && top(face))
      expect(dot.length, footprint).toBe(1)
      const [dx, dy] = centre(dot[0]!)
      expect(nearest(placed, dot[0]!).number, footprint).toBe("1")
      expect(Math.hypot(dx - padOf(placed, "1").x, dy - padOf(placed, "1").y), footprint).toBeLessThan(padOf(placed, "1").height + 3)
      for (const pad of placed.pads) {
        const mine = faces.filter((face) => face.role === "leg" && onPad(pad, ...centre(face)))
        expect(mine.some((face) => top(face) && face.loops[0]!.every((p) => p[2] - solid.bottom < 0.3)), `${footprint} foot ${pad.number}`).toBe(true)
        expect(mine.some((face) => top(face) && face.loops[0]![0]![2] - solid.bottom > 0.5), `${footprint} riser ${pad.number}`).toBe(true)
      }
    }
  })

  test("the foot is tucked under the body, the riser stands outside its side", () => {
    const { faces, placed, solid } = partOf("plcc20")
    const body = faces.find((face) => face.role === "body" && top(face))!
    const [minX, maxX] = [Math.min(...body.loops[0]!.map((p) => p[0])), Math.max(...body.loops[0]!.map((p) => p[0]))]
    const right = placed.pads.find((pad) => pad.x > maxX - 1.2 && pad.width > pad.height)!
    const mine = faces.filter((face) => face.role === "leg" && top(face) && onPad(right, ...centre(face)))
    const foot = mine.find((face) => face.loops[0]!.every((p) => p[2] - solid.bottom < 0.3))!
    expect(Math.min(...foot.loops[0]!.map((p) => p[0]))).toBeLessThan(maxX - 0.5)
    const riser = mine.find((face) => face.loops[0]![0]![2] - solid.bottom > 0.5)!
    expect(Math.min(...riser.loops[0]!.map((p) => p[0]))).toBeGreaterThanOrEqual(maxX - EPS)
    expect(maxX - minX).toBeGreaterThan(8)
  })
})

describe("the chips and diodes", () => {
  test("the tiny and the large chip are a body between two caps; the flat-lead diodes are low", () => {
    for (const footprint of ["01005", "2220", "sod523", "sod923", "sod123f", "sod128"]) {
      const { faces, solid } = partOf(footprint)
      expect(Math.max(...points(faces).map((p) => p[2])), footprint).toBeCloseTo(solid.top, 1)
      expect(solid.height, footprint).toBeGreaterThan(0.1)
    }
    expect(partOf("sod523").solid.height).toBeLessThan(partOf("sod123f").solid.height + 1e-9)
    expect(partOf("sod923").solid.height).toBeLessThan(0.5)
  })
})

/** One part per string, each given a `height` prop, on a wide board. */
function tallDesign(cases: readonly (readonly [string, string])[]) {
  const lines = cases.map(([footprint, height], i) => `    <chip name="H${i}" footprint="${footprint}" height="${height}" pcbX={${15 + (i % 6) * 40}} pcbY={${20 + Math.floor(i / 6) * 40}} />`)
  const built = buildDesign({ "main.circuit.tsx": `export default () => (\n  <board width="260mm" height="400mm">\n${lines.join("\n")}\n  </board>\n)\n` }, "main.circuit.tsx")
  const solids = solidModel(built)
  return { built, solids, faces: partFaces(built, solids) }
}

function expectSound(cases: readonly (readonly [string, string])[]) {
  const { built, solids, faces } = tallDesign(cases)
  cases.forEach(([footprint, height], i) => {
    const index = solids.parts.findIndex((part) => part.name === `H${i}`)
    const [solid, placed] = [solids.parts[index]!, built.pcb.parts[index]!]
    const mine = faces.filter((face) => face.part === index)
    const label = `${footprint} at ${height}`
    expect(mine.length, label).toBeGreaterThan(0)
    const [xs, ys] = [placed.courtyard.map((p) => p.x), placed.courtyard.map((p) => p.y)]
    for (const [x, y, z] of points(mine)) {
      expect(x, label).toBeGreaterThanOrEqual(Math.min(...xs) - EPS)
      expect(x, label).toBeLessThanOrEqual(Math.max(...xs) + EPS)
      expect(y, label).toBeGreaterThanOrEqual(Math.min(...ys) - EPS)
      expect(y, label).toBeLessThanOrEqual(Math.max(...ys) + EPS)
      expect(z, label).toBeGreaterThanOrEqual(solid.bottom - EPS)
      expect(z, label).toBeLessThanOrEqual(solid.top + EPS)
    }
    mine.forEach((face, k) => expectFlat(face, `${label} face ${k}`))
  })
}

describe("a part given a height far from its table height", () => {
  test("three times as tall: still flat faces inside the courtyard", () => {
    expectSound(STRINGS.filter((_, i) => i % 3 === 0 || ["minimelf", "melf", "smdcan5x5.4", "led5050", "hc49smd", "xtal3225", "tant_a", "plcc20", "array4x0603", "dpak", "soic8_ep2.4x3.1"].includes(STRINGS[i]!)).map((s) => [s, `${(3 * partOf(s).solid.height).toFixed(2)}mm`] as const))
  })

  test("a tenth of a millimetre: every piece between the board and the height", () => {
    expectSound([["soic8", "0.1mm"], ["smdcan5x5.4", "0.1mm"], ["led5050", "0.1mm"], ["led3528", "0.1mm"], ["minimelf", "0.1mm"], ["plcc20", "0.1mm"], ["xtal3225", "0.1mm"], ["tant_a", "0.1mm"], ["dpak", "0.1mm"], ["hc49smd", "0.1mm"]])
  })
})
