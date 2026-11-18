// A drawing placed on the board (`<boardgraphic>`): its props and refusals, where its shapes land (size, centre,
// rotation, the bottom mirrored), the Gerber silkscreen and mask files and pictures carrying it, and its checks. The
// file reader is stood in for by hand-made shapes written as JSON, so these tests do not depend on the SVG reader.
import { describe, expect, test, vi } from "vitest"
import type { GraphicShapes } from "../../src/engine/graphics/index.js"

/** How many times the build asked the reader, so a test can see the cache answer instead. */
const reads = vi.hoisted(() => ({ count: 0 }))

vi.mock("../../src/engine/graphics/index.js", async (original) => ({
  ...(await original<typeof import("../../src/engine/graphics/index.js")>()),
  parseGraphic: (text: string) => {
    reads.count++
    return text.startsWith("{") ? (JSON.parse(text) as GraphicShapes) : { error: "it is not a drawing" }
  },
}))

const { buildDesign } = await import("../../src/engine/design.js")
const { gerberFiles } = await import("../../src/engine/fab/layers.js")
const { boardPicture } = await import("../../src/engine/fab/picture/board-picture.js")
const { graphicBox, placeGraphic, MIN_GRAPHIC_LINE_WIDTH, MAX_FILLED_OUTLINES } = await import("../../src/engine/graphic-place.js")
const { readGerber } = await import("../helpers/gerber-read.js")

/** A 10 × 10 mm square with a 4 × 4 mm hole in the middle, and a 0.2 mm line along its bottom edge. */
const RING: GraphicShapes = {
  fills: [{ outer: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], holes: [[{ x: 3, y: 3 }, { x: 3, y: 7 }, { x: 7, y: 7 }, { x: 7, y: 3 }]] }],
  strokes: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], width: 0.2, closed: false }],
  width: 10,
  height: 10,
  skipped: ["1 text element"],
}
/** A 20 × 5 mm outline with no fill and no width, as a DXF gives. */
const OUTLINE: GraphicShapes = { fills: [], strokes: [{ points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 5 }, { x: 0, y: 5 }], width: 0, closed: true }], width: 20, height: 5, skipped: [] }

const MAIN = "main.circuit.tsx"
const CREATED = new Date(Date.UTC(2026, 10, 18, 12, 0, 0))
const design = (items: string, files: Record<string, string> = {}) =>
  buildDesign(
    {
      [MAIN]: `export default () => (
  <board width="40mm" height="30mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-15} pcbY={-10} />
    ${items}
  </board>
)`,
      "graphics/ring.svg": JSON.stringify(RING),
      "graphics/outline.dxf": JSON.stringify(OUTLINE),
      ...files,
    },
    MAIN,
  )
const warnings = (built: ReturnType<typeof design>) => built.diagnostics.filter((d) => d.message.startsWith("boardgraphic")).map((d) => d.message)

