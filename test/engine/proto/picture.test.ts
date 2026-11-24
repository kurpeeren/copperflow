import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../../../src/engine/design.js"
import { renderBoardView } from "../../../src/engine/fab/picture/board-view.js"
import { toPixel, gridFor } from "../../../src/engine/fab/picture/raster.js"
import { holePoint, parseHole } from "../../../src/engine/proto/grid.js"
import { protoPicture, protoScale } from "../../../src/engine/proto/picture.js"

const MAIN = "main.circuit.tsx"
const PARTS = ['<pinheader name="J1" pinCount={3} pitch="2.54mm" pcbX={-6.35} pcbY={1.27} />', '<pinheader name="J2" pinCount={3} pitch="2.54mm" pcbX={-6.35} pcbY={-3.81} />']

function design(kind: string, records: readonly object[]): Design {
  const circuit = `export default () => (\n  <board kind="${kind}" columns={10} rows={6}>\n${PARTS.join("\n")}\n  </board>\n)\n`
  return buildDesign({ [MAIN]: circuit, "main.circuit.layout.json": records.map((r) => JSON.stringify(r)).join("\n") }, MAIN)
}

const PX_PER_MM = 20
/** The colour of the picture at a board point. */
function colourAt(built: Design, side: "top" | "bottom", at: { x: number; y: number }): number[] {
  const picture = protoPicture(built.pcb, side, PX_PER_MM)
  const outline = built.pcb.board?.outline ?? []
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  const grid = gridFor({ minX: Math.min(...xs) - 3.2, minY: Math.min(...ys) - 3.2, maxX: Math.max(...xs) + 3.2, maxY: Math.max(...ys) + 3.2 }, PX_PER_MM, side === "bottom")
  const p = toPixel(grid, at)
  const i = (Math.floor(p.y) * picture.width + Math.floor(p.x)) * 4
  return [...picture.rgba.slice(i, i + 3)]
}

const hole = (built: Design, name: string) => {
  const grid = built.pcb.board?.proto
  const parsed = parseHole(name)
  if (!grid || !parsed) throw new Error("no hole")
  return holePoint(grid, parsed)
}
const between = (built: Design, a: string, b: string) => {
  const [p, q] = [hole(built, a), hole(built, b)]
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
}

describe("the picture of a proto board", () => {
  test("is the board with room for its labels", () => {
    const built = design("perfboard", [])
    const picture = protoPicture(built.pcb, "top", PX_PER_MM)
    expect(picture.width).toBe(Math.ceil((25.4 + 6.4) * PX_PER_MM))
    expect(picture.height).toBe(Math.ceil((6 * 2.54 + 6.4) * PX_PER_MM))
    expect(protoScale(built.pcb, picture.width)).toBeCloseTo(PX_PER_MM, 1)
  })

  test("a solder run is silver on the bottom between its holes", () => {
    const built = design("perfboard", [{ t: "solder", id: "s1", holes: ["C2", "D2"] }])
    const [r, g, b] = colourAt(built, "bottom", between(built, "C2", "D2"))
    expect(Math.abs((r as number) - (b as number))).toBeLessThan(20)
    expect(r).toBeGreaterThan(170)
    // Not between two holes the run does not join.
    expect(colourAt(built, "bottom", between(built, "C6", "D6"))).not.toEqual([r, g, b])
  })

  test("a link is a coloured wire on the top", () => {
    const built = design("perfboard", [{ t: "link", id: "w1", from: "A6", to: "E6" }])
    expect(colourAt(built, "top", between(built, "B6", "C6"))).toEqual([30, 90, 200])
  })

  test("a strip is copper until it is cut, and the cut is marked in red", () => {
    const built = design("stripboard", [{ t: "cut", id: "x1", between: ["A7", "A8"] }])
    const copper = colourAt(built, "bottom", between(built, "A5", "A6"))
    expect(copper[0]).toBeGreaterThan(copper[2] as number)
    const [r, g] = colourAt(built, "bottom", between(built, "A7", "A8"))
    expect(r).toBeGreaterThan(180)
    expect(g).toBeLessThan(80)
  })

  test("render's board view draws it and says what it shows", async () => {
    const built = design("stripboard", [{ t: "cut", id: "x1", at: "A7" }])
    const fake = async () => ({
      createCanvas: () => ({
        getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }),
        encode: async () => new Uint8Array([1, 2, 3]),
      }),
    })
    const view = await renderBoardView(built, { side: "bottom", width: 640 }, fake)
    expect(view.what).toBe("the stripboard as built, bottom seen from below (left and right swapped): strips and cuts, 10 x 6 holes, 0 links, 1 cut")
    expect(view.width).toBe(640)
    await expect(renderBoardView(built, { look: { mask: "red" } }, fake)).rejects.toThrow("look is for a made board; a stripboard is drawn as it is")
    await expect(renderBoardView(built, { parts: ["J1"] }, fake)).rejects.toThrow("parts zooms a made board; a stripboard is drawn whole")
    await expect(renderBoardView(built, { width: 100 }, fake)).rejects.toThrow(/width must be a whole number/)
    const perf = await renderBoardView(design("perfboard", [{ t: "solder", id: "s1", holes: ["C2", "D2"] }]), {}, fake)
    expect(perf.what).toBe("the perfboard as built, top: parts and links, 10 x 6 holes, 1 solder run, 0 links")
  })

  test("a board that is not a proto board is refused", () => {
    const built = buildDesign({ [MAIN]: 'export default () => (\n  <board width="10mm" height="10mm">\n  </board>\n)\n' }, MAIN)
    expect(() => protoPicture(built.pcb, "top", PX_PER_MM)).toThrow("The board is not a perfboard or stripboard")
  })
})
