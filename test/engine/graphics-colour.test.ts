import { describe, expect, it } from "vitest"
import { readColour, LIGHT_THRESHOLD } from "../../src/engine/graphics/colour.js"
import { parseGraphic, signedArea, type GraphicShapes } from "../../src/engine/graphics/index.js"
import { placeGraphic } from "../../src/engine/graphic-place.js"

const ROOT = 'width="20mm" height="20mm" viewBox="0 0 20 20"'

function read(body: string, root = ROOT): GraphicShapes {
  const result = parseGraphic(`<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`, "svg")
  if ("error" in result) throw new Error(result.error)
  return result
}

const area = (shapes: GraphicShapes) => shapes.fills.reduce((sum, f) => sum + signedArea(f.outer) + f.holes.reduce((s, h) => s + signedArea(h), 0), 0)

const DISC = '<circle cx="10" cy="10" r="8" fill="black"/>'
const SQUARE = (fill: string) => `<rect x="7" y="7" width="6" height="6" ${fill}/>`

describe("light shapes cut out of dark ones, in the file's order", () => {
  it("a black disc with a white square on top is one area with one square hole", () => {
    const r = read(DISC + SQUARE('fill="white"'))
    expect(r.fills).toHaveLength(1)
    expect(r.fills[0]?.holes).toHaveLength(1)
    expect(signedArea(r.fills[0]?.holes[0] ?? [])).toBeCloseTo(-36, 1)
    expect(signedArea(r.fills[0]?.outer ?? [])).toBeGreaterThan(0)
    expect(r.skipped).toEqual([])
  })

  it("white first, then black, is a solid disc", () => {
    const r = read(SQUARE('fill="white"') + DISC)
    expect(r.fills).toHaveLength(1)
    expect(r.fills[0]?.holes).toHaveLength(0)
    expect(area(r)).toBeGreaterThan(Math.PI * 64 * 0.99)
  })

  it("with no dark shape at all, the light shapes are the ink, and the notes say so", () => {
    const r = read(SQUARE('fill="#fff"') + '<circle cx="3" cy="3" r="2" fill="yellow"/>')
    expect(r.fills).toHaveLength(2)
    expect(r.skipped).toEqual(["no dark shape, so the light shapes are drawn as ink"])
  })

  it("counts light shapes that cut nothing", () => {
    const r = read('<circle cx="5" cy="5" r="4" fill="black"/><rect x="15" y="15" width="3" height="3" fill="white"/>')
    expect(r.fills).toHaveLength(1)
    expect(r.skipped).toEqual(["1 light shape over no ink, left out"])
  })

  it("a stroke no light shape touches stays a line, even when the boxes meet", () => {
    const r = read('<rect x="1" y="1" width="18" height="18" fill="none" stroke="black" stroke-width="1"/><circle cx="10" cy="10" r="2" fill="white"/>')
    expect(r.fills).toEqual([])
    expect(r.strokes).toHaveLength(1)
    expect(r.strokes[0]?.closed).toBe(true)
  })

  it("a stroke a light shape cuts becomes its area with round ends", () => {
    const r = read('<line x1="2" y1="10" x2="18" y2="10" stroke="black" stroke-width="2"/><rect x="9" y="0" width="2" height="20" fill="white"/>')
    expect(r.fills).toHaveLength(2)
    expect(r.strokes).toEqual([])
    expect(r.width).toBeCloseTo(18, 1)
  })

  it("cuts a small drawing finely: precision follows the drawing's size", () => {
    const r = read('<rect width="1" height="1" fill="black"/><rect x="0.25" y="0.25" width="0.5005" height="0.5" fill="white"/>', 'width="1mm" height="1mm" viewBox="0 0 1 1"')
    const hole = r.fills[0]?.holes[0] ?? []
    const xs = hole.map((p) => p.x)
    expect(Math.max(...xs)).toBeCloseTo(0.7505, 5)
  })

  it("an opacity of 0 on a group reaches a child with its own fill", () => {
    expect(read('<g fill-opacity="0"><rect width="3" height="3" fill="black"/></g>').fills).toEqual([])
    expect(read('<g stroke-opacity="0"><line x1="0" y1="0" x2="3" y2="3" stroke="black"/></g>').strokes).toEqual([])
    expect(read('<g fill-opacity="0"><rect width="3" height="3" fill="black" fill-opacity="1"/></g>').fills).toHaveLength(1)
  })

  it("a white stroke across a black bar splits it in two", () => {
    const r = read('<rect x="0" y="8" width="20" height="4" fill="#000"/><line x1="10" y1="0" x2="10" y2="20" stroke="#fff" stroke-width="2"/>')
    expect(r.fills).toHaveLength(2)
    expect(area(r)).toBeCloseTo(80 - 8, 1)
    expect(r.strokes).toEqual([])
  })

  it("a white square over a black stroke cuts the stroke's outline; an ink stroke elsewhere stays a line", () => {
    const r = read('<line x1="0" y1="10" x2="20" y2="10" stroke="black" stroke-width="2"/><line x1="0" y1="1" x2="4" y2="1" stroke="black"/><rect x="8" y="5" width="4" height="10" fill="white"/>')
    expect(r.fills).toHaveLength(2)
    expect(area(r)).toBeCloseTo(40 - 8 + Math.PI, 1)
    expect(r.strokes).toHaveLength(1)
  })

  it.each([
    ['fill="#fff"', 1],
    ['fill="#FFFFFF"', 1],
    ['fill="rgb(255,255,255)"', 1],
    ['fill="rgb(100%, 100%, 100%)"', 1],
    ['style="fill:white"', 1],
    ['fill="currentColor"', 0],
    ['fill="rgb(0 0 0)"', 0],
    ['fill="#000"', 0],
  ])("reads %s as %s hole", (fill, holes) => {
    const r = read(DISC + SQUARE(fill))
    expect(r.fills[0]?.holes).toHaveLength(holes)
  })

  it("takes the fill from a group", () => {
    const r = read(`${DISC}<g fill="white"><rect x="7" y="7" width="6" height="6"/></g>`)
    expect(r.fills[0]?.holes).toHaveLength(1)
  })

  it("splits grey at the threshold: just darker is ink, just lighter is clear", () => {
    expect(LIGHT_THRESHOLD).toBe(0.5)
    expect(readColour("#7f7f7f")).toEqual({ tone: "ink" })
    expect(readColour("#808080")).toEqual({ tone: "clear" })
    expect(read(DISC + SQUARE('fill="#7f7f7f"')).fills[0]?.holes).toHaveLength(0)
    expect(read(DISC + SQUARE('fill="#808080"')).fills[0]?.holes).toHaveLength(1)
  })

  it("an opacity of 0 draws nothing; a colour it cannot read is ink and counted once", () => {
    expect(read(DISC + SQUARE('fill="white" opacity="0"')).fills[0]?.holes).toHaveLength(0)
    expect(read(DISC + SQUARE('fill="white" fill-opacity="0"')).fills[0]?.holes).toHaveLength(0)
    expect(read(SQUARE('fill="black" opacity="0"')).fills).toEqual([])
    const r = read(SQUARE('fill="papayawhip"') + '<rect width="1" height="1" fill="hsl(0, 0%, 100%)"/>')
    expect(r.fills).toHaveLength(2)
    expect(r.skipped).toEqual(["2 paints not read, drawn as ink"])
  })

  it("a drawing with only dark shapes comes out exactly as before: no union, no rounding", () => {
    const body = '<path fill-rule="evenodd" d="M1 1 H9 V9 H1 Z M3 3 H7 V7 H3 Z"/><rect x="2.12345" y="2" width="10" height="3" fill="#123"/><polyline points="0 0 5 5" stroke="black" fill="none"/>'
    const r = read(body)
    expect(r.fills).toHaveLength(2)
    expect(r.fills[0]?.holes).toHaveLength(1)
    expect(r.fills[1]?.outer.some((p) => Math.abs(p.x - 2.12345) < 1e-9)).toBe(true)
    expect(r.strokes).toHaveLength(1)
    const marked = read(body.replace('fill="#123"', 'fill="black"'))
    expect(marked).toEqual(r)
  })

  it("placing a cut-out drawing keeps its hole", () => {
    const placed = placeGraphic(read(DISC + SQUARE('fill="white"')), { x: 0, y: 0, scale: 1, rotation: 0, bottom: false, fill: false })
    expect(placed.areas).toHaveLength(1)
    expect(placed.areas[0]?.holes).toHaveLength(1)
  })

  it("leaves DXF as it was: a DXF here has no fill colours", () => {
    const dxf = ["0", "SECTION", "2", "ENTITIES", "0", "CIRCLE", "8", "0", "62", "7", "10", "0", "20", "0", "40", "5", "0", "ENDSEC", "0", "EOF"].join("\n")
    const result = parseGraphic(dxf, "dxf")
    if ("error" in result) throw new Error(result.error)
    expect(result.strokes).toHaveLength(1)
  })
})

