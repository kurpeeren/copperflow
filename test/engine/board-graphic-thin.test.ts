// A drawing on copper whose filled shapes have a part thinner than the fabrication's minimum track width: the area is
// shrunk by half the minimum and grown back, and what is lost beyond a sliver is a `drawing-width` warning naming the
// drawing and a point in the lost part. Worked out once per drawing shape, not once per build.
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../../src/engine/design.js"
import { thinPartChecks } from "../../src/engine/checks/drc-drawing-copper.js"

const MAIN = "main.circuit.tsx"
/** Two discs of 1 mm radius, 4 mm apart, joined by a neck 0.05 mm wide. */
const DUMBBELL = `<svg xmlns="http://www.w3.org/2000/svg" width="7mm" height="3mm" viewBox="0 0 7 3"><circle cx="1.5" cy="1.5" r="1" fill="black"/><circle cx="5.5" cy="1.5" r="1" fill="black"/><rect x="2" y="1.475" width="3" height="0.05" fill="black"/></svg>`
const DISC = `<svg xmlns="http://www.w3.org/2000/svg" width="3mm" height="3mm" viewBox="0 0 3 3"><circle cx="1.5" cy="1.5" r="1.5" fill="black"/></svg>`
/** A ring 1 mm wide: a 4 mm disc with a 2 mm hole. */
const RING = `<svg xmlns="http://www.w3.org/2000/svg" width="4mm" height="4mm" viewBox="0 0 4 4"><path d="M0 2 A2 2 0 1 0 4 2 A2 2 0 1 0 0 2 Z M1 2 A1 1 0 1 1 3 2 A1 1 0 1 1 1 2 Z" fill="black" fill-rule="evenodd"/></svg>`
/** A letter T of 0.3 mm strokes, 2 × 2 mm. */
const LETTER = `<svg xmlns="http://www.w3.org/2000/svg" width="2mm" height="2mm" viewBox="0 0 2 2"><rect x="0" y="0" width="2" height="0.3" fill="black"/><rect x="0.85" y="0" width="0.3" height="2" fill="black"/></svg>`
const FILES = { "graphics/dumbbell.svg": DUMBBELL, "graphics/disc.svg": DISC, "graphics/ring.svg": RING, "graphics/letter.svg": LETTER }

const build = (file: string, minimum?: number, at = { x: 2, y: -1 }): Design => {
  const circuit = `export default () => (<board width="20mm" height="12mm"><boardgraphic file="graphics/${file}.svg" layer="top" x={${at.x}} y={${at.y}} scale={1} /></board>)`
  const rules: Record<string, string> = minimum === undefined ? {} : { "rules.yaml": `fabrication:\n  minTrackWidth: ${minimum}\n` }
  return buildDesign({ [MAIN]: circuit, ...FILES, ...rules }, MAIN)
}
const widths = (design: Design) => design.violations.filter((v) => v.code === "drawing-width")

describe("thin parts of filled copper", () => {
  test("a dumbbell warns at its neck, naming the drawing and a point on the neck", () => {
    const found = widths(build("dumbbell"))
    expect(found).toHaveLength(1)
    expect(found[0]?.items).toEqual(["boardgraphic:1"])
    expect(found[0]?.message).toMatch(/^Drawing on copper boardgraphic:1 \(graphics\/dumbbell\.svg\) has a filled part thinner than the fabrication minimum track width of 0\.100 mm near \(/)
    const at = found[0]?.at
    expect(at).toBeDefined()
    expect(Math.abs((at?.x ?? 99) - 2)).toBeLessThan(1.5)
    expect(Math.abs((at?.y ?? 99) + 1)).toBeLessThan(0.1)
  })

  test("a plain disc and a ring do not", () => {
    expect(widths(build("disc"))).toEqual([])
    expect(widths(build("ring"))).toEqual([])
  })

  test("a letter of 0.3 mm strokes passes at a 0.15 mm minimum and warns at 0.5 mm", () => {
    expect(widths(build("letter", 0.15))).toEqual([])
    expect(widths(build("letter", 0.5)).map((v) => v.items)).toEqual([["boardgraphic:1"]])
  })

  test("is worked out once per drawing shape: moving the drawing reuses it and moves the point", () => {
    const first = build("dumbbell", undefined, { x: 2, y: -1 })
    const moved = build("dumbbell", undefined, { x: -3, y: 2 })
    const graphic = (design: Design) => design.pcb.graphics?.[0]
    const a = thinPartChecks([graphic(first)!], 0.1)[0]?.at
    const b = thinPartChecks([graphic(moved)!], 0.1)[0]?.at
    expect(b?.x).toBeCloseTo((a?.x ?? 0) - 5, 6)
    expect(b?.y).toBeCloseTo((a?.y ?? 0) + 3, 6)
    const started = performance.now()
    for (let i = 0; i < 50; i++) thinPartChecks([graphic(moved)!], 0.1)
    expect(performance.now() - started).toBeLessThan(50)
  })
})
