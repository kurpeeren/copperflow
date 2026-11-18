import { describe, expect, it } from "vitest"
import { parseGraphic, signedArea, type GraphicShapes } from "../../src/engine/graphics/index.js"

/** A DXF from its entities' group-code pairs, with $INSUNITS when given and an optional BLOCKS section. */
function dxf(entities: string[], units?: number, blocks: string[] = []): string {
  const header = units === undefined ? [] : ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", String(units), "0", "ENDSEC"]
  const blockSection = blocks.length ? ["0", "SECTION", "2", "BLOCKS", ...blocks, "0", "ENDSEC"] : []
  return [...header, ...blockSection, "0", "SECTION", "2", "ENTITIES", ...entities, "0", "ENDSEC", "0", "EOF", ""].join("\n")
}

function read(text: string): GraphicShapes {
  const result = parseGraphic(text, "dxf")
  if ("error" in result) throw new Error(result.error)
  return result
}

const line = (x1: number, y1: number, x2: number, y2: number) => ["0", "LINE", "8", "0", "10", `${x1}`, "20", `${y1}`, "11", `${x2}`, "21", `${y2}`]
const circle = (x: number, y: number, r: number) => ["0", "CIRCLE", "8", "LOGO", "10", `${x}`, "20", `${y}`, "40", `${r}`]

/** A letter L as a closed polyline and a ring of two circles, on two layers. */
const LOGO = dxf(
  [
    ...["0", "LWPOLYLINE", "8", "LETTER", "90", "6", "70", "1"],
    ...["10", "1", "20", "1", "10", "7", "20", "1", "10", "7", "20", "3", "10", "3", "20", "3", "10", "3", "20", "9", "10", "1", "20", "9"],
    ...circle(24, 5, 4),
    ...circle(24, 5, 2),
  ],
  4,
)

describe("DXF entities", () => {
  it("reads lines as open strokes and circles as closed strokes", () => {
    const r = read(dxf([...line(0, 0, 10, 0), ...circle(20, 0, 5)], 4))
    expect(r.strokes).toHaveLength(2)
    expect(r.strokes[0]!.closed).toBe(false)
    expect(r.strokes[1]!.closed).toBe(true)
    expect(r.strokes.every((s) => s.width === 0)).toBe(true)
    expect(r.width).toBeCloseTo(25)
    expect(r.height).toBeCloseTo(10)
  })
  it("draws a bulge as a half circle through its known middle", () => {
    // From (0,0) to (10,0) with bulge 1: a half circle counter-clockwise, so below the chord, 5 deep.
    const poly = ["0", "LWPOLYLINE", "8", "0", "90", "2", "70", "0", "10", "0", "20", "0", "42", "1", "10", "10", "20", "0"]
    const r = read(dxf(poly, 4))
    expect(r.width).toBeCloseTo(10)
    expect(r.height).toBeCloseTo(5, 2)
    expect(r.strokes[0]!.points.some((p) => Math.abs(p.x - 5) < 1e-6 && Math.abs(p.y) < 1e-6)).toBe(true)
  })
  it("reads an ARC counter-clockwise from its start angle to its end angle", () => {
    const r = read(dxf(["0", "ARC", "8", "0", "10", "0", "20", "0", "40", "10", "50", "0", "51", "90"], 4))
    expect(r.width).toBeCloseTo(10)
    expect(r.height).toBeCloseTo(10)
  })
  it("reads a POLYLINE with its vertices and a closed flag", () => {
    const poly = ["0", "POLYLINE", "8", "0", "66", "1", "70", "1", "0", "VERTEX", "8", "0", "10", "0", "20", "0", "0", "VERTEX", "8", "0", "10", "4", "20", "0", "0", "VERTEX", "8", "0", "10", "4", "20", "3", "0", "SEQEND"]
    const r = read(dxf(poly, 4))
    expect(r.strokes[0]!.closed).toBe(true)
    expect(r.strokes[0]!.points).toHaveLength(3)
  })
  it("reads an ELLIPSE by its major axis and ratio", () => {
    const r = read(dxf(["0", "ELLIPSE", "8", "0", "10", "0", "20", "0", "11", "10", "21", "0", "40", "0.5", "41", "0", "42", `${2 * Math.PI}`], 4))
    expect(r.width).toBeCloseTo(20, 1)
    expect(r.height).toBeCloseTo(10, 1)
    expect(r.strokes[0]!.closed).toBe(true)
  })
  it("reads a SPLINE through its end points", () => {
    const spline = ["0", "SPLINE", "8", "0", "70", "8", "71", "3", "72", "8", "73", "4"]
    const knots = [0, 0, 0, 0, 1, 1, 1, 1].flatMap((k) => ["40", `${k}`])
    const control = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
    ].flatMap(([x, y]) => ["10", `${x}`, "20", `${y}`])
    const r = read(dxf([...spline, ...knots, ...control], 4))
    const pts = r.strokes[0]!.points
    expect(pts[0]!.x).toBeCloseTo(0)
    expect(pts.at(-1)!.x).toBeCloseTo(10)
    expect(r.height).toBeCloseTo(7.5, 2)
  })
  it("reads SOLID and a polyline HATCH boundary as fills", () => {
    const solid = ["0", "SOLID", "8", "0", "10", "0", "20", "0", "11", "4", "21", "0", "12", "0", "22", "4", "13", "4", "23", "4"]
    const hatch = ["0", "HATCH", "8", "0", "91", "1", "92", "2", "72", "0", "73", "1", "93", "3", "10", "10", "20", "0", "10", "14", "20", "0", "10", "12", "20", "3"]
    const r = read(dxf([...solid, ...hatch], 4))
    expect(r.fills).toHaveLength(2)
    expect(Math.abs(signedArea(r.fills[0]!.outer))).toBeCloseTo(16)
    for (const f of r.fills) expect(signedArea(f.outer)).toBeGreaterThan(0)
  })
  it("draws an INSERT of a block with its scale, rotation and position", () => {
    const block = ["0", "BLOCK", "8", "0", "2", "MARK", "70", "0", "10", "0", "20", "0", ...line(0, 0, 2, 0), "0", "ENDBLK"]
    const insert = ["0", "INSERT", "8", "0", "2", "MARK", "10", "10", "20", "10", "41", "3", "42", "3", "50", "90"]
    const r = read(dxf([...insert, ...line(0, 0, 1, 0)], 4, block))
    expect(r.strokes).toHaveLength(2)
    expect(r.height).toBeCloseTo(16)
  })
  it("counts what it leaves out, and the layers", () => {
    const r = read(dxf([...line(0, 0, 1, 0), "0", "TEXT", "8", "A", "10", "0", "20", "0", "1", "hi", "0", "MTEXT", "8", "B", "10", "0", "20", "0"], 4))
    const notes = r.skipped.join(";")
    expect(notes).toMatch(/TEXT/)
    expect(notes).toMatch(/layer/)
  })
})