describe("placing the shapes", () => {
  test("a width keeps the aspect, centres the drawing and scales its line widths", () => {
    const placed = placeGraphic(RING, { x: 5, y: -2, scale: 0.5, rotation: 0, bottom: false, fill: false })
    expect([placed.width, placed.height]).toEqual([5, 5])
    expect(placed.areas).toHaveLength(1)
    expect(placed.areas[0]?.holes).toHaveLength(1)
    const box = graphicBox({ ...placed, x: 5, y: -2 })
    // The bottom line's half width (0.05 mm) reaches past the area's corner.
    expect(box.minX).toBeCloseTo(2.45)
    expect(box.maxX).toBeCloseTo(7.55)
    expect(box.maxY).toBeCloseTo(0.5)
    expect(placed.lines[0]?.width).toBeCloseTo(0.1)
  })

  test("the bottom side is mirrored left to right, and a rotation turns it counter-clockwise", () => {
    const top = placeGraphic(RING, { x: 0, y: 0, scale: 1, rotation: 0, bottom: false, fill: false })
    const bottom = placeGraphic(RING, { x: 0, y: 0, scale: 1, rotation: 0, bottom: true, fill: false })
    expect(top.lines[0]?.points.map((p) => p.x)).toEqual([-5, 5])
    expect(bottom.lines[0]?.points.map((p) => p.x)).toEqual([5, -5])
    const turned = placeGraphic(RING, { x: 0, y: 0, scale: 1, rotation: 90, bottom: false, fill: false })
    const [a, b] = turned.lines[0]?.points ?? []
    expect([a?.x, a?.y, b?.x, b?.y].map((v) => Math.round((v ?? 0) * 1e6) / 1e6)).toEqual([5, -5, 5, 5])
  })

  test("a closed line without width is a line of the typical minimum, or an area when fill is asked", () => {
    const open = placeGraphic(OUTLINE, { x: 0, y: 0, scale: 1, rotation: 0, bottom: false, fill: false })
    expect(open.areas).toEqual([])
    expect(open.lines[0]?.width).toBe(MIN_GRAPHIC_LINE_WIDTH)
    expect(open.lines[0]?.points).toHaveLength(5)
    const filled = placeGraphic(OUTLINE, { x: 0, y: 0, scale: 1, rotation: 0, bottom: false, fill: true })
    expect(filled.lines).toEqual([])
    expect(filled.areas).toHaveLength(1)
  })
})

describe("the <boardgraphic> element", () => {
  test("is built with its id, size, layer and what the reader left out", () => {
    const built = design(`<boardgraphic file="graphics/ring.svg" layer="top-silkscreen" x={5} y={5} width={8} name="logo" />`)
    expect(warnings(built)).toEqual([])
    const [graphic] = built.pcb.graphics ?? []
    expect(graphic).toMatchObject({ id: "boardgraphic:1", file: "graphics/ring.svg", layer: "top-silkscreen", x: 5, y: 5, width: 8, height: 8, name: "logo", skipped: ["1 text element"] })
  })

  test("a scale sizes it, and a group moves it", () => {
    const built = design(`<group pcbX={2}><boardgraphic file="graphics/outline.dxf" layer="bottom-mask" x={0} y={0} scale={0.5} /></group>`)
    expect(built.pcb.graphics?.[0]).toMatchObject({ x: 2, width: 10, height: 2.5, layer: "bottom-mask" })
  })

  test("a bad prop, a missing or unreadable file, or a net off copper is a warning naming the reason, and it is left out", () => {
    const cases: [string, RegExp][] = [
      [`<boardgraphic file="logo.svg" x={0} y={0} />`, /file must be "graphics\/<name>.svg"/],
      [`<boardgraphic file="graphics/../x.svg" x={0} y={0} />`, /file must be/],
      [`<boardgraphic file="graphics/none.svg" x={0} y={0} />`, /graphics\/none.svg was not found in the project/],
      [`<boardgraphic file="graphics/bad.svg" x={0} y={0} />`, /graphics\/bad.svg could not be read: it is not a drawing/],
      [`<boardgraphic file="graphics/ring.svg" layer="top-silkscreen" net="GND" x={0} y={0} />`, /net is only for a drawing on copper/],
      [`<boardgraphic file="graphics/ring.svg" layer="paste" x={0} y={0} />`, /layer must be one of top-silkscreen/],
      [`<boardgraphic file="graphics/ring.svg" x={0} y={0} width={5} scale={2} />`, /give width or scale, not both/],
      [`<boardgraphic file="graphics/ring.svg" x={0} y={0} width={500} />`, /width must be from 0.5 to 300 mm/],
      [`<boardgraphic file="graphics/ring.svg" x={0} />`, /needs x and y/],
    ]
    for (const [item, reason] of cases) {
      const built = design(item, { "graphics/bad.svg": "<nonsense" })
      expect(built.pcb.graphics).toBeUndefined()
      expect(warnings(built).join("\n")).toMatch(reason)
    }
  })
})

