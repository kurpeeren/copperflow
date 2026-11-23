// A pour on a net that carries current: its narrowest neck between the pads it joins, and a relief pour's spokes, against
// the IPC-2221 width that current needs; short of it is a `pour-current` warning.
import { describe, expect, test } from "vitest"
import { UNDER_READ } from "../../src/engine/checks/neck.js"
import { widthForCurrent } from "../../src/engine/checks/track-current.js"
import { buildDesign } from "../../src/engine/design.js"

const MAIN = "main.circuit.tsx"
const RULES = `netClasses:\n  power:\n    current: 3\n    nets: [OUT]\n`
const NEED = widthForCurrent(3, 0.035, "outer")

/** Two 8 mm squares round R1 and R2, joined by a bar `bar` mm wide. */
function outline(bar: number): string {
  const h = bar / 2
  const points = [
    [-16, -4], [-8, -4], [-8, -h], [8, -h], [8, -4], [16, -4],
    [16, 4], [8, 4], [8, h], [-8, h], [-8, 4], [-16, 4],
  ]
  return `[${points.map(([x, y]) => `{ x: ${x}, y: ${y} }`).join(", ")}]`
}

function design(bar: number | string, pour = `thermal="solid"`, extra: Record<string, string> = {}) {
  const body = [
    `<resistor name="R1" resistance="1k" footprint="0603" pcbX={-12} pcbY={0} />`,
    `<resistor name="R2" resistance="1k" footprint="0603" pcbX={12} pcbY={0} />`,
    `<trace from="R1.pin1" to="net.OUT" />`,
    `<trace from="R2.pin1" to="net.OUT" />`,
    `<trace from="R1.pin2" to="R2.pin2" />`,
    `<copperpour net="OUT" layer="top" outline={${typeof bar === "number" ? outline(bar) : bar}} ${pour} />`,
  ].join("\n")
  return buildDesign({ [MAIN]: `export default () => (<board width="40mm" height="20mm">${body}</board>)`, "rules.yaml": RULES, ...extra }, MAIN)
}

const pourWarnings = (built: ReturnType<typeof design>) => built.violations.filter((v) => v.code === "pour-current")