describe("DXF units", () => {
  it("scales inches to mm", () => {
    expect(read(dxf(line(0, 0, 1, 0), 1)).width).toBeCloseTo(25.4)
  })
  it("scales cm to mm", () => {
    expect(read(dxf(line(0, 0, 1, 0), 5)).width).toBeCloseTo(10)
  })
  it("takes a unitless drawing as mm and says so", () => {
    const r = read(dxf(line(0, 0, 3, 0)))
    expect(r.width).toBeCloseTo(3)
    expect(r.skipped.join(";")).toMatch(/mm/)
  })
  it("refuses units it does not read", () => {
    expect(parseGraphic(dxf(line(0, 0, 1, 0), 2), "dxf")).toHaveProperty("error")
  })
})

describe("the DXF logo fixture", () => {
  it("reads the letter and the ring as closed strokes", () => {
    const r = read(LOGO)
    expect(r.strokes).toHaveLength(3)
    expect(r.strokes.every((s) => s.closed)).toBe(true)
    expect(r.width).toBeCloseTo(27)
    expect(r.height).toBeCloseTo(8)
    const points = r.strokes.flatMap((s) => s.points)
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(0)
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(0)
  })
})

describe("DXF refusals", () => {
  it.each([
    ["empty", ""],
    ["not a dxf", "hello\nworld\n"],
    ["binary", "AutoCAD Binary DXF\r\n\u001a\u0000"],
    ["truncated", dxf(line(0, 0, 1, 0), 4).slice(0, 60)],
    ["bad number", dxf(["0", "LINE", "8", "0", "10", "x", "20", "0", "11", "1", "21", "1"], 4)],
    ["absurd number", dxf(line(0, 0, 1e400, 0), 4)],
    ["huge radius", dxf(circle(0, 0, 1e300), 4)],
  ])("refuses %s input", (_, text) => {
    expect(parseGraphic(text, "dxf")).toHaveProperty("error")
  })
  it("refuses text over 2 MB", () => {
    expect((parseGraphic("0\n".repeat(1_100_000), "dxf") as { error: string }).error).toMatch(/MB/)
  })
  it("does not follow an INSERT inside a block", () => {
    const inner = ["0", "BLOCK", "8", "0", "2", "A", "10", "0", "20", "0", "0", "INSERT", "8", "0", "2", "A", "10", "0", "20", "0", ...line(0, 0, 1, 0), "0", "ENDBLK"]
    const r = read(dxf(["0", "INSERT", "8", "0", "2", "A", "10", "0", "20", "0"], 4, inner))
    expect(r.strokes).toHaveLength(1)
    expect(r.skipped.join(";")).toMatch(/one level/)
  })
})

describe("DXF robustness", () => {
  it("never throws on any truncation of the logo", () => {
    for (let n = 0; n <= LOGO.length; n += 3) expect(() => parseGraphic(LOGO.slice(0, n), "dxf")).not.toThrow()
  })
})
