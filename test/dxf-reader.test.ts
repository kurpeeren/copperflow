import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { readDxf } from "../src/engine/dxf/index.js"

const fixture = (name: string) => readFileSync(new URL(`./fixtures/dxf/${name}`, import.meta.url), "utf8")

describe("the DXF reader", () => {
  test("reads the header's units, and none given as none", () => {
    expect(readDxf(fixture("rectangle-holes.dxf")).units).toBe("mm")
    expect(readDxf(fixture("rounded-inch.dxf")).units).toBe("inch")
    expect(readDxf(fixture("inner-shape.dxf")).units).toBeUndefined()
  })

  test("reads the lines, arcs, circles and polylines with their layers", () => {
    const rectangle = readDxf(fixture("rectangle-holes.dxf"))
    expect(rectangle.entities.map((e) => e.type)).toEqual(["LWPOLYLINE", "CIRCLE", "CIRCLE", "CIRCLE", "CIRCLE"])
    expect(rectangle.entities[0]).toMatchObject({ layer: "Outline", closed: true, vertices: [{ x: 0, y: 0 }, { x: 82, y: 0 }, { x: 82, y: 54 }, { x: 0, y: 54 }] })
    expect(rectangle.entities[1]).toMatchObject({ type: "CIRCLE", layer: "Holes", centre: { x: 4, y: 4 }, radius: 1.6 })
    const rounded = readDxf(fixture("rounded.dxf"))
    expect(rounded.entities.filter((e) => e.type === "LINE")).toHaveLength(4)
    expect(rounded.entities[1]).toMatchObject({ type: "ARC", centre: { x: 55, y: 5 }, radius: 5, startAngle: 270, endAngle: 360 })
  })

  test("reads a POLYLINE's VERTEX list and the bulges of a LWPOLYLINE", () => {
    const inner = readDxf(fixture("inner-shape.dxf"))
    expect(inner.entities[0]).toMatchObject({ type: "POLYLINE", layer: "Board", closed: true })
    expect(inner.entities[0]?.type === "POLYLINE" && inner.entities[0].vertices).toHaveLength(4)
    const bulges = readDxf(fixture("bulges.dxf")).entities[0]
    expect(bulges?.type === "LWPOLYLINE" && bulges.vertices.map((v) => v.bulge)).toEqual([0, 1, 0, 1])
  })

  test("counts what it does not read by type", () => {
    const drawing = readDxf(fixture("spline-open.dxf"))
    expect(drawing.skipped).toEqual({ SPLINE: 2 })
    expect(drawing.entities).toHaveLength(4)
  })

  test("refuses a binary DXF and a file without entities", () => {
    expect(() => readDxf("AutoCAD Binary DXF\r\n\x1a\x00rest")).toThrow(/binary DXF/)
    expect(() => readDxf("0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n")).toThrow(/no ENTITIES section/)
    expect(() => readDxf("hello")).toThrow(/not an ASCII DXF/)
  })
})
