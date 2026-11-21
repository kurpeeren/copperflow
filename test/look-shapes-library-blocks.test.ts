// The shapes of through-hole library parts drawn as blocks: a relay (K), a pluggable terminal header (J) and an axial
// diode with two holes (D), each from its footprint file's pads and body outline.
import { describe, expect, test } from "vitest"
import { generateComponent, PartSchema } from "../src/core/library.js"
import type { Pad } from "../src/engine/footprints/types.js"
import { FAMILY_LOOKS, familyOf } from "../studio/src/look/parts/family.js"
import { blockShape } from "../studio/src/look/parts/block.js"
import type { ShapeInput } from "../studio/src/look/parts/input.js"
import type { Rect } from "../studio/src/look/parts/kit.js"
import { plugFront, plugRow, plugShape } from "../studio/src/look/parts/plug.js"
import { relayShape } from "../studio/src/look/parts/relay.js"

const hole = (number: string, x: number, y: number, size = 2.2, drill = 1.3): Pad =>
  ({ number, x, y, width: size, height: size, rotation: 0, shape: "circle", layers: "through", drill: { width: drill, height: drill } }) as unknown as Pad

const input = (pads: Pad[], body: Rect, lookName: keyof typeof FAMILY_LOOKS, height: number, props?: Record<string, unknown>): ShapeInput => ({
  pads,
  height,
  limit: { minX: body.minX - 0.25, minY: body.minY - 0.25, maxX: body.maxX + 0.25, maxY: body.maxY + 0.25 },
  body,
  look: FAMILY_LOOKS[lookName],
  lookName,
  ...(props ? { props } : {}),
  thickness: 1.6,
})

const RELAY_PADS = [hole("1", -3.8, 12.7), hole("2", 3.8, 12.7), hole("3", -3.8, -7.62), hole("4", 3.8, -7.62), hole("5", -3.8, -2.54), hole("6", 3.8, -2.54), hole("7", -3.8, -12.7), hole("8", 3.8, -12.7)]
const RELAY_BODY: Rect = { minX: -6.3, maxX: 6.3, minY: -14.5, maxY: 14.5 }
const nineHoles = Array.from({ length: 9 }, (_, k) => hole(String(k + 1), (k - 4) * 7.62, 0, 3.2, 2.0))
const TERMINAL_BODY: Rect = { minX: -33.48, maxX: 33.48, minY: -3.5, maxY: 9.5 }

describe("a library part's 3D colour", () => {
  const part = { title: "Relay", footprint: "footprint.yaml", pins: { "1": { name: "COIL", type: "passive" as const } } }

  test("part.yaml takes a colour name or clear, and the part's component passes it on", () => {
    expect(PartSchema.safeParse({ ...part, color: "clear" }).success).toBe(true)
    expect(PartSchema.safeParse({ ...part, color: "purple" }).success).toBe(false)
    expect(generateComponent("K-RELAY", PartSchema.parse({ ...part, color: "clear" }))).toContain('color={"clear"}')
    expect(generateComponent("K-RELAY", PartSchema.parse(part))).not.toContain("color=")
  })
})

describe("which block look a library part gets", () => {
  test("by the letter of its name: K relay, J terminal, D diode, anything else a plain block", () => {
    expect(familyOf("chip", "parts/R/footprint.yaml", true, "K3")).toMatchObject({ family: "block", look: "relay" })
    expect(familyOf("chip", "parts/T/footprint.yaml", true, "J2")).toMatchObject({ family: "block", look: "terminal" })
    expect(familyOf("chip", "parts/D/footprint.yaml", true, "D4")).toMatchObject({ family: "block", look: "axialDiode" })
    expect(familyOf("chip", "parts/U/footprint.yaml", true, "U1")).toMatchObject({ family: "block", look: "block" })
  })
})

