import { describe, expect, it } from "vitest"
import { parseGraphic, signedArea, type GraphicShapes } from "../../src/engine/graphics/index.js"
import type { Point } from "../../src/engine/model.js"

function read(body: string, root = 'width="100mm" height="100mm" viewBox="0 0 100 100"'): GraphicShapes {
  const result = parseGraphic(`<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`, "svg")
  if ("error" in result) throw new Error(result.error)
  return result
}

function refusal(text: string): string {
  const result = parseGraphic(text, "svg")
  if (!("error" in result)) throw new Error("expected a refusal")
  return result.error
}


/** A letter L and a ring beside it: what a small mark on a board looks like. */
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="10mm" viewBox="0 0 30 10">
  <g id="mark" fill="#000">
    <path d="M1 1 H3 V7 H7 V9 H1 Z"/>
    <path fill-rule="evenodd" d="M20 5 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 Z M22 5 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 Z"/>
  </g>
  <text x="0" y="10">LOGO</text>
</svg>`

describe("SVG units and placement", () => {
  it("takes the user unit from a physical width against the viewBox", () => {
    const r = read('<rect width="200" height="100"/>', 'width="20mm" viewBox="0 0 200 100"')
    expect(r.width).toBeCloseTo(20)
    expect(r.height).toBeCloseTo(10)
  })
  it.each([
    ["1in", 25.4],
    ["2cm", 20],
    ["72pt", 25.4],
    ["6pc", 25.4],
    ["96px", 25.4],
    ["96", 25.4],
  ])("reads a width of %s", (width, mm) => {
    const r = read('<rect width="10" height="10"/>', `width="${width}" height="${width}" viewBox="0 0 10 10"`)
    expect(r.width).toBeCloseTo(mm)
  })
  it("takes 1 user unit as 1 px without a physical size", () => {
    const r = read('<rect width="96" height="48"/>', "")
    expect(r.width).toBeCloseTo(25.4)
    expect(r.height).toBeCloseTo(12.7)
  })
  it("flips y: what is at the top in SVG is at the top in the result", () => {
    const r = read('<rect x="0" y="0" width="10" height="2"/><rect x="0" y="8" width="2" height="2"/>')
    const small = r.fills.find((f) => Math.abs(signedArea(f.outer)) < 5)
    expect(small).toBeDefined()
    expect(Math.max(...(small as { outer: Point[] }).outer.map((p) => p.y))).toBeCloseTo(2)
  })
})

describe("SVG elements", () => {
  it("reads a rect with rounded corners", () => {
    const r = read('<rect x="0" y="0" width="10" height="6" rx="2"/>')
    expect(r.width).toBeCloseTo(10)
    expect(Math.abs(signedArea(r.fills[0]!.outer))).toBeCloseTo(60 - (4 - Math.PI) * 4, 0)
  })
  it("reads circle, ellipse, polygon as fills and line, polyline as strokes", () => {
    const r = read('<circle cx="5" cy="5" r="5"/><ellipse cx="20" cy="5" rx="4" ry="2"/><polygon points="30,0 40,0 35,8"/><line x1="0" y1="20" x2="10" y2="20" stroke="black" stroke-width="2"/><polyline points="0,30 5,35 10,30" fill="none" stroke="#000"/>')
    expect(r.fills).toHaveLength(3)
    expect(Math.abs(signedArea(r.fills[0]!.outer))).toBeCloseTo(25 * Math.PI, 0)
    expect(Math.abs(signedArea(r.fills[1]!.outer))).toBeCloseTo(8 * Math.PI, 0)
    expect(r.strokes).toHaveLength(2)
    expect(r.strokes[0]!.width).toBeCloseTo(2)
    expect(r.strokes[1]!.width).toBeCloseTo(1)
  })
  it("draws a use of a local id and leaves defs and symbols undrawn unless used", () => {
    const r = read('<defs><rect id="a" width="2" height="2"/></defs><symbol id="s"><rect width="9" height="9"/></symbol><use href="#a" x="10"/><use xlink:href="#a" x="20"/>')
    expect(r.fills).toHaveLength(2)
    expect(r.width).toBeCloseTo(12)
  })
  it("skips a use of another file and a use inside a used element", () => {
    const r = read('<use href="other.svg#a"/><g id="g"><use href="#r"/></g><rect id="r" width="1" height="1"/><use href="#g" x="5"/>')
    expect(r.skipped.join(";")).toMatch(/link/)
    expect(r.skipped.join(";")).toMatch(/one level/)
  })
  it("counts text, images, clip paths, gradients and style sheets", () => {
    const r = read('<style>.a{fill:red}</style><text>Hi</text><text>Yo</text><image href="x.png"/><clipPath id="c"><rect width="1" height="1"/></clipPath><linearGradient id="gr"/><rect width="4" height="4" clip-path="url(#c)" fill="url(#gr)"/>')
    const notes = r.skipped.join(";")
    expect(notes).toMatch(/2 text elements/)
    expect(notes).toMatch(/1 embedded image/)
    expect(notes).toMatch(/unclipped/)
    expect(notes).toMatch(/plain fill/)
    expect(notes).toMatch(/style sheet/)
    expect(r.fills).toHaveLength(1)
  })
  it("leaves out display:none and visibility:hidden, and fills a white shape like any other", () => {
    const r = read('<rect width="1" height="1" style="display:none"/><g visibility="hidden"><rect width="1" height="1"/></g><rect width="3" height="3" fill="#fff"/>')
    expect(r.fills).toHaveLength(1)
  })
  it("fills nothing with fill none and strokes nothing by default", () => {
    const r = read('<rect width="3" height="3" fill="none"/>')
    expect(r.fills).toHaveLength(0)
    expect(r.strokes).toHaveLength(0)
  })
})

describe("SVG path data", () => {
  const ring = (d: string) => read(`<path d="${d}"/>`).fills[0]!.outer
  it.each([
    ["M0 0L10 0L10 10Z", 50],
    ["m0 0l10 0l0 10z", 50],
    ["M0,0 10,0 10,10z", 50],
    ["M0 0H10V10Z", 50],
    ["m0 0h10v10z", 50],
    ["M0-0 10-0 10 10z", 50],
    ["M0 0 1e1 0 1E+1 1e1Z", 50],
    ["M.5.5 10.5.5 10.5 10.5z", 50],
  ])("reads %s", (d, area) => {
    expect(Math.abs(signedArea(ring(d)))).toBeCloseTo(area)
  })
  it("reads curves (C S Q T, both cases) through their end points", () => {
    const r = read('<path d="M0 0 C0 10 10 10 10 0 S20 -10 20 0 Q25 10 30 0 T40 0 c0 -5 -40 -5 -40 0z"/>')
    expect(r.width).toBeCloseTo(40)
    expect(r.fills[0]!.outer.length).toBeGreaterThan(10)
    const lower = read('<path d="m0 0 c0 10 10 10 10 0 s10 -10 10 0 q5 10 10 0 t10 0 c0 -5 -40 -5 -40 0z"/>')
    expect(lower.width).toBeCloseTo(40)
    expect(lower.height).toBeCloseTo(r.height)
  })
  it("draws an arc through its known middle point, by its flags", () => {
    // Half circles of radius 5 from (0,5) to (10,5): sweep 1 goes through the top in SVG (y=0), sweep 0 the bottom.
    const up = read('<path d="M0 5 A5 5 0 0 1 10 5Z"/>', 'width="10mm" height="10mm" viewBox="0 0 10 10"')
    const down = read('<path d="M0 5 A5 5 0 0 0 10 5Z"/>', 'width="10mm" height="10mm" viewBox="0 0 10 10"')
    expect(up.height).toBeCloseTo(5, 2)
    expect(down.height).toBeCloseTo(5, 2)
    expect(Math.abs(signedArea(up.fills[0]!.outer))).toBeCloseTo((25 * Math.PI) / 2, 0)
  })
  it("scales up radii that are too small, and draws zero radii as a line", () => {
    const small = read('<path d="M0 0 A1 1 0 0 1 10 0Z"/>')
    expect(small.height).toBeCloseTo(5, 2)
    const zero = read('<path d="M0 0 A0 5 0 0 1 10 0 L10 10Z"/>')
    expect(Math.abs(signedArea(zero.fills[0]!.outer))).toBeCloseTo(50)
  })
  it("reads arc flags written without separators", () => {
    const r = read('<path d="M0 0a5 5 0 1010 0z"/>')
    expect(r.height).toBeCloseTo(5, 2)
  })
  it("keeps the curve within the tolerance of the true circle", () => {
    const r = read('<circle cx="50" cy="50" r="40"/>')
    const centre = { x: 40, y: 40 }
    for (const p of r.fills[0]!.outer) expect(Math.abs(Math.hypot(p.x - centre.x, p.y - centre.y) - 40)).toBeLessThan(0.021)
  })
  it("draws a path with bad data up to the error and says so", () => {
    const r = read('<path d="M0 0 L10 0 L10 10 X 5 5"/>')
    expect(r.fills).toHaveLength(1)
    expect(r.skipped.join(";")).toMatch(/error/)
  })
})

describe("SVG fill rules and rings", () => {
  const SQUARES_SAME = "M0 0H10V10H0Z M3 3H7V7H3Z"
  const SQUARES_OPPOSITE = "M0 0H10V10H0Z M3 3V7H7V3Z"
  it("makes a hole with evenodd whatever the inner ring's direction", () => {
    for (const d of [SQUARES_SAME, SQUARES_OPPOSITE]) {
      const r = read(`<path fill-rule="evenodd" d="${d}"/>`)
      expect(r.fills).toHaveLength(1)
      expect(r.fills[0]!.holes).toHaveLength(1)
    }
  })
  it("makes a hole with nonzero only when the inner ring runs the other way", () => {
    expect(read(`<path d="${SQUARES_OPPOSITE}"/>`).fills[0]!.holes).toHaveLength(1)
    const same = read(`<path d="${SQUARES_SAME}"/>`)
    expect(same.fills).toHaveLength(1)
    expect(same.fills[0]!.holes).toHaveLength(0)
  })
  it("returns outer rings counter-clockwise and holes clockwise", () => {
    const r = read(`<path fill-rule="evenodd" d="${SQUARES_SAME} M4 4H6V6H4Z"/>`)
    expect(r.fills).toHaveLength(2)
    for (const f of r.fills) {
      expect(signedArea(f.outer)).toBeGreaterThan(0)
      for (const h of f.holes) expect(signedArea(h)).toBeLessThan(0)
    }
  })
  it("does not crash on subpaths that cross", () => {
    const r = read('<path d="M0 0H10V10H0Z M5 5H15V15H5Z M0 0L10 10L10 0L0 10Z"/>')
    expect(r.fills.length).toBeGreaterThan(0)
  })
})

describe("SVG transforms", () => {
  it.each([
    ['transform="translate(10 5)"', 2, 2],
    ['transform="scale(2)"', 4, 4],
    ['transform="scale(2,3)"', 4, 6],
    ['transform="rotate(90)"', 2, 2],
    ['transform="rotate(45 1 1)"', 2 * Math.SQRT2, 2 * Math.SQRT2],
    ['transform="skewX(45)"', 4, 2],
    ['transform="skewY(45)"', 2, 4],
    ['transform="matrix(2 0 0 1 0 0)"', 4, 2],
  ])("applies %s", (transform, w, h) => {
    const r = read(`<rect width="2" height="2" ${transform}/>`)
    expect(r.width).toBeCloseTo(w)
    expect(r.height).toBeCloseTo(h)
  })
  it("nests through groups, outermost first", () => {
    const r = read('<g transform="scale(2)"><g transform="translate(1,0) scale(1 3)"><rect width="1" height="1"/></g></g>')
    expect(r.width).toBeCloseTo(2)
    expect(r.height).toBeCloseTo(6)
  })
  it("scales a stroke's width by the transform's mean scale and the unit", () => {
    const r = read('<g transform="scale(4 1)"><line x2="10" stroke="black" stroke-width="0.5"/></g>', 'width="20mm" viewBox="0 0 10 10"')
    expect(r.strokes[0]!.width).toBeCloseTo(0.5 * 2 * 2)
  })
})

describe("the logo fixture", () => {
  it("reads a letter and a ring with its hole, and counts the text", () => {
    const r = parseGraphic(LOGO, "svg") as GraphicShapes
    expect(r.fills).toHaveLength(2)
    const ring = r.fills.find((f) => f.holes.length === 1)
    expect(ring).toBeDefined()
    expect(r.width).toBeCloseTo(27)
    expect(r.height).toBeCloseTo(8)
    expect(r.skipped).toContain("1 text element")
  })
  it("has no NaN, rings of 3 points or more, bounds from 0,0 to width × height", () => {
    const r = parseGraphic(LOGO, "svg") as GraphicShapes
    const points = [...r.fills.flatMap((f) => [f.outer, ...f.holes].flat()), ...r.strokes.flatMap((s) => s.points)]
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    for (const f of r.fills) for (const ring of [f.outer, ...f.holes]) expect(ring.length).toBeGreaterThanOrEqual(3)
    expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(0)
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(0)
    expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(r.width)
    expect(Math.max(...points.map((p) => p.y))).toBeCloseTo(r.height)
  })
})

describe("SVG refusals", () => {
  it("refuses entity declarations", () => {
    expect(refusal('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;">]><svg>&b;</svg>')).toMatch(/entit/i)
  })
  it("refuses text over 2 MB, quickly, even a path of 10 MB of l1 1", () => {
    const started = Date.now()
    expect(refusal(`<svg><path d="M0 0${" l1 1".repeat(2_000_000)}"/></svg>`)).toMatch(/MB/)
    expect(Date.now() - started).toBeLessThan(2000)
  })
  it("refuses a drawing of too many points", () => {
    expect(refusal(`<svg><path fill="none" stroke="#000" d="M0 0${"l1 1".repeat(300_000)}"/></svg>`)).toMatch(/points/)
  })
  it.each([
    ["truncated", '<svg width="10"><path d="M0 0 L1'],
    ["unbalanced", "<svg><g><rect width='1' height='1'></svg>"],
    ["not svg", "<html></html>"],
    ["empty", ""],
    ["garbage", "\u0000\u0001<<<>>>"],
    ["bad attribute", "<svg><rect width=1/></svg>"],
    ["unknown entity", "<svg><rect id='&x;'/></svg>"],
  ])("refuses %s input", (_, text) => {
    expect(typeof refusal(text)).toBe("string")
  })
  it("refuses absurd and non-finite numbers rather than giving NaN", () => {
    expect(refusal('<svg><rect width="1e400" height="1"/></svg>')).toBeTruthy()
    expect(refusal('<svg><path d="M0 0 L1e308 1e308 L-1e308 0Z" transform="scale(1e10)"/></svg>')).toBeTruthy()
    expect(refusal('<svg><rect width="NaN" height="1"/></svg>')).toBeTruthy()
  })
  it("refuses nesting deeper than the limit", () => {
    expect(refusal(`<svg>${"<g>".repeat(5000)}${"</g>".repeat(5000)}</svg>`)).toMatch(/deep/)
  })
  it("never fetches: a remote href is only counted", () => {
    const r = read('<image href="https://example.com/a.png"/><use href="https://example.com/a.svg#x"/>')
    expect(r.fills).toHaveLength(0)
  })
})

describe("graphicKind", async () => {
  const { graphicKind } = await import("../../src/engine/graphics/index.js")
  it("names the kind by the file's extension", () => {
    expect(graphicKind("Logo.SVG")).toBe("svg")
    expect(graphicKind("a.dxf")).toBe("dxf")
    expect(graphicKind("a.png")).toBeUndefined()
  })
})


describe("SVG robustness", () => {
  it("never throws on any truncation of the logo", () => {
    for (let n = 0; n <= LOGO.length; n += 3) expect(() => parseGraphic(LOGO.slice(0, n), "svg")).not.toThrow()
  })
})
