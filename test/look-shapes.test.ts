import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../src/engine/design.js"
import { solidModel } from "../src/engine/solid/model.js"
import { FAMILY_LOOKS, familyOf } from "../studio/src/look/parts/family.js"
import { partFaces } from "../studio/src/look/parts/index.js"
import type { Face, Vec3 } from "../studio/src/look/scene.js"

function filesIn(folder: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else files[relative(folder, path).split("\\").join("/")] = readFileSync(path, "utf8")
    }
  }
  walk(folder)
  return files
}

const example = (name: string): Design => {
  const folder = join(import.meta.dirname, "..", "examples", name)
  const main = readdirSync(folder).find((file) => file.endsWith(".circuit.tsx")) as string
  return buildDesign(filesIn(folder), main)
}
const designs = { "io-8": example("io-8"), "can-node": example("can-node"), "relay-driver": example("relay-driver") }

const EPS = 1e-6
const points = (faces: readonly Face[]): Vec3[] => faces.flatMap((face) => face.loops.flat())

/** The faces of one part, by designator, with the part's placed footprint and solid. */
function partOf(design: Design, name: string) {
  const model = solidModel(design)
  const index = model.parts.findIndex((part) => part.name === name)
  const faces = partFaces(design, model).filter((face) => face.part === index)
  return { faces, solid: model.parts[index]!, placed: design.pcb.parts[index]! }
}

/** Is the point inside the pad's rectangle on the board (pads are placed in board coordinates)? */
function onPad(pad: { x: number; y: number; width: number; height: number; rotation: number }, x: number, y: number, slack = 0.02): boolean {
  const radians = (-pad.rotation * Math.PI) / 180
  const [dx, dy] = [x - pad.x, y - pad.y]
  const [u, v] = [dx * Math.cos(radians) - dy * Math.sin(radians), dx * Math.sin(radians) + dy * Math.cos(radians)]
  return Math.abs(u) <= pad.width / 2 + slack && Math.abs(v) <= pad.height / 2 + slack
}

const centre = (face: Face): [number, number] => {
  const all = face.loops[0] as Vec3[]
  return [all.reduce((s, p) => s + p[0], 0) / all.length, all.reduce((s, p) => s + p[1], 0) / all.length]
}

describe("every part's shape stays inside its courtyard and its height", () => {
  for (const [label, design] of Object.entries(designs)) {
    test(label, () => {
      const model = solidModel(design)
      const thickness = model.board?.thickness ?? 1.6
      const faces = partFaces(design, model)
      model.parts.forEach((solid, index) => {
        const placed = design.pcb.parts[index]!
        const own = faces.filter((face) => face.part === index)
        expect(own.length, solid.name).toBeGreaterThan(0)
        const xs = placed.courtyard.map((p) => p.x)
        const ys = placed.courtyard.map((p) => p.y)
        for (const [x, y, z] of points(own.filter((face) => face.role !== "lead"))) {
          expect(x, solid.name).toBeGreaterThanOrEqual(Math.min(...xs) - EPS)
          expect(x, solid.name).toBeLessThanOrEqual(Math.max(...xs) + EPS)
          expect(y, solid.name).toBeGreaterThanOrEqual(Math.min(...ys) - EPS)
          expect(y, solid.name).toBeLessThanOrEqual(Math.max(...ys) + EPS)
          expect(z, solid.name).toBeGreaterThanOrEqual(solid.bottom - EPS)
          expect(z, solid.name).toBeLessThanOrEqual(solid.top + EPS)
        }
        // A lead below the board stays inside its own hole's pad.
        for (const face of own.filter((one) => one.role === "lead")) {
          const [x, y] = centre(face)
          expect(placed.pads.some((pad) => pad.layers === "through" && onPad(pad, x, y)), solid.name).toBe(true)
          for (const [, , z] of face.loops.flat()) expect(z).toBeGreaterThanOrEqual(-thickness - 2.5 - EPS)
        }
      })
    })
  }
})

