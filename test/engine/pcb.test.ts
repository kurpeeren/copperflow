import { describe, expect, test } from "vitest"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import { generateFootprint, padCount } from "../../src/engine/footprints/index.js"
import type { Circuit, Component, Point } from "../../src/engine/model.js"
import { layoutPcb, type PlacedFootprint } from "../../src/engine/pcb.js"

const MAIN = "main.circuit.tsx"

function circuitOf(root: string): Circuit {
  const source = `export default () => (\n  ${root}\n)\n`
  return elaborate(evaluateCircuit({ [MAIN]: source }, MAIN), MAIN, { padCount })
}

const build = (body: string, boardProps = 'width="20mm" height="20mm"') => circuitOf(`<board ${boardProps}>\n${body}\n</board>`)
const real = (component: Component) => generateFootprint(component.footprint ?? "")
const layout = (circuit: Circuit) => layoutPcb(circuit, real)

function part(placed: PlacedFootprint[], id: string): PlacedFootprint {
  const found = placed.find((p) => p.component === id)
  if (!found) throw new Error(`no part ${id}`)
  return found
}

function bounds(points: Point[]) {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

type Box = ReturnType<typeof bounds>
const apart = (a: Box, b: Box) => a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY

describe("placement", () => {
  test("placed parts stay put and rotate", () => {
    const flat = layout(build(`<resistor name="R1" footprint="0402" pcbX="0mm" pcbY="0mm" />`))
    const d = Math.abs(part(flat.layout.parts, "R1").pads[0]?.x ?? 0)
    expect(d).toBeGreaterThan(0)
    const turned = layout(build(`<resistor name="R1" footprint="0402" pcbX="2mm" pcbY="1mm" pcbRotation={90} />`))
    const r1 = part(turned.layout.parts, "R1")
    expect(r1).toMatchObject({ x: 2, y: 1, rotation: 90, autoPlaced: false })
    expect(r1.pads[0]?.x).toBeCloseTo(2, 9)
    expect(r1.pads[0]?.y).toBeCloseTo(1 - d, 9)
    expect(r1.pads[0]?.rotation).toBe(90)
  })

  test("bottom parts are mirrored", () => {
    const { layout: l } = layout(build(`<resistor name="R1" footprint="0402" layer="bottom" pcbX="0mm" pcbY="0mm" />`))
    const pad = part(l.parts, "R1").pads[0]
    expect(pad?.x).toBeGreaterThan(0)
    expect(pad?.layers).toBe("bottom")
  })

  test("auto-placed parts do not overlap and stay on the board", () => {
    const body = ["R1", "R2", "R3", "R4", "R5"].map((n) => `<resistor name="${n}" footprint="0603" />`).join("\n")
    const { layout: l, diagnostics } = layout(build(body))
    const boxes = l.parts.map((p) => bounds(p.courtyard))
    for (const [i, a] of boxes.entries()) {
      expect(a.minX).toBeGreaterThanOrEqual(-10)
      expect(a.maxX).toBeLessThanOrEqual(10)
      expect(a.minY).toBeGreaterThanOrEqual(-10)
      expect(a.maxY).toBeLessThanOrEqual(10)
      for (const b of boxes.slice(i + 1)) expect(apart(a, b)).toBe(true)
    }
    expect(l.parts.every((p) => p.autoPlaced)).toBe(true)
    expect(diagnostics.filter((d) => d.code === "auto-placed")).toEqual([])
  })

  test("an auto-placed part avoids a placed one", () => {
    const { layout: l } = layout(build(`<resistor name="R1" footprint="0603" pcbX="0mm" pcbY="0mm" />\n<resistor name="R2" footprint="0603" />`))
    expect(apart(bounds(part(l.parts, "R1").courtyard), bounds(part(l.parts, "R2").courtyard))).toBe(true)
    expect(part(l.parts, "R1").autoPlaced).toBe(false)
  })

  test("placed parts keep their position even when they overlap", () => {
    const body = `<resistor name="R1" footprint="0603" pcbX="0mm" pcbY="0mm" />\n<resistor name="R2" footprint="0603" pcbX="0mm" pcbY="0mm" />`
    const { layout: l } = layout(build(body))
    expect(l.parts.map((p) => [p.x, p.y])).toEqual([[0, 0], [0, 0]])
  })

  test("no board, still placed", () => {
    const circuit = circuitOf(`<group>\n<resistor name="R1" footprint="0603" />\n<resistor name="R2" footprint="0603" />\n</group>`)
    expect(circuit.board).toBeUndefined()
    const { layout: l } = layout(circuit)
    expect(l.board).toBeUndefined()
    expect(l.parts).toHaveLength(2)
    expect(l.parts[0]).toMatchObject({ x: 0, y: 0, autoPlaced: true })
    expect(Math.hypot(l.parts[1]?.x ?? 99, l.parts[1]?.y ?? 99)).toBeLessThan(10)
  })

  test("a part that cannot fit the board is placed outside it and never dropped", () => {
    const { layout: l } = layout(build(`<resistor name="R1" footprint="0603" />`, 'width="1mm" height="1mm"'))
    expect(l.parts).toHaveLength(1)
    expect(l.parts[0]?.autoPlaced).toBe(true)
  })
})

describe("footprints", () => {
  test("an unknown footprint keeps the part", () => {
    const { layout: l, diagnostics } = layout(build(`<resistor name="R1" footprint="bga64" />`))
    const r1 = part(l.parts, "R1")
    expect(r1.pads).toHaveLength(0)
    expect(r1.footprint).toBeUndefined()
    const b = bounds(r1.courtyard)
    expect(b.maxX - b.minX).toBeCloseTo(1, 9)
    expect((b.maxX + b.minX) / 2).toBeCloseTo(r1.x, 9)
    const error = diagnostics.find((d) => d.code === "footprint")
    expect(error).toMatchObject({ severity: "error", items: ["R1"] })
    expect(error?.message).toContain("bga64")
  })

  test("parts without a footprint get one warning in natural order", () => {
    const stubs = (component: Component) => ({ error: `stub ${component.id}` })
    const circuit = circuitOf(`<board width="20mm" height="20mm">\n<resistor name="RX" />\n<resistor name="RX" />\n<resistor name="R9" />\n<led name="LED1" />\n</board>`)
    const { diagnostics } = layoutPcb(circuit, stubs)
    const warnings = diagnostics.filter((d) => d.code === "no-footprint")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.severity).toBe("warning")
    expect(warnings[0]?.items).toEqual(["LED1", "R9", "RX", "RX~2"])
  })

  test("pads know their pins and nets", () => {
    const { layout: l } = layout(build(`<resistor name="R1" footprint="0402" />\n<trace from="R1.pin2" to="net.GND" />`))
    const [pad1, pad2] = part(l.parts, "R1").pads
    expect(pad1).toMatchObject({ id: "R1#1", component: "R1", pin: "R1.pin1" })
    expect(pad1?.net).toBeUndefined()
    expect(pad2).toMatchObject({ id: "R1#2", pin: "R1.pin2", net: "net.GND" })
  })

  test("pads that share a number get numbered ids in footprint order", () => {
    const stub = (component: Component) => {
      const fp = generateFootprint("0402")
      if ("error" in fp) return fp
      const [first] = fp.pads
      return first ? { ...fp, pads: [first, { ...first, x: first.x + 1 }, { ...first, x: first.x + 2 }] } : fp
    }
    const { layout: l } = layoutPcb(build(`<resistor name="J1" footprint="0402" />`), stub)
    expect(part(l.parts, "J1").pads.map((p) => p.id)).toEqual(["J1#1", "J1#1#2", "J1#1#3"])
  })

  test("a bottom part reverses a pad rotation", () => {
    const stub = (component: Component) => {
      const fp = generateFootprint("0402")
      return "error" in fp ? fp : { ...fp, pads: fp.pads.map((p) => ({ ...p, rotation: 30 })) }
    }
    const { layout: l } = layoutPcb(build(`<resistor name="R1" footprint="0402" layer="bottom" pcbRotation={10} pcbX="0mm" pcbY="0mm" />`), stub)
    expect(part(l.parts, "R1").pads[0]?.rotation).toBe(320)
  })

  test("layout carries the ratsnest", () => {
    const body = `<resistor name="R1" footprint="0402" pcbX="0mm" pcbY="0mm" />\n<resistor name="R2" footprint="0402" pcbX="5mm" pcbY="0mm" />\n<trace from="R1.pin2" to="R2.pin1" />`
    const { layout: l } = layout(build(body))
    expect(l.ratsnest).toHaveLength(1)
    expect(l.ratsnest[0]).toMatchObject({ from: "R1#2", to: "R2#1" })
  })
})