const files = (built: ReturnType<typeof design>, layer: string) =>
  readGerber(gerberFiles(built.pcb, built.rules.fabrication, "b", CREATED).find((f) => f.file.startsWith(`b-${layer}.`))?.text ?? "")
const within = (box: { minX: number; minY: number; maxX: number; maxY: number }, p: { x: number; y: number }) =>
  p.x >= box.minX - 1e-3 && p.x <= box.maxX + 1e-3 && p.y >= box.minY - 1e-3 && p.y <= box.maxY + 1e-3

describe("the Gerber files", () => {
  const built = design(`<boardgraphic file="graphics/ring.svg" layer="top-silkscreen" x={5} y={5} width={8} />
    <boardgraphic file="graphics/ring.svg" layer="bottom-mask" x={-5} y={5} width={6} />`)
  const plain = design("")
  const [silk, mask] = built.pcb.graphics ?? []

  test("the top legend gains a dark region with a clear hole and the line, all inside the drawing's box", () => {
    const top = files(built, "F_Silkscreen")
    const before = files(plain, "F_Silkscreen")
    const added = top.regions.slice(0, top.regions.length - before.regions.length)
    expect(added.map((r) => r.polarity)).toEqual(["dark", "clear"])
    expect(added.every((r) => r.points.every((p) => within(graphicBox(silk!), p)))).toBe(true)
    expect(top.strokes.length).toBe(before.strokes.length + 1)
    expect(files(built, "B_Silkscreen").regions.length).toBe(files(plain, "B_Silkscreen").regions.length)
  })

  test("the bottom mask gains the opening, and the top mask does not", () => {
    const bottom = files(built, "B_Mask")
    expect(bottom.regions.length).toBe(files(plain, "B_Mask").regions.length + 2)
    expect(bottom.regions.every((r) => r.points.every((p) => within(graphicBox(mask!), p)))).toBe(true)
    expect(files(built, "F_Mask").regions.length).toBe(files(plain, "F_Mask").regions.length)
  })
})

describe("the board-as-made pictures", () => {
  const plain = design("")
  const changed = (items: string, side: "top" | "bottom") => {
    const built = design(items)
    const [a, b] = [boardPicture(built, { side, pxPerMm: 8 }), boardPicture(plain, { side, pxPerMm: 8 })]
    const box = graphicBox(built.pcb.graphics![0]!)
    let [inside, outside] = [0, 0]
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        const i = (y * a.width + x) * 4
        if (a.rgba[i] === b.rgba[i] && a.rgba[i + 1] === b.rgba[i + 1] && a.rgba[i + 2] === b.rgba[i + 2]) continue
        const mm = { x: (a.mirrored ? a.origin.x - x - 0.5 : x + 0.5 - a.origin.x) * a.mmPerPx, y: (a.origin.y - y - 0.5) * a.mmPerPx }
        const grown = { minX: box.minX - a.mmPerPx, minY: box.minY - a.mmPerPx, maxX: box.maxX + a.mmPerPx, maxY: box.maxY + a.mmPerPx }
        if (within(grown, mm)) inside++
        else outside++
      }
    }
    return { inside, outside }
  }

  test("change only inside the drawing's box, on its own side, for the silkscreen and the mask", () => {
    for (const [layer, side] of [["top-silkscreen", "top"], ["bottom-silkscreen", "bottom"], ["top-mask", "top"], ["bottom-mask", "bottom"]] as const) {
      const result = changed(`<boardgraphic file="graphics/ring.svg" layer="${layer}" x={5} y={5} width={8} />`, side)
      expect(result.inside, layer).toBeGreaterThan(500)
      expect(result.outside, layer).toBe(0)
      const other = changed(`<boardgraphic file="graphics/ring.svg" layer="${layer}" x={5} y={5} width={8} />`, side === "top" ? "bottom" : "top")
      expect(other.inside + other.outside, layer).toBe(0)
    }
  })
})

