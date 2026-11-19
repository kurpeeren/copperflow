// The shapes of the new through-hole packages: axial parts, round LEDs, screw terminals, pin sockets, the TO-220 family
// at two, three and five leads (and the TO-247 and TO-126), and the TO-92 with straight leads.
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../src/engine/design.js"
import { solidModel } from "../src/engine/solid/model.js"
import { FAMILY_LOOKS, familyOf } from "../studio/src/look/parts/family.js"
import { partFaces } from "../studio/src/look/parts/index.js"
import type { Face, Vec3 } from "../studio/src/look/scene.js"
import { screwShape } from "../studio/src/look/parts/screw.js"
import { dShape } from "../studio/src/look/parts/to92.js"
import type { ShapeInput } from "../studio/src/look/parts/input.js"

const EPS = 1e-6
/** [tag, name, footprint, x, y, extra attributes] */
const PARTS: [string, string, string, number, number, string][] = [
  ["resistor", "R1", "axial6.3x10.16", 15, 10, 'resistance="1k"'],
  ["resistor", "R2", "axial3.5x7.62", 35, 10, 'resistance="1k"'],
  ["resistor", "R3", "axial9x15.24_d3.5", 60, 10, 'resistance="1k"'],
  ["diode", "D1", "do41", 85, 10, ""],
  ["diode", "D2", "do35", 105, 10, ""],
  ["chip", "X1", "do15", 130, 10, ""],
  ["chip", "X2", "axial6.3x10.16", 155, 10, ""],
  ["led", "LED1", "led3mm", 15, 35, ""],
  ["led", "LED2", "led5mm", 30, 35, ""],
  ["led", "LED3", "led5mm", 45, 35, 'color="green"'],
  ["led", "LED4", "led5mm", 60, 35, 'color="mauve"'],
  ["chip", "J1", "screw2", 85, 35, ""],
  ["chip", "J2", "screw4_p3.5mm", 110, 35, ""],
  ["chip", "J3", "screw24", 100, 85, ""],
  ["chip", "P1", "socket4", 15, 65, ""],
  ["chip", "P2", "socket2x20", 60, 62, ""],
  ["chip", "Q1", "to247", 15, 110, ""],
  ["chip", "Q2", "to126", 40, 110, ""],
  ["chip", "Q3", "to220_2", 60, 110, ""],
  ["chip", "Q4", "to220_5", 85, 110, ""],
  ["chip", "Q5", "to92", 105, 110, ""],
  ["resistor", "A1", "axial1x5", 140, 110, 'resistance="1k"'],
  ["resistor", "A2", "axial7x10.16_d0.5", 155, 110, 'resistance="1k"'],
  ["chip", "H1", "pinrow4_p2mm", 15, 85, ""],
  ["chip", "H2", "pinrow2x3_p2mm", 35, 85, ""],
  ["chip", "Q6", "to220", 125, 110, ""],
]
const CIRCUIT = `export default () => (
  <board width="180mm" height="130mm">
${PARTS.map(([tag, name, footprint, x, y, extra]) => `    <${tag} name="${name}" ${extra} footprint="${footprint}" pcbX={${x}} pcbY={${y}} />`).join("\n")}
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
const dark = (face: Face) => Math.max(...face.color) < 40

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

describe("the families are picked from the footprint and the kind", () => {
  test("by package name", () => {
    for (const text of ["axial6.3x10.16", "axial9x15.24_d3.5", "do35", "do41", "do15", "do201ad"]) expect(familyOf("chip", text, true, "X1").family, text).toBe("axial")
    expect(familyOf("chip", "do214ac").family).toBe("molded")
    expect(familyOf("chip", "led3mm", true, "LED1").family).toBe("ledth")
    expect(familyOf("chip", "led5mm", true, "LED1").family).toBe("ledth")
    expect(familyOf("chip", "screw2", true, "J1").family).toBe("screw")
    expect(familyOf("chip", "screw4_p3.5mm", true, "J1").family).toBe("screw")
    expect(familyOf("chip", "socket4", true, "P1").family).toBe("socket")
    expect(familyOf("chip", "socket2x20", true, "P1").family).toBe("socket")
    expect(familyOf("chip", "pinrow4", true, "P1").family).toBe("header")
    for (const text of ["to220", "to220_2", "to220_5", "to247", "to126"]) expect(familyOf("chip", text, true, "Q1").family, text).toBe("to220")
    expect(familyOf("chip", "pinrow4_p2mm", true, "J1").family).toBe("header")
    expect(familyOf("chip", "pinrow4_p1.27mm", true, "J1").family).toBe("header")
    expect(familyOf("chip", "pinrow4_p5.08mm", true, "J1").family).toBe("block")
  })

  test("the look of an axial part follows what the part is", () => {
    expect(familyOf("resistor", "axial6.3x10.16", true, "R1").look).toBe("axialResistor")
    expect(familyOf("diode", "axial6.3x10.16", true, "D1").look).toBe("axialDiode")
    expect(familyOf("diode", "do41", true, "D1").look).toBe("axialDiode")
    expect(familyOf("chip", "do41", true, "X1").look).toBe("axialDiode")
    expect(familyOf("diode", "do35", true, "D1").look).toBe("axialGlass")
    expect(familyOf("chip", "axial6.3x10.16", true, "X1").look).toBe("axialPlain")
    for (const name of ["axialResistor", "axialDiode", "axialGlass", "axialPlain", "ledlens", "screw", "socket"] as const) expect(FAMILY_LOOKS[name].sentence.length).toBeGreaterThan(10)
    expect(FAMILY_LOOKS.axialResistor.sentence).toMatch(/band/i)
    expect(FAMILY_LOOKS.axialResistor.sentence).toMatch(/not.*value/i)
  })
})

describe("every new shape stays in its courtyard and height, flat and outward, with a lead in every hole", () => {
  for (const [, name, footprint] of PARTS) {
    test(`${name} ${footprint}`, () => {
      const { faces, solid, placed } = partOf(name)
      expect(faces.length).toBeGreaterThan(0)
      expect(solid.assumed).toBe(false)
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
      expect(Math.max(...zs(faces.filter((face) => face.role !== "lead")))).toBeGreaterThan(solid.top - 0.3)
      for (const face of faces.filter((one) => one.role === "lead")) {
        const [x, y] = centre(face)
        expect(placed.pads.some((pad) => pad.layers === "through" && onPad(pad, x, y)), "a lead sits in its hole").toBe(true)
        for (const [, , z] of face.loops.flat()) expect(z).toBeGreaterThanOrEqual(-thickness - 2.5 - EPS)
      }
      for (const pad of placed.pads) {
        expect(faces.some((face) => face.role === "lead" && onPad(pad, ...centre(face))), `${name} lead ${pad.number}`).toBe(true)
      }
      faces.forEach((face, i) => expectFlat(face, `${name} face ${i}`))
    })
  }
})

describe("face counts stay bounded", () => {
  test("per family", () => {
    const limits: Record<string, number> = { R1: 200, R3: 200, D1: 150, LED5: 400, LED2: 400, J1: 120, J2: 200, J3: 2000, P1: 120, P2: 2000, Q1: 250, Q2: 250, Q3: 200, Q4: 250, Q5: 150, Q6: 200 }
    for (const [name, limit] of Object.entries(limits)) expect(partOf(name === "LED5" ? "LED2" : name).faces.length, name).toBeLessThan(limit)
  })
})

describe("axial parts", () => {
  test("a round body lying a little above the board, a wire from each end bent down into its hole", () => {
    const { faces, placed, solid } = partOf("R1")
    const body = faces.filter((face) => face.role === "body")
    expect(Math.min(...zs(body))).toBeGreaterThan(solid.bottom + 0.1)
    // A wire leaves each end of the body at the height of its axis, and a leg runs down to the board at each pad.
    for (const pad of placed.pads) expect(faces.some((face) => face.role === "leg" && onPad(pad, ...centre(face))), pad.number).toBe(true)
    const legs = faces.filter((face) => face.role === "leg")
    expect(Math.min(...zs(legs))).toBeLessThan(solid.bottom + 0.01)
    expect(Math.max(...zs(legs))).toBeLessThan(solid.top)
    // The diameter by body length: 6.3 mm long is 2.5 mm across, and a gap above the board.
    expect(solid.height).toBeGreaterThan(2.5)
    expect(solid.height).toBeLessThan(3.2)
  })

  test("a resistor is beige with three or four coloured bands that do not come from its value", () => {
    for (const [name, bands] of [["R1", 4], ["R2", 3]] as const) {
      const { faces } = partOf(name)
      const body = faces.filter((face) => face.role === "body")
      const colours = new Set(body.map((face) => face.color.join(",")))
      const beige = FAMILY_LOOKS.axialResistor.body.join(",")
      expect(colours.has(beige), name).toBe(true)
      expect(colours.size - 1, name).toBe(bands)
    }
  })

  test("a diode is dark with a pale band at the cathode (pad 2) end, and a do35 is orange glass with a dark band", () => {
    for (const name of ["D1", "X1"]) {
      const { faces, placed } = partOf(name)
      const cathode = faces.filter((face) => face.role === "cathode")
      expect(cathode.length, name).toBeGreaterThan(0)
      const two = placed.pads.find((pad) => pad.number === "2")!
      const one = placed.pads.find((pad) => pad.number === "1")!
      for (const face of cathode) {
        const [x] = centre(face)
        expect(Math.abs(x - two.x), name).toBeLessThan(Math.abs(x - one.x))
      }
      expect(Math.max(...cathode.flatMap((face) => face.color)), name).toBeGreaterThan(150)
    }
    const dark35 = partOf("D1").faces.find((face) => face.role === "body" && face.normal[2] > 0.9)!
    expect(dark35.color[0]).toBeLessThan(90)
    const glass = partOf("D2")
    const orange = glass.faces.find((face) => face.role === "body" && face.normal[2] > 0.9)!
    expect(orange.color[0]).toBeGreaterThan(180)
    expect(orange.color[2]).toBeLessThan(120)
    expect(glass.faces.filter((face) => face.role === "cathode").every((face) => Math.max(...face.color) < 90)).toBe(true)
  })

  test("any other axial part is a plain grey body", () => {
    const { faces } = partOf("X2")
    const body = faces.filter((face) => face.role === "body")
    expect(new Set(body.map((face) => face.color.join(","))).size).toBe(1)
    const [r, g, b] = body[0]!.color
    expect(Math.abs(r - g)).toBeLessThan(20)
    expect(Math.abs(g - b)).toBeLessThan(20)
  })

  test("the diameter is _d or by body length: 3.5 mm for the 9 mm body with _d3.5", () => {
    const { solid } = partOf("R3")
    expect(solid.height).toBeGreaterThan(3.5)
    expect(solid.height).toBeLessThan(4.2)
  })
})

const spanOf = (face: Face, axis: 0 | 1) => {
  const values = face.loops.flat().map((p) => p[axis])
  return Math.max(...values) - Math.min(...values)
}
const spanX = (face: Face) => spanOf(face, 0)
/** At least one round of the lathe's sides: the epoxy is more than a few faces. */
const SIDES_AT_LEAST = 24

describe("a round LED", () => {
  test("a flange ring on the board, a cylinder and a dome on top, two leads, the flat at the cathode", () => {
    for (const name of ["LED1", "LED2"]) {
      const { faces, placed, solid } = partOf(name)
      const body = faces.filter((face) => face.role === "body")
      expect(Math.min(...zs(body)), name).toBeCloseTo(solid.bottom, 6)
      const flat = faces.filter((face) => face.role === "cathode")
      expect(flat.length, name).toBeGreaterThan(0)
      const two = placed.pads.find((pad) => pad.number === "2")!
      for (const face of flat) {
        expect(Math.abs(face.normal[0]), name).toBeGreaterThan(0.99)
        expect(centre(face)[0] - placed.x, name).toBeGreaterThan(0)
        expect(Math.abs(centre(face)[0] - two.x), name).toBeLessThan(2)
      }
      // The dome narrows to a point at the top.
      const topZ = Math.max(...zs(body))
      expect(topZ, name).toBeCloseTo(solid.top, 6)
    }
  })

  test("the epoxy is see-through: every flange and lens face has an alpha below 1, the metal inside is opaque", () => {
    for (const name of ["LED1", "LED2"]) {
      const { faces } = partOf(name)
      const epoxy = faces.filter((face) => face.role === "body" || face.role === "cathode")
      expect(epoxy.length, name).toBeGreaterThan(SIDES_AT_LEAST)
      for (const face of epoxy) {
        expect(face.alpha, name).toBeGreaterThan(0.2)
        expect(face.alpha, name).toBeLessThan(1)
      }
      for (const face of faces.filter((one) => one.material === "metal")) expect(face.alpha, name).toBe(1)
    }
  })

  test("inside the lens the cathode's wide anvil (pad 2) and the anode's thin post (pad 1) stand up from the board", () => {
    for (const name of ["LED1", "LED2"]) {
      const { faces, placed, solid } = partOf(name)
      const one = placed.pads.find((pad) => pad.number === "1")!
      const two = placed.pads.find((pad) => pad.number === "2")!
      // The lens: the epoxy above the flange's top (the ring with the lens's hole in it).
      const ring = faces.find((face) => face.role === "body" && face.normal[2] > 0.99 && face.loops.length === 2)!
      const flangeTop = ring.loops[0]![0]![2]
      const lensFaces = faces.filter((face) => face.role === "body" && face !== ring && Math.min(...zs([face])) >= flangeTop - EPS)
      const lens = Math.max(...points(lensFaces).map((p) => Math.hypot(p[0] - placed.x, p[1] - placed.y)))
      const frames = faces.filter((face) => face.role === "pin" && face.material === "metal")
      for (const [x, y, z] of points(frames)) {
        expect(Math.hypot(x - placed.x, y - placed.y), name).toBeLessThan(lens + EPS)
        expect(z, name).toBeGreaterThanOrEqual(solid.bottom - EPS)
        expect(z, name).toBeLessThan(solid.top - 1)
      }
      // The two plates face the front (−y): the anvil's is the wider and sits towards pad 2, the post's towards pad 1.
      const plates = frames.filter((face) => face.normal[1] < -0.99 && spanX(face) > 0.3).sort((a, b) => spanX(b) - spanX(a))
      expect(plates.length, name).toBe(2)
      const [anvil, post] = plates as [Face, Face]
      expect(spanX(anvil), name).toBeGreaterThan(1.5 * spanX(post))
      expect(Math.abs(centre(anvil)[0] - two.x), name).toBeLessThan(Math.abs(centre(anvil)[0] - one.x))
      expect(Math.abs(centre(post)[0] - one.x), name).toBeLessThan(Math.abs(centre(post)[0] - two.x))
    }
  })

  test("the die sits in the reflector cup on the axis, a bond wire from its top to the post", () => {
    for (const name of ["LED1", "LED2"]) {
      const { faces, placed } = partOf(name)
      const one = placed.pads.find((pad) => pad.number === "1")!
      const die = faces.filter((face) => face.role === "cap")
      expect(die.length, name).toBeGreaterThan(0)
      const dieTop = faces.find((face) => face.role === "cap" && face.normal[2] > 0.99)!
      const [dx, dy] = centre(dieTop)
      expect(Math.hypot(dx - placed.x, dy - placed.y), name).toBeLessThan(0.05)
      const radial = (face: Face) => Math.max(...face.loops.flat().map((p) => Math.hypot(p[0] - placed.x, p[1] - placed.y)))
      const metal = FAMILY_LOOKS.ledlens.metal.join(",")
      // The cup: the round bowl's slanted sides about the axis (the plates' faces all face along x, y or z, or lie in x–z).
      const cup = faces.filter((face) => face.role === "pin" && face.color.join(",") === metal && radial(face) < 0.9 && Math.abs(face.normal[1]) > 0.05 && Math.abs(face.normal[1]) < 0.99)
      expect(cup.length, name).toBeGreaterThan(8)
      expect(Math.max(...zs(cup)), name).toBeGreaterThan(Math.max(...zs(die)))
      expect(Math.min(...zs(cup)), name).toBeLessThan(Math.min(...zs(die)))
      expect(Math.max(...die.map(radial)), name).toBeLessThan(Math.min(...cup.map(radial)))
      // The wire: thin pieces of another metal (gold), from the die's top towards the anode.
      const wire = faces.filter((face) => face.role === "pin" && face.color.join(",") !== metal)
      expect(wire.length, name).toBeGreaterThan(4)
      for (const face of wire) expect(spanOf(face, 1), name).toBeLessThan(0.1)
      const ends = points(wire)
      expect(Math.min(...ends.map((p) => p[2])), name).toBeCloseTo(Math.max(...zs([dieTop])), 1)
      const reach = Math.min(...ends.map((p) => Math.abs(p[0] - one.x)))
      expect(reach, name).toBeLessThan(Math.abs(placed.x - one.x) - 0.3)
    }
  })

  test("red by default, and coloured by the part's color prop; anything else red", () => {
    const hue = (name: string) => {
      const dome = partOf(name).faces.filter((face) => face.role === "body" && face.normal[2] > 0.3).sort((a, b) => Math.max(...zs([b])) - Math.max(...zs([a])))[0]!
      return dome.color
    }
    const red = hue("LED2")
    expect(red[0]).toBeGreaterThan(red[1] + 80)
    expect(hue("LED4")).toEqual(red)
    const green = hue("LED3")
    expect(green[1]).toBeGreaterThan(green[0] + 60)
  })
})

describe("a screw terminal block", () => {
  test("a green block in poles, a slotted head down a well over every pin, a wire entry with its clamp per pole on the front", () => {
    for (const [name, poles] of [["J1", 2], ["J2", 4], ["J3", 24]] as const) {
      const { faces, placed, solid } = partOf(name)
      expect(placed.pads.length).toBe(poles)
      const block = faces.filter((face) => face.role === "body" && !dark(face))
      const [r, g, b] = block[0]!.color
      expect(g, name).toBeGreaterThan(r + 30)
      expect(g, name).toBeGreaterThan(b + 20)
      const heads = faces.filter((face) => face.role === "cap" && face.normal[2] > 0.99 && !dark(face))
      expect(heads.length, name).toBe(poles)
      for (const pad of placed.pads) expect(heads.some((face) => Math.hypot(centre(face)[0] - pad.x, centre(face)[1] - pad.y) < 0.2), `${name} head ${pad.number}`).toBe(true)
      const slots = faces.filter((face) => face.role === "cap" && face.normal[2] > 0.99 && dark(face))
      expect(slots.length, name).toBe(poles)
      // Each head sits at the floor of a well cut into the block's top: the top of every pole has a round hole over its pin.
      const tops = faces.filter((face) => face.role === "body" && face.normal[2] > 0.99 && face.loops.length === 2)
      expect(tops.length, name).toBe(poles)
      const topZ = Math.max(...tops.flatMap((face) => face.loops[0]!.map((p) => p[2])))
      for (const head of heads) expect(topZ, name).toBeGreaterThan(head.loops[0]![0]![2] + 0.5)
      // A wire entry per pole: a square hole in the front (−y) face, at the pin, with the metal clamp behind it.
      const frontY = Math.min(...points(faces.filter((face) => face.role !== "lead")).map((p) => p[1]))
      const fronts = faces.filter((face) => face.role === "body" && face.normal[1] < -0.99 && face.loops.length === 2)
      expect(fronts.length, name).toBe(poles)
      for (const front of fronts) expect(centre(front)[1]).toBeLessThan(frontY + 0.1)
      const entries = fronts.map((face) => face.loops[1]!.reduce((s, p) => s + p[0], 0) / face.loops[1]!.length)
      for (const pad of placed.pads) expect(entries.some((x) => Math.abs(x - pad.x) < 0.2), `${name} entry ${pad.number}`).toBe(true)
      const clamps = faces.filter((face) => face.material === "metal" && face.role === "body" && face.normal[1] < -0.99)
      expect(clamps.length, name).toBe(poles)
      for (const clamp of clamps) expect(centre(clamp)[1]).toBeGreaterThan(frontY + 0.5)
      expect(Math.max(...zs(faces.filter((face) => face.role !== "lead")))).toBeCloseTo(solid.top, 6)
    }
  })
})

describe("a pin socket", () => {
  test("a black body as tall as the part, a dark square opening over every pin, a pin through each hole", () => {
    for (const name of ["P1", "P2"]) {
      const { faces, placed, solid } = partOf(name)
      expect(Math.max(...zs(faces.filter((face) => face.role !== "lead")))).toBeCloseTo(solid.top, 6)
      const body = faces.filter((face) => face.role === "body" && Math.max(...face.color) >= 20)
      expect(body.length).toBeGreaterThan(0)
      expect(Math.max(...body.flatMap((face) => face.color))).toBeLessThan(60)
      const floors = faces.filter((face) => face.role === "body" && face.normal[2] > 0.99 && Math.max(...face.color) < 20)
      expect(floors.length, name).toBe(placed.pads.length)
      for (const pad of placed.pads) expect(floors.some((face) => onPad(pad, ...centre(face), 0.5)), `${name} opening ${pad.number}`).toBe(true)
      for (const floor of floors) expect(floor.loops[0]![0]![2]).toBeLessThan(solid.top - 0.5)
    }
  })
})

describe("the TO-220 family", () => {
  test("a TO-220 is seated: 4.5 mm of lead under about 16 mm of body and tab", () => {
    const { faces, solid } = partOf("Q6")
    expect(solid.height).toBeCloseTo(20.5, 6)
    expect(Math.min(...zs(faces.filter((face) => face.role === "body")))).toBeCloseTo(solid.bottom + 4.5, 1)
  })

  test("two, three and five leads, one leg on every pad", () => {
    for (const [name, leads] of [["Q3", 2], ["Q6", 3], ["Q4", 5], ["Q1", 3]] as const) {
      const { faces, placed } = partOf(name)
      expect(placed.pads.length, name).toBe(leads)
      for (const pad of placed.pads) expect(faces.filter((face) => face.role === "leg" && onPad(pad, ...centre(face))).length, `${name} ${pad.number}`).toBeGreaterThan(0)
      const holed = faces.filter((face) => face.loops.length === 2 && face.material === "metal")
      expect(holed.length, name).toBe(2)
    }
  })

  test("a TO-247 is wider and taller, its tab and hole bigger", () => {
    const wide = partOf("Q1")
    const narrow = partOf("Q6")
    expect(wide.solid.height).toBeCloseTo(25.5, 6)
    const span = (faces: readonly Face[]) => Math.max(...points(faces).map((p) => p[0])) - Math.min(...points(faces).map((p) => p[0]))
    const tabOf = (faces: readonly Face[]) => faces.filter((face) => face.loops.length === 2 && face.material === "metal")
    expect(span(tabOf(wide.faces))).toBeGreaterThan(span(tabOf(narrow.faces)) + 3)
    const hole = (faces: readonly Face[]) => span([{ ...tabOf(faces)[0]!, loops: [tabOf(faces)[0]!.loops[1] as Vec3[]] }])
    expect(hole(wide.faces)).toBeGreaterThan(hole(narrow.faces) + 0.3)
  })

  test("a TO-126 is plastic to the top with a hole, and has no metal tab above the body", () => {
    const { faces, solid } = partOf("Q2")
    expect(faces.filter((face) => face.material === "metal" && face.role !== "lead" && face.role !== "leg")).toEqual([])
    const holed = faces.filter((face) => face.loops.length === 2)
    expect(holed.length).toBe(2)
    expect(Math.max(...zs(faces.filter((face) => face.role === "body")))).toBeCloseTo(solid.top, 6)
    expect(Math.max(...faces.filter((face) => face.role === "body" && face.normal[2] > 0.99).flatMap((face) => face.color))).toBeLessThan(90)
  })
})

describe("a TO-92", () => {
  test("a D-shaped body raised on three leads, one leg on every pad", () => {
    const { faces, placed, solid } = partOf("Q5")
    const body = faces.filter((face) => face.role === "body")
    expect(Math.min(...zs(body))).toBeGreaterThan(solid.bottom + 0.1)
    expect(body.filter((face) => face.normal[1] < -0.99).length).toBeGreaterThan(0)
    for (const pad of placed.pads) expect(faces.some((face) => face.role === "leg" && onPad(pad, ...centre(face))), pad.number).toBe(true)
  })
})

describe("thin and short axial bodies", () => {
  test("bands stay inside the body, fewer when it is short", () => {
    const { faces, placed } = partOf("A1")
    const body = faces.filter((face) => face.role === "body")
    for (const [x] of points(body)) expect(Math.abs(x - placed.x)).toBeLessThanOrEqual(0.5 + EPS)
    expect(new Set(body.map((face) => face.color.join(","))).size - 1).toBeLessThanOrEqual(3)
  })

  test("nothing, the wire included, rises above the part's height", () => {
    const { faces, solid } = partOf("A2")
    expect(Math.max(...zs(faces.filter((face) => face.role !== "lead")))).toBeLessThanOrEqual(solid.top + EPS)
  })
})

describe("a header at a finer pitch", () => {
  test("its pins and base fit the pitch", () => {
    for (const name of ["H1", "H2"]) {
      const { faces, placed } = partOf(name)
      const pins = faces.filter((face) => face.role === "pin" && face.normal[2] > 0.99)
      expect(pins.length, name).toBe(placed.pads.length)
      for (const pin of pins) {
        const loop = pin.loops[0] as Vec3[]
        expect(Math.max(...loop.map((p) => p[0])) - Math.min(...loop.map((p) => p[0])), name).toBeLessThan(0.6)
      }
    }
  })
})

describe("degenerate inputs", () => {
  test("a screw block whose pads share an x still gets heads with a size", () => {
    const pad = { number: "1", shape: "circle" as const, x: 0, y: 0, width: 1.7, height: 1.7, rotation: 0, layers: "through" as const, drill: { width: 1.2, height: 1.2 } }
    const input: ShapeInput = { pads: [pad, { ...pad, number: "2" }], height: 10, limit: { minX: -6, maxX: 6, minY: -6, maxY: 6 }, body: { minX: -5, maxX: 5, minY: -4, maxY: 4 }, look: FAMILY_LOOKS.screw, thickness: 1.6 }
    const heads = screwShape(input).filter((piece) => piece.role === "cap" && piece.normal[2] > 0.99 && piece.loops[0]!.length > 4)
    expect(heads.length).toBeGreaterThan(0)
    for (const head of heads) expect(Math.max(...head.loops[0]!.map((p) => p[0])) - Math.min(...head.loops[0]!.map((p) => p[0]))).toBeGreaterThan(1)
  })

  test("a TO-92 body deeper than twice its radius is a closed outline with no repeated point", () => {
    for (const rect of [{ minX: -2, maxX: 2, minY: -5, maxY: 2 }, { minX: -2.6, maxX: 2.6, minY: -1.6, maxY: 2.6 }]) {
      const outline = dShape(rect)
      outline.forEach((p, i) => {
        const q = outline[(i + 1) % outline.length]!
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(1e-9)
      })
      expect(Math.min(...outline.map((p) => p.y))).toBeCloseTo(rect.minY, 6)
    }
  })

  test("a part whose family draws nothing is a plain box rather than vanishing", () => {
    const base = buildDesign({ "main.circuit.tsx": `export default () => (<board width="20mm" height="20mm"><chip name="U1" footprint="pinrow2" pcbX={10} pcbY={10} /></board>)` }, "main.circuit.tsx")
    const part = base.pcb.parts[0]!
    const empty: Design = { ...base, pcb: { ...base.pcb, parts: [{ ...part, footprint: { ...part.footprint!, pads: [] } }] } }
    expect(partFaces(empty, solidModel(empty)).length).toBeGreaterThan(0)
  })
})
