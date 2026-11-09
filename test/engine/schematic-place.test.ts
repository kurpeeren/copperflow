import { beforeAll, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { buildDesign } from "../../src/engine/design.js"
import { elaborate } from "../../src/engine/elaborate.js"
import { ENGINE_FILES } from "../../src/engine/engine.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import type { Circuit } from "../../src/engine/model.js"
import { collectProjectFiles } from "../../src/engine/project-files.js"
import { layoutSchematic, layoutSchematicWithDiagnostics, type PlacedSymbol } from "../../src/engine/schematic.js"
import { sheetBounds } from "../../src/engine/schematic-geometry.js"

const MAIN = "main.circuit.tsx"
const EXAMPLE = fileURLToPath(new URL("../../examples/usb-c-ldo", import.meta.url))
const CLEARANCE = 0.2
const EPSILON = 1e-9

function build(body: string): Circuit {
  const source = `export default () => (\n  <board width="30mm" height="20mm">\n${body}\n  </board>\n)\n`
  return elaborate(evaluateCircuit({ [MAIN]: source }, MAIN), MAIN, { padCount: () => undefined })
}

const chip = (name: string, pins: Record<string, [string, string]>, extra = ""): string => {
  const labels = Object.entries(pins).map(([pin, [label]]) => `${pin}: "${label}"`)
  const attributes = Object.entries(pins).map(([pin, [, attribute]]) => `${pin}: { ${attribute}: true }`)
  return `<chip name="${name}" pinLabels={{ ${labels.join(", ")} }} pinAttributes={{ ${attributes.join(", ")} }}${extra} />`
}

const traces = (pairs: [string, string][]): string => pairs.map(([from, to]) => `<trace from="${from}" to="${to}" />`).join("\n")

/** A USB input, an LDO and an output header, with a capacitor on each side of the regulator. */
const REGULATOR = [
  chip("J1", { pin1: ["VBUS", "providesPower"], pin2: ["GND", "requiresGround"], pin3: ["ID", "isPassive"] }),
  chip("U1", { pin1: ["VIN", "requiresPower"], pin2: ["GND", "requiresGround"], pin3: ["VOUT", "providesPower"] }),
  `<pinheader name="J2" pinCount={2} />`,
  `<capacitor name="C1" capacitance="1uF" />`,
  `<capacitor name="C2" capacitance="1uF" />`,
  traces([
    ["J1.VBUS", "net.VBUS"], ["U1.VIN", "net.VBUS"], ["C1.pin1", "net.VBUS"], ["C1.pin2", "net.GND"],
    ["U1.VOUT", "net.V3_3"], ["C2.pin1", "net.V3_3"], ["C2.pin2", "net.GND"], ["J2.pin1", "net.V3_3"],
    ["J1.GND", "net.GND"], ["U1.GND", "net.GND"], ["J2.pin2", "net.GND"],
  ]),
].join("\n")

const boxOf = (placed: PlacedSymbol) => sheetBounds(placed.symbol.bounds, placed)

function symbolOf(symbols: readonly PlacedSymbol[], name: string): PlacedSymbol {
  const found = symbols.find((s) => s.component === name)
  if (!found) throw new Error(`no symbol ${name}`)
  return found
}

/** Pairs of symbols whose bounds come closer than the clearance. */
function crowded(symbols: readonly PlacedSymbol[]): string[] {
  const boxes = symbols.map((s) => ({ name: s.component, box: boxOf(s) }))
  return boxes.flatMap(({ name, box: a }, i) =>
    boxes.slice(i + 1).flatMap(({ name: other, box: b }) => {
      const apart =
        a.maxX + CLEARANCE <= b.minX + EPSILON || b.maxX + CLEARANCE <= a.minX + EPSILON || a.maxY + CLEARANCE <= b.minY + EPSILON || b.maxY + CLEARANCE <= a.minY + EPSILON
      return apart ? [] : [`${name}/${other}`]
    }),
  )
}

const onGrid = (value: number): boolean => Math.abs(value * 10 - Math.round(value * 10)) < 1e-6

describe("placement by connectivity", () => {
  test("a regulator lands as input, regulator, output, with its capacitors below it", () => {
    const { symbols } = layoutSchematic(build(REGULATOR))
    const [j1, u1, j2, c1, c2] = ["J1", "U1", "J2", "C1", "C2"].map((name) => symbolOf(symbols, name))
    expect(j1!.x).toBeLessThan(u1!.x)
    expect(u1!.x).toBeLessThan(j2!.x)
    const body = boxOf(u1!)
    for (const cap of [c1!, c2!]) expect(boxOf(cap).maxY).toBeLessThanOrEqual(body.minY - 0.3 + EPSILON)
    expect(c1!.x).toBeLessThan(u1!.x)
    expect(c2!.x).toBeGreaterThan(u1!.x)
    expect(symbols.every((s) => s.autoPlaced)).toBe(true)
  })

  test("a capacitor to ground stands upright with its ground pin at the bottom", () => {
    const { symbols } = layoutSchematic(build(REGULATOR))
    const c1 = symbolOf(symbols, "C1")
    expect(c1.pinEnds["C1.pin1"]!.y).toBeGreaterThan(c1.pinEnds["C1.pin2"]!.y)
    expect(c1.pinEnds["C1.pin1"]!.x).toBe(c1.pinEnds["C1.pin2"]!.x)
  })

  test("a pull-up stands above the chip with its power pin on top", () => {
    const circuit = build(
      [
        chip("U1", { pin1: ["IN", "isInput"], pin2: ["OUT", "isOutput"], pin3: ["GND", "requiresGround"] }),
        `<resistor name="R1" resistance="10k" />`,
        traces([["R1.pin1", "U1.IN"], ["R1.pin2", "net.V3_3"], ["U1.GND", "net.GND"]]),
      ].join("\n"),
    )
    const { symbols } = layoutSchematic(circuit)
    const [u1, r1] = [symbolOf(symbols, "U1"), symbolOf(symbols, "R1")]
    expect(boxOf(r1).minY).toBeGreaterThanOrEqual(boxOf(u1).maxY + 0.3 - EPSILON)
    expect(r1.pinEnds["R1.pin2"]!.y).toBeGreaterThan(r1.pinEnds["R1.pin1"]!.y)
  })

  test("a series resistor on an output sits inline to the right of the pin", () => {
    const circuit = build(
      [
        chip("U1", { pin1: ["IN", "isInput"], pin2: ["OUT", "isOutput"], pin3: ["GND", "requiresGround"] }),
        `<resistor name="R1" resistance="33" />`,
        traces([["R1.pin1", "U1.OUT"], ["R1.pin2", "net.TX"], ["U1.GND", "net.GND"]]),
      ].join("\n"),
    )
    const { symbols } = layoutSchematic(circuit)
    const [u1, r1] = [symbolOf(symbols, "U1"), symbolOf(symbols, "R1")]
    expect(r1.rotation).toBe(0)
    expect(r1.pinEnds["R1.pin1"]!.y).toBe(u1.pinEnds["U1.pin2"]!.y)
    expect(boxOf(r1).minX).toBeGreaterThanOrEqual(boxOf(u1).maxX + 0.3 - EPSILON)
  })

  test("signal flows left to right: a driver sits left of the chip it feeds", () => {
    const circuit = build(
      [
        chip("U2", { pin1: ["IN", "isInput"], pin2: ["OUT", "isOutput"], pin3: ["GND", "requiresGround"] }),
        chip("U1", { pin1: ["IN", "isInput"], pin2: ["OUT", "isOutput"], pin3: ["GND", "requiresGround"] }),
        traces([["U2.OUT", "U1.IN"], ["U1.GND", "net.GND"], ["U2.GND", "net.GND"]]),
      ].join("\n"),
    )
    const { symbols } = layoutSchematic(circuit)
    expect(symbolOf(symbols, "U2").x).toBeLessThan(symbolOf(symbols, "U1").x)
  })

  test("a resistor between two chips goes between them", () => {
    const circuit = build(
      [
        chip("U1", { pin1: ["IN", "isInput"], pin2: ["OUT", "isOutput"], pin3: ["GND", "requiresGround"] }),
        chip("U2", { pin1: ["IN", "isInput"], pin2: ["OUT", "isOutput"], pin3: ["GND", "requiresGround"] }),
        `<resistor name="R1" resistance="1k" />`,
        traces([["U1.OUT", "R1.pin1"], ["R1.pin2", "U2.IN"], ["U1.GND", "net.GND"], ["U2.GND", "net.GND"]]),
      ].join("\n"),
    )
    const { symbols } = layoutSchematic(circuit)
    const [u1, u2, r1] = ["U1", "U2", "R1"].map((name) => boxOf(symbolOf(symbols, name)))
    expect(r1!.minX).toBeGreaterThan(u1!.maxX)
    expect(r1!.maxX).toBeLessThan(u2!.minX)
    expect(crowded(symbols)).toEqual([])
  })

  test("several capacitors on one pin stand side by side with gaps", () => {
    const caps = ["C1", "C2", "C3"].map((name) => `<capacitor name="${name}" capacitance="100nF" />`)
    const wires = ["C1", "C2", "C3"].flatMap((name): [string, string][] => [[`${name}.pin1`, "net.V3_3"], [`${name}.pin2`, "net.GND"]])
    const circuit = build(
      [chip("U1", { pin1: ["VDD", "requiresPower"], pin2: ["IO", "isInput"], pin3: ["GND", "requiresGround"] }), ...caps, traces([["U1.VDD", "net.V3_3"], ["U1.GND", "net.GND"], ...wires])].join(
        "\n",
      ),
    )
    const { symbols } = layoutSchematic(circuit)
    const capBoxes = ["C1", "C2", "C3"].map((name) => boxOf(symbolOf(symbols, name)))
    expect(new Set(capBoxes.map((box) => box.maxY)).size).toBe(1)
    expect(crowded(symbols)).toEqual([])
  })

  test("parts no chip claims line up as a chain, joined pins facing each other", () => {
    const circuit = build(
      [`<resistor name="R1" resistance="1k" />`, `<led name="D1" />`, `<resistor name="R2" resistance="1k" />`, traces([["R1.pin1", "net.V3_3"], ["R1.pin2", "D1.anode"], ["D1.cathode", "R2.pin2"], ["R2.pin1", "net.GND"]])].join("\n"),
    )
    const { symbols } = layoutSchematic(circuit)
    const [r1, d1, r2] = ["R1", "D1", "R2"].map((name) => symbolOf(symbols, name))
    expect(new Set([r1!.y, d1!.y, r2!.y]).size).toBe(1)
    expect(r1!.x).toBeLessThan(d1!.x)
    expect(d1!.x).toBeLessThan(r2!.x)
    expect(r1!.pinEnds["R1.pin2"]!.x).toBeLessThan(d1!.pinEnds["D1.pin1"]!.x)
    expect(d1!.pinEnds["D1.pin2"]!.x).toBeLessThan(r2!.pinEnds["R2.pin2"]!.x)
    expect(r2!.pinEnds["R2.pin2"]!.x).toBeLessThan(r2!.pinEnds["R2.pin1"]!.x)
  })

  test("placed parts do not move and nothing auto-placed crowds them", () => {
    const fixed = `<resistor name="R9" schX={6} schY={0} />\n${chip("U9", { pin1: ["A", "isInput"], pin2: ["B", "isOutput"], pin3: ["C", "isPassive"] }, " schX={-3} schY={-1}")}`
    const { symbols } = layoutSchematic(build(`${REGULATOR}\n${fixed}`))
    expect(symbolOf(symbols, "R9")).toMatchObject({ x: 6, y: 0, rotation: 0, autoPlaced: false })
    expect(symbolOf(symbols, "U9")).toMatchObject({ x: -3, y: -1, rotation: 0, autoPlaced: false })
    expect(crowded(symbols)).toEqual([])
  })

  test("every auto-placed origin is on the 0.1 grid", () => {
    const { symbols } = layoutSchematic(build(REGULATOR))
    expect(symbols.filter((s) => !onGrid(s.x) || !onGrid(s.y)).map((s) => s.component)).toEqual([])
  })

  test("the same circuit is placed the same way twice", () => {
    const circuit = build(REGULATOR)
    expect(layoutSchematic(circuit)).toEqual(layoutSchematic(build(REGULATOR)))
  })
})

describe("the usb-c-ldo example without positions", () => {
  let circuit: Circuit
  /** The same, with every near pin wired: no schMaxTraceDistance, as a netlist written by code has none. */
  let wired: Circuit

  beforeAll(async () => {
    const files = await collectProjectFiles(EXAMPLE, { include: ENGINE_FILES })
    const main = files["index.circuit.tsx"]
    if (main === undefined) throw new Error("no index.circuit.tsx")
    const loose = main.replace(/\s+sch(X|Y|Rotation)=\{[^}]*\}/g, "")
    circuit = buildDesign({ ...files, "index.circuit.tsx": loose }, "index.circuit.tsx").circuit
    wired = buildDesign({ ...files, "index.circuit.tsx": loose.replace(/\s+schMaxTraceDistance=\{[^}]*\}/, "") }, "index.circuit.tsx").circuit
  })

  test("no part keeps a position", () => {
    expect(circuit.components.every((component) => component.sch === undefined)).toBe(true)
  })

  test("no two symbols come closer than the clearance", () => {
    expect(crowded(layoutSchematic(circuit).symbols)).toEqual([])
  })

  test("every wire avoids the symbols", () => {
    expect(layoutSchematicWithDiagnostics(circuit).diagnostics).toEqual([])
  })

  test("with every near pin wired, every wire still avoids the symbols", () => {
    expect(wired.board?.schMaxTraceDistance).toBeUndefined()
    expect(layoutSchematicWithDiagnostics(wired).diagnostics).toEqual([])
  })

  test("the USB connector is left of the regulator, with the regulator's capacitors below it", () => {
    const { symbols } = layoutSchematic(circuit)
    const [j1, u1, c1, c2] = ["J1", "U1", "C1", "C2"].map((name) => symbolOf(symbols, name))
    expect(j1!.x).toBeLessThan(u1!.x)
    for (const cap of [c1!, c2!]) expect(boxOf(cap).maxY).toBeLessThan(boxOf(u1!).minY)
  })
})