describe("relay", () => {
  const pieces = relayShape(input(RELAY_PADS, RELAY_BODY, "relay", 20.6, { manufacturerPartNumber: "HLS-14F2L-DC24V-C" }))
  // The print stands on the top and reaches the part's height.
  const zs = pieces.flatMap((piece) => piece.loops.flat().map((p) => p[2]))

  test("stands as tall as the part, on the board", () => {
    expect(Math.max(...zs)).toBeCloseTo(20.6, 6)
    expect(Math.min(...pieces.filter((piece) => piece.role === "body").flatMap((piece) => piece.loops.flat().map((p) => p[2])))).toBeCloseTo(0, 6)
  })

  test("its top is smaller than its plinth: the edges are chamfered", () => {
    const caseTop = Math.max(...pieces.filter((piece) => piece.role === "body" && piece.color[0] < 220).flatMap((piece) => piece.loops.flat().map((p) => p[2])))
    const top = pieces.filter((piece) => piece.role === "body" && piece.normal[2] > 0.99).flatMap((piece) => piece.loops.flat()).filter((p) => Math.abs(p[2] - caseTop) < 1e-6)
    expect(top.length).toBeGreaterThan(0)
    expect(Math.max(...top.map((p) => p[0]))).toBeLessThan(RELAY_BODY.maxX - 0.4)
  })

  test("prints its part number on the top, and puts a lead through every hole", () => {
    const ink = pieces.filter((piece) => piece.color[0] > 220 && piece.loops.flat().every((p) => p[2] >= 20.6 - 0.03 - 1e-6))
    expect(ink.length).toBeGreaterThan(20)
    expect(pieces.filter((piece) => piece.role === "lead").length).toBeGreaterThanOrEqual(RELAY_PADS.length)
  })

  test("a clear case is see-through and shows the coil and a blade over each contact column", () => {
    const clear = relayShape(input(RELAY_PADS, RELAY_BODY, "relay", 20.6, { manufacturerPartNumber: "HLS-14F2L-DC24V-C", color: "clear" }))
    const shell = clear.filter((piece) => (piece.alpha ?? 1) < 1)
    expect(shell.length).toBeGreaterThan(4)
    const opaque = clear.filter((piece) => (piece.alpha ?? 1) === 1 && piece.role === "body")
    // The copper winding lies at the coil end (+y, where pins 1 and 2 are).
    const copper = opaque.filter((piece) => piece.color[0] === 184 && piece.color[1] === 104).flatMap((piece) => piece.loops.flat())
    expect(copper.length).toBeGreaterThan(0)
    expect(copper.reduce((sum, p) => sum + p[1], 0) / copper.length).toBeGreaterThan(4)
    // The blades stand over the two contact columns, at the other end.
    const blades = opaque.filter((piece) => piece.color[0] === 150 && piece.normal[2] > 0.99).flatMap((piece) => piece.loops.flat())
    expect(new Set(blades.filter((p) => p[1] < 0).map((p) => Math.round(((p[0] > 0 ? 1 : -1) * 10)))).size).toBe(2)
    for (const p of clear.flatMap((piece) => piece.loops.flat())) expect(p[2]).toBeLessThanOrEqual(20.6 + 1e-6)
  })

  test("a colour name paints the case", () => {
    const red = relayShape(input(RELAY_PADS, RELAY_BODY, "relay", 20.6, { color: "red" }))
    expect(red.some((piece) => piece.color[0] === 184 && piece.color[1] === 40)).toBe(true)
  })

  test("without a part number nothing is printed", () => {
    const bare = relayShape(input(RELAY_PADS, RELAY_BODY, "relay", 20.6))
    expect(bare.length).toBeLessThan(pieces.length)
  })
})

describe("pluggable terminal header", () => {
  test("reads one row of holes at a terminal pitch, and its front from the outline", () => {
    const row = plugRow(input(nineHoles, TERMINAL_BODY, "terminal", 12))
    expect(row?.pitch).toBeCloseTo(7.62, 6)
    expect(plugFront(TERMINAL_BODY, 0)).toBe(1)
    expect(plugFront({ ...TERMINAL_BODY, minY: -9.5, maxY: 3.5 }, 0)).toBe(-1)
    expect(plugFront({ ...TERMINAL_BODY, minY: -5, maxY: 5 }, 0)).toBeUndefined()
  })

  test("a pin lies in every pole, pointing to the front, and a rib stands between every two poles", () => {
    const pieces = plugShape(input(nineHoles, TERMINAL_BODY, "terminal", 12)) ?? []
    const lying = pieces.filter((piece) => piece.role === "lead" && piece.normal[1] > 0.99 && piece.loops.flat().every((p) => p[2] > 1))
    expect(lying).toHaveLength(9)
    for (const tip of lying) expect(Math.max(...tip.loops.flat().map((p) => p[1]))).toBeLessThan(TERMINAL_BODY.maxY)
    const ribTops = pieces.filter((piece) => piece.role === "body" && piece.normal[2] > 0.99 && piece.loops.flat().every((p) => Math.abs(p[2] - (12 - 0.9)) < 1e-6))
    expect(ribTops.length).toBe(8 + 2)
  })

  test("pin rows and rows without a front are drawn as plain blocks", () => {
    const pinRow = Array.from({ length: 4 }, (_, k) => hole(String(k + 1), k * 2.54, 0, 1.7, 1.0))
    expect(plugShape(input(pinRow, { minX: -1.3, maxX: 8.9, minY: -1.3, maxY: 1.3 }, "terminal", 8.5))).toBeUndefined()
    const centred = blockShape(input(nineHoles, { ...TERMINAL_BODY, minY: -5, maxY: 5 }, "terminal", 12))
    // One box: four sides and the top.
    expect(centred.filter((piece) => piece.role === "body")).toHaveLength(5)
  })
})

describe("diode with two holes", () => {
  test("lies as an axial diode with its band at the cathode (pad 2) end", () => {
    const pads = [hole("1", -7.62, 0, 2.8, 1.5), hole("2", 7.62, 0, 2.8, 1.5)]
    const pieces = blockShape(input(pads, { minX: -4.55, maxX: 4.55, minY: -4.55, maxY: 4.55 }, "axialDiode", 9.1))
    const band = pieces.filter((piece) => piece.role === "cathode").flatMap((piece) => piece.loops.flat().map((p) => p[0]))
    expect(band.length).toBeGreaterThan(0)
    expect(Math.min(...band)).toBeGreaterThan(0)
  })

  test("with more holes it stays a block", () => {
    const pads = [hole("1", -5, 0), hole("2", 0, 0), hole("3", 5, 0)]
    const pieces = blockShape(input(pads, { minX: -6, maxX: 6, minY: -3, maxY: 3 }, "axialDiode", 5))
    expect(pieces.some((piece) => piece.role === "cathode")).toBe(false)
  })
})