describe("the checks", () => {
  const found = (item: string, code: string) => design(item).violations.filter((v) => v.code === code && v.items.some((one) => one.startsWith("boardgraphic"))).map((v) => v.id)

  test("a drawing clear of pads and the edge, with printable lines, has no finding", () => {
    const item = `<boardgraphic file="graphics/ring.svg" x={5} y={2} width={16} />`
    expect([...found(item, "silk-on-pad"), ...found(item, "silk-off-board"), ...found(item, "silk-too-thin")]).toEqual([])
  })

  test("ink over a pad is silk-on-pad, past the edge silk-off-board, too thin silk-too-thin", () => {
    expect(found(`<boardgraphic file="graphics/ring.svg" x={-15} y={-10} width={6} />`, "silk-on-pad")).toEqual(["silk-on-pad:boardgraphic:1,R1#1", "silk-on-pad:boardgraphic:1,R1#2"])
    expect(found(`<boardgraphic file="graphics/ring.svg" x={18} y={0} width={8} />`, "silk-off-board")).toEqual(["silk-off-board:boardgraphic:1"])
    const thin = design(`<boardgraphic file="graphics/ring.svg" x={0} y={0} width={5} />`).violations.find((v) => v.code === "silk-too-thin")
    expect(thin?.message).toContain("has lines 0.100 mm wide; the thinnest a board house prints is about 0.150 mm")
  })

  test("a drawing on the mask is an opening, not ink, and is not checked as silkscreen", () => {
    expect(found(`<boardgraphic file="graphics/ring.svg" layer="top-mask" x={-15} y={-10} width={6} />`, "silk-on-pad")).toEqual([])
  })
})

/** `count` small closed squares of no fill in a grid, each 1 mm with a 0.5 mm gap. */
function squares(count: number): GraphicShapes {
  const side = Math.ceil(Math.sqrt(count))
  const strokes = Array.from({ length: count }, (_, i) => {
    const [x, y] = [(i % side) * 1.5, Math.floor(i / side) * 1.5]
    return { points: [{ x, y }, { x: x + 1, y }, { x: x + 1, y: y + 1 }, { x, y: y + 1 }], width: 0, closed: true }
  })
  return { fills: [], strokes, width: side * 1.5, height: side * 1.5, skipped: [] }
}

describe("large and repeated drawings", () => {
  // The bound is loose on purpose (a coverage run on a busy machine is slow); comparing every pair took far longer.
  test("8,000 closed outlines are filled without comparing every pair", { timeout: 60_000 }, () => {
    const start = performance.now()
    const placed = placeGraphic(squares(8000), { x: 0, y: 0, scale: 1, rotation: 0, bottom: false, fill: true })
    expect(performance.now() - start).toBeLessThan(15_000)
    expect(placed.areas).toHaveLength(8000)
    expect(placed.skipped).toEqual([])
  })

  test("outlines beyond the limit are left out, and said so", () => {
    const placed = placeGraphic(squares(MAX_FILLED_OUTLINES + 5), { x: 0, y: 0, scale: 1, rotation: 0, bottom: false, fill: true })
    expect(placed.skipped).toEqual([`5 closed outlines beyond the ${MAX_FILLED_OUTLINES} filled`])
    expect(placed.lines).toEqual([])
  })

  test("a second build of the same drawing does not read the file again; a moved one neither; a changed file does", () => {
    const own = JSON.stringify({ ...RING, skipped: ["cache test"] })
    const at = (x: number, text: string) => design(`<boardgraphic file="graphics/cache.svg" x={${x}} y={0} width={7} />`, { "graphics/cache.svg": text })
    const first = at(0, own)
    const before = reads.count
    const again = at(3, own)
    expect(reads.count).toBe(before)
    expect(again.pcb.graphics?.[0]?.x).toBe(3)
    expect(graphicBox(again.pcb.graphics![0]!).minX).toBeCloseTo(graphicBox(first.pcb.graphics![0]!).minX + 3)
    at(0, JSON.stringify({ ...RING, skipped: ["changed"] }))
    expect(reads.count).toBe(before + 1)
  })
})