describe("each family's shape", () => {
  test("parts fall into the families their kind and package name", () => {
    const through = (design: Design, id: string) => design.pcb.parts.find((part) => part.component === id)?.pads.some((pad) => pad.layers === "through") ?? false
    const families = (design: Design) => Object.fromEntries(design.circuit.components.map((c) => [c.id, familyOf(c.kind, c.footprint, through(design, c.id), c.id).family]))
    expect(families(designs["io-8"])).toMatchObject({ R101: "chip", C101: "chip", D101: "molded", J1: "header" })
    expect(families(designs["can-node"])).toMatchObject({ U101: "gullwing", U102: "gullwing", Y101: "crystal", J1: "header" })
    expect(families(designs["relay-driver"])).toMatchObject({ K101: "block", Q101: "gullwing", LED101: "chip", J3: "block" })
    expect(familyOf("chip", "qfn32_5x5_p0.5").family).toBe("leadless")
    expect(familyOf("capacitor", "radial6.3x2.5").family).toBe("electrolytic")
    expect(familyOf("chip", "to220", true, "U9").family).toBe("block")
    expect(familyOf("chip", "parts/K/footprint.yaml", true, "K1").look).toBe("relay")
    expect(familyOf("chip", undefined).family).toBe("box")
    for (const look of Object.values(FAMILY_LOOKS)) expect(look.sentence.length).toBeGreaterThan(10)
  })

  test("a chip resistor: two metal end caps, each over its pad, the body between them", () => {
    const { faces, placed } = partOf(designs["io-8"], "R101")
    const caps = faces.filter((face) => face.role === "cap")
    expect(caps.length).toBeGreaterThan(0)
    for (const pad of placed.pads) expect(caps.some((face) => onPad(pad, ...centre(face))), pad.number).toBe(true)
    expect(caps.every((face) => face.material === "metal")).toBe(true)
    const body = faces.filter((face) => face.role === "body")
    const [bx, by] = centre(body.find((face) => face.normal[2] === 1)!)
    expect(Math.hypot(bx - placed.x, by - placed.y)).toBeLessThan(0.05)
  })

  test("a gull-wing chip: a leg's foot on every pad, and the pin 1 dot nearest pad 1", () => {
    for (const [label, name] of [["can-node", "U102"], ["can-node", "U101"], ["relay-driver", "Q101"]] as const) {
      const { faces, placed, solid } = partOf(designs[label], name)
      const feet = faces.filter((face) => face.role === "leg" && face.loops[0]!.every((p) => p[2] <= solid.bottom + 0.2))
      for (const pad of placed.pads) expect(feet.some((face) => onPad(pad, ...centre(face))), `${name} pad ${pad.number}`).toBe(true)
      const dot = faces.find((face) => face.role === "pin1")
      expect(dot, name).toBeDefined()
      const [dx, dy] = centre(dot!)
      const nearest = [...placed.pads].sort((a, b) => Math.hypot(a.x - dx, a.y - dy) - Math.hypot(b.x - dx, b.y - dy))[0]
      expect(nearest?.number, name).toBe("1")
    }
  })

  test("a moulded diode: a dark body with its cathode mark at pad 2", () => {
    const { faces, placed } = partOf(designs["io-8"], "D101")
    const mark = faces.find((face) => face.role === "cathode")!
    const [mx, my] = centre(mark)
    const [one, two] = [placed.pads.find((p) => p.number === "1")!, placed.pads.find((p) => p.number === "2")!]
    expect(Math.hypot(two.x - mx, two.y - my)).toBeLessThan(Math.hypot(one.x - mx, one.y - my))
    const body = faces.find((face) => face.role === "body" && face.normal[2] === 1)!
    expect(Math.max(...body.color)).toBeLessThan(90)
  })

  test("a pin header: a black base and a gold pin standing on every pad", () => {
    const { faces, placed, solid } = partOf(designs["can-node"], "J1")
    const pins = faces.filter((face) => face.role === "pin" && face.normal[2] === 1)
    for (const pad of placed.pads) expect(pins.some((face) => onPad(pad, ...centre(face))), pad.number).toBe(true)
    expect(Math.max(...pins.flatMap((face) => face.loops.flat().map((p) => p[2])))).toBeCloseTo(solid.top, 6)
  })

  test("a relay: a block as tall as its datasheet says, with leads through its holes", () => {
    const { faces, solid } = partOf(designs["relay-driver"], "K101")
    expect(solid.height).toBe(15.3)
    expect(solid.state).toBe("given")
    expect(faces.filter((face) => face.role === "lead").length).toBeGreaterThan(0)
  })
})