describe("the pour-current check", () => {
  test("warns when the pour narrows below the width its net's current needs, saying where and between what", () => {
    const built = design(0.8)
    expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    const found = pourWarnings(built)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: "warning", items: ["copperpour:1"], view: "pcb" })
    expect(found[0]?.message).toContain(`OUT carries 3 A (net class power): for a 10 °C rise in 0.035 mm copper it needs ${NEED.toFixed(2)} mm of copper on an outer layer`)
    expect(found[0]?.message).toMatch(/copperpour:1 narrows to between [\d.]+ and [\d.]+ mm near \(-?[\d.]+, -?[\d.]+\) on its way between R1#1 and R2#1/)
    expect(found[0]?.message).toContain("widen the pour where it narrows")
    const [, low, high] = (/narrows to between ([\d.]+) and ([\d.]+) mm/.exec(found[0]?.message ?? "") ?? []).map(Number)
    const cell = Number(/on a ([\d.]+) mm grid/.exec(found[0]?.message ?? "")?.[1])
    expect(found[0]?.message).toContain(`The neck is read from ${(NEED / 2).toFixed(3).replace(/0+$/, "")} mm out from each pad, track and via`)
    expect(found[0]?.message).toContain("which never reads it wider than the copper")
    expect(low).toBeLessThanOrEqual(0.8)
    expect(high).toBeGreaterThanOrEqual(0.8)
    expect(high).toBeCloseTo((low ?? 0) + UNDER_READ * cell, 2)
    expect(Math.abs(found[0]?.at?.x ?? 99)).toBeLessThan(8.5)
  })

  test("a hairline neck at a high current still warns, though the grid is coarse", () => {
    const rules = `netClasses:
  power:
    current: 10
    nets: [OUT]
`
    const found = pourWarnings(design(0.16, `thermal="solid" minWidth={0.1}`, { "rules.yaml": rules }))
    expect(found).toHaveLength(1)
    expect(found[0]?.message).toMatch(/copperpour:1 narrows to (under [\d.]+ mm, too thin for the grid to place,|between [\d.]+ and [\d.]+ mm near .*) on its way between R1#1 and R2#1/)
  })

  test("is quiet when the pour is wide enough all the way", () => {
    expect(pourWarnings(design(2))).toEqual([])
  })

  test("a pad at the pour's edge is no neck: the copper is measured from half the needed width out", () => {
    // R1's pad 1 sits 0.25 mm from the pour's left edge.
    const edge = `[{ x: -13.4, y: -6 }, { x: 16, y: -6 }, { x: 16, y: 6 }, { x: -13.4, y: 6 }]`
    expect(pourWarnings(design(edge))).toEqual([])
  })

  test("a pour whose minWidth is the needed width or more is not measured for a neck: its fill drops thinner copper", () => {
    // A 1.5 mm bar is wide enough for 1.37 mm, but the grid may read it a little narrower; minWidth 1.4 vouches for it.
    expect(pourWarnings(design(1.5, `thermal="solid" minWidth={1.4}`))).toEqual([])
  })

  test("is quiet for a net that carries no stated current", () => {
    expect(pourWarnings(design(0.8, `thermal="solid"`, { "rules.yaml": "" }))).toEqual([])
  })

  test("a wide track of the net across the neck carries the current past it", () => {
    const track = `{"t":"track","id":"t0001","net":"net.OUT","layer":"top","width":2,"points":[{"x":-9,"y":0},{"x":9,"y":0}],"locked":false,"by":"human"}\n`
    const built = design(0.8, `thermal="solid"`, { "main.circuit.layout.json": track })
    expect(built.violations.filter((v) => v.code === "track-current")).toEqual([])
    expect(pourWarnings(built)).toEqual([])
  })

  test("a relief pour whose spokes together are too thin warns, and names a thermalWidth that would do", () => {
    const found = pourWarnings(design(4, `thermal="relief"`))
    expect(found).toHaveLength(1)
    const message = found[0]?.message ?? ""
    expect(message).toMatch(/copperpour:1 joins R1#1 and R2#1 through as few as \d thermal spokes 0.3 mm wide/)
    expect(message).not.toContain("narrows to")
    expect(message).toMatch(/give it thermal "solid", or a thermalWidth of [\d.]+ mm/)
    const fewest = Number(/as few as (\d)/.exec(message)?.[1])
    const width = Number(/thermalWidth of ([\d.]+) mm/.exec(message)?.[1])
    expect(fewest * width).toBeGreaterThanOrEqual(NEED)
    expect(pourWarnings(design(4, `thermal="relief" thermalWidth={${width}}`))).toEqual([])
  })

  test("a pour on an inner layer needs the inner width", () => {
    const rules = `fabrication:\n  profile: jlcpcb-4layer\nnetClasses:\n  power:\n    current: 3\n    nets: [OUT]\n`
    const body = [
      `<resistor name="R1" resistance="1k" footprint="0603" pcbX={-12} pcbY={0} />`,
      `<resistor name="R2" resistance="1k" footprint="0603" pcbX={12} pcbY={0} />`,
      `<trace from="R1.pin1" to="net.OUT" />`,
      `<trace from="R2.pin1" to="net.OUT" />`,
      `<copperpour net="OUT" layer="inner1" outline={${outline(2)}} />`,
    ].join("\n")
    const vias = [-12.8, 11.2].map((x, i) => `{"t":"via","id":"v000${i + 1}","net":"net.OUT","at":{"x":${x},"y":2},"diameter":0.6,"drill":0.3,"layers":["top","bottom"],"locked":false,"by":"human"}`)
    const built = buildDesign({ [MAIN]: `export default () => (<board width="40mm" height="20mm" layers={4}>${body}</board>)`, "rules.yaml": rules, "main.circuit.layout.json": `${vias.join("\n")}\n` }, MAIN)
    const found = pourWarnings(built)
    expect(found).toHaveLength(1)
    expect(found[0]?.message).toContain(`${widthForCurrent(3, 0.035, "inner").toFixed(2)} mm of copper on an inner layer`)
    expect(found[0]?.message).toContain("between v0001 and v0002")
  })
})
