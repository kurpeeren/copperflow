import { describe, expect, test } from "vitest"
import { writeGerber, type GerberLayer } from "../../src/engine/fab/gerber.js"
import { VERSION } from "../../src/version.js"
import { readGerber } from "../helpers/gerber-read.js"

const CREATED = new Date(Date.UTC(2026, 10, 10, 9, 5, 7))

const layer = (objects: GerberLayer["objects"], polarity: GerberLayer["polarity"] = "Positive"): GerberLayer => ({ fileFunction: "Copper,L1,Top", polarity, objects })

describe("the Gerber writer", () => {
  test("writes the X2 header, millimetres in 4.6 format, and ends with M02 and LF line ends", () => {
    const text = writeGerber(layer([]), CREATED)
    const read = readGerber(text)
    expect(read.fileAttributes).toEqual([
      `.GenerationSoftware,copperflow,copperflow,${VERSION}`,
      ".CreationDate,2026-11-10T09:05:07+00:00",
      ".Part,Single",
      ".FileFunction,Copper,L1,Top",
      ".FilePolarity,Positive",
    ])
    expect(text).toContain("%FSLAX46Y46*%\n%MOMM*%\n")
    expect(read.format).toEqual([4, 6])
    expect(read.units).toBe("mm")
    expect(text).not.toContain("\r")
    expect(text.endsWith("M02*\n")).toBe(true)
  })

  test("flashes a pad with its aperture at its position, negative coordinates included", () => {
    const read = readGerber(writeGerber(layer([{ kind: "flash", at: { x: -1.25, y: 3.5 }, aperture: { shape: "circle", diameter: 1.6 }, function: "ComponentPad" }]), CREATED))
    expect(read.flashes).toHaveLength(1)
    expect(read.flashes[0]?.at).toEqual({ x: -1.25, y: 3.5 })
    expect(read.flashes[0]?.aperture.shape).toEqual({ type: "circle", diameter: 1.6 })
    expect(read.flashes[0]?.aperture.fn).toBe("ComponentPad")
  })

  test("defines each aperture once, rectangles and obrounds as standard apertures", () => {
    const rect = { shape: "rect", width: 1, height: 2 } as const
    const read = readGerber(
      writeGerber(
        layer([
          { kind: "flash", at: { x: 0, y: 0 }, aperture: rect },
          { kind: "flash", at: { x: 2, y: 0 }, aperture: rect },
          { kind: "flash", at: { x: 4, y: 0 }, aperture: { shape: "obround", width: 0.6, height: 1.2 } },
        ]),
        CREATED,
      ),
    )
    expect([...read.apertures.values()].map((a) => a.shape)).toEqual([
      { type: "rectangle", xSize: 1, ySize: 2 },
      { type: "obround", xSize: 0.6, ySize: 1.2 },
    ])
    expect(read.flashes.map((f) => f.aperture.code)).toEqual(["10", "10", "11"])
  })

  test("a rounded rectangle is a RoundRect macro aperture with radius, width, height and rotation", () => {
    const text = writeGerber(layer([{ kind: "flash", at: { x: 1, y: 1 }, aperture: { shape: "roundrect", width: 1.2, height: 0.8, radius: 0.2, rotation: 30 }, function: "SMDPad,CuDef" }]), CREATED)
    const read = readGerber(text)
    expect(read.macros).toEqual(["RoundRect"])
    expect(read.flashes[0]?.aperture.shape).toEqual({ type: "macroShape", name: "RoundRect", variableValues: [0.2, 1.2, 0.8, 30] })
    expect(read.flashes[0]?.aperture.fn).toBe("SMDPad,CuDef")
    expect(writeGerber(layer([]), CREATED)).not.toContain("%AMRoundRect")
  })

  test("draws a track with a 45 degree corner as one stroke with a round aperture of its width", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 1 },
    ]
    const read = readGerber(writeGerber(layer([{ kind: "draw", points, width: 0.25, function: "Conductor" }]), CREATED))
    expect(read.strokes).toHaveLength(1)
    expect(read.strokes[0]?.points).toEqual(points)
    expect(read.strokes[0]?.aperture.shape).toEqual({ type: "circle", diameter: 0.25 })
    expect(read.strokes[0]?.aperture.fn).toBe("Conductor")
  })

  test("writes a region as a closed contour between G36 and G37", () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]
    const text = writeGerber(layer([{ kind: "region", points: corners, function: "SMDPad,CuDef" }]), CREATED)
    const read = readGerber(text)
    expect(read.regions).toEqual([{ points: [...corners, corners[0]], fn: "SMDPad,CuDef" }])
    expect(text).toMatch(/G36\*\n[\s\S]*G37\*\n/)
  })

  test("rounds coordinates to the nanometre and writes the same bytes for the same input", () => {
    const objects: GerberLayer["objects"] = [{ kind: "flash", at: { x: 0.1 + 0.2, y: -0.0000001 }, aperture: { shape: "circle", diameter: 0.6 } }]
    const text = writeGerber(layer(objects), CREATED)
    expect(text).toContain("X300000Y0D03*")
    expect(writeGerber(layer(objects), CREATED)).toBe(text)
  })

  test("a mask file is written with negative polarity", () => {
    expect(readGerber(writeGerber(layer([], "Negative"), CREATED)).fileAttributes).toContain(".FilePolarity,Negative")
  })
})