describe("the cost of cutting", () => {
  it("cuts a 100,000-point drawing within a bound, and still refuses past 200,000 points before cutting", () => {
    const ring = (cx: number, cy: number, r: number, n: number) => {
      const pts = Array.from({ length: n }, (_, i) => `${(cx + r * Math.cos((2 * Math.PI * i) / n)).toFixed(4)} ${(cy + r * Math.sin((2 * Math.PI * i) / n)).toFixed(4)}`)
      return `M${pts.join(" L")} Z`
    }
    const discs = Array.from({ length: 100 }, (_, i) => `<path d="${ring((i % 10) * 20 + 10, Math.floor(i / 10) * 20 + 10, 9, 500)}"/>`).join("")
    const holes = Array.from({ length: 100 }, (_, i) => `<path fill="white" d="${ring((i % 10) * 20 + 10, Math.floor(i / 10) * 20 + 10, 4, 500)}"/>`).join("")
    const root = 'width="200mm" height="200mm" viewBox="0 0 200 200"'
    const started = performance.now()
    const r = read(discs + holes, root)
    const elapsed = performance.now() - started
    expect(r.fills).toHaveLength(100)
    expect(r.fills.every((f) => f.holes.length === 1)).toBe(true)
    expect(elapsed).toBeLessThan(5000)
    const big = Array.from({ length: 220 }, () => '<circle cx="5000" cy="5000" r="4000"/>').join("") + '<circle cx="5000" cy="5000" r="10" fill="white"/>'
    const tooMany = parseGraphic(`<svg xmlns="http://www.w3.org/2000/svg" width="10000mm" height="10000mm" viewBox="0 0 10000 10000">${big}</svg>`, "svg")
    expect(tooMany).toEqual({ error: "The drawing comes to more than 200000 points; simplify it first" })
  })
})
