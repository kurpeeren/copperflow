import { describe, expect, test } from "vitest"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import type { Circuit } from "../../src/engine/model.js"
import { layoutSchematic, layoutSchematicWithDiagnostics, type PlacedSymbol } from "../../src/engine/schematic.js"
import { sheetBounds } from "../../src/engine/schematic-geometry.js"
import { columnsFor, gridOf, stackOf, type Cell } from "../../src/engine/schematic-place-grid.js"

const MAIN = "main.circuit.tsx"
const CLEARANCE = 0.2
const EPSILON = 1e-9

function build(body: string): Circuit {
  const source = `export default () => (\n  <board width="80mm" height="60mm">\n${body}\n  </board>\n)\n`
  return elaborate(evaluateCircuit({ [MAIN]: source }, MAIN), MAIN, { padCount: () => undefined })
}

const traces = (pairs: [string, string][]): string => pairs.map(([from, to]) => `<trace from="${from}" to="${to}" />`).join("\n")

/** A part drawn as a box whose pins all take the given attribute, named pin1..pinN. */
function boxPart(name: string, count: number, attribute = "isPassive", extra = ""): string {
  const pins = Array.from({ length: count }, (_, i) => `pin${i + 1}`)
  const labels = pins.map((pin) => `${pin}: "${pin.toUpperCase()}"`).join(", ")
  const attributes = pins.map((pin) => `${pin}: { ${attribute}: true }`).join(", ")
  return `<chip name="${name}" pinLabels={{ ${labels} }} pinAttributes={{ ${attributes} }}${extra} />`
}

const boxOf = (placed: PlacedSymbol) => sheetBounds(placed.symbol.bounds, placed)

function symbolOf(symbols: readonly PlacedSymbol[], name: string): PlacedSymbol {
  const found = symbols.find((s) => s.component === name)
  if (!found) throw new Error(`no symbol ${name}`)
  return found
}

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

function extent(symbols: readonly PlacedSymbol[]): { width: number; height: number } {
  const boxes = symbols.map(boxOf)
  const width = Math.max(...boxes.map((b) => b.maxX)) - Math.min(...boxes.map((b) => b.minX))
  const height = Math.max(...boxes.map((b) => b.maxY)) - Math.min(...boxes.map((b) => b.minY))
  return { width, height }
}

const RELAYS = ["K1", "K2", "K3", "K4", "K5", "K6"]

/**
 * A relay board as a terminal block and six relays drawn as passive boxes: J1 drives each coil, J2 takes each
 * contact, each relay has a flyback diode across its coil, and C1 sits across the supply on J1.
 */
function relayBoard(order: readonly string[] = RELAYS): string {
  const relays = order.map((name) => boxPart(name, 8))
  const diodes = RELAYS.map((_, i) => `<diode name="D${i + 1}" />`)
  const wires = RELAYS.flatMap((relay, i): [string, string][] => [
    [`J1.pin${i + 1}`, `net.COIL${i + 1}`],
    [`${relay}.pin1`, `net.COIL${i + 1}`],
    [`${relay}.pin2`, "net.GND"],
    [`D${i + 1}.anode`, "net.GND"],
    [`D${i + 1}.cathode`, `net.COIL${i + 1}`],
    [`${relay}.pin3`, `net.OUT${i + 1}`],
    [`J2.pin${i + 1}`, `net.OUT${i + 1}`],
  ])
  return [
    boxPart("J1", 8),
    boxPart("J2", 7),
    ...relays,
    ...diodes,
    `<capacitor name="C1" capacitance="100uF" />`,
    traces([...wires, ["J1.pin7", "net.V24"], ["C1.pin1", "net.V24"], ["C1.pin2", "net.GND"], ["J1.pin8", "net.GND"], ["J2.pin7", "net.GND"]]),
  ].join("\n")
}

describe("grouped placement of a board with many chips", () => {
  test("six relays wrap into rows of three instead of one long strip", () => {
    const { symbols } = layoutSchematic(build(relayBoard()))
    const rows = new Set(RELAYS.map((name) => symbolOf(symbols, name).y))
    expect(rows.size).toBe(2)
    for (const y of rows) expect(RELAYS.filter((name) => symbolOf(symbols, name).y === y)).toHaveLength(3)
    const { width, height } = extent(symbols)
    expect(width / height).toBeLessThan(2.5)
    expect(crowded(symbols)).toEqual([])
  })

  test("the terminal blocks stand at an edge, left of every relay", () => {
    const { symbols } = layoutSchematic(build(relayBoard()))
    const left = Math.min(...RELAYS.map((name) => boxOf(symbolOf(symbols, name)).minX))
    for (const name of ["J1", "J2"]) expect(boxOf(symbolOf(symbols, name)).maxX).toBeLessThan(left)
  })

  test("each coil diode hangs beside its own relay, not at the terminal block", () => {
    const { symbols } = layoutSchematic(build(relayBoard()))
    for (const [i, relay] of RELAYS.entries()) {
      const [diode, coil] = [boxOf(symbolOf(symbols, `D${i + 1}`)), boxOf(symbolOf(symbols, relay))]
      const gapX = Math.max(0, coil.minX - diode.maxX, diode.minX - coil.maxX)
      const gapY = Math.max(0, coil.minY - diode.maxY, diode.minY - coil.maxY)
      expect(Math.hypot(gapX, gapY)).toBeLessThan(1.5)
    }
  })

  test("chips wrapped into rows, each with a decoupling capacitor, a pull-up and a series resistor to the next, get every wire routed", () => {
    const pins = `pinLabels={{ pin1: "VDD", pin2: "GND", pin3: "IN", pin4: "OUT" }} pinAttributes={{ pin1: { requiresPower: true }, pin2: { requiresGround: true }, pin3: { isInput: true }, pin4: { isOutput: true } }}`
    const body = Array.from({ length: 30 }, (_, k) => {
      const i = k + 1
      const parts = [`<chip name="U${i}" ${pins} />`, `<capacitor name="C${i}" capacitance="100nF" />`, `<resistor name="RP${i}" resistance="10k" />`, `<resistor name="RS${i}" resistance="33" />`]
      const next = i < 30 ? `U${i + 1}.IN` : "net.END"
      const wires: [string, string][] = [[`U${i}.VDD`, "net.V3_3"], [`U${i}.GND`, "net.GND"], [`C${i}.pin1`, "net.V3_3"], [`C${i}.pin2`, "net.GND"], [`RP${i}.pin1`, `U${i}.IN`], [`RP${i}.pin2`, "net.V3_3"], [`RS${i}.pin1`, `U${i}.OUT`], [`RS${i}.pin2`, next]]
      return [...parts, traces(wires)].join("\n")
    })
    const { layout, diagnostics } = layoutSchematicWithDiagnostics(build(body.join("\n")))
    expect(new Set(layout.symbols.filter((s) => s.component.startsWith("U")).map((s) => s.y)).size).toBeGreaterThan(1)
    expect(diagnostics).toEqual([])
  })

  test("the order the parts are written in does not change the page", () => {
    const placed = (circuit: Circuit) => layoutSchematic(circuit).symbols.map((s) => [s.component, s.x, s.y, s.rotation]).sort()
    expect(placed(build(relayBoard([...RELAYS].reverse())))).toEqual(placed(build(relayBoard())))
  })

  test("the same board is placed the same way twice", () => {
    expect(layoutSchematic(build(relayBoard()))).toEqual(layoutSchematic(build(relayBoard())))
  })

  test("a relay with a position keeps it, and the others keep clear of it", () => {
    const body = relayBoard().replace(`<chip name="K4"`, `<chip name="K4" schX={-20} schY={5}`)
    const { symbols } = layoutSchematic(build(body))
    expect(symbolOf(symbols, "K4")).toMatchObject({ x: -20, y: 5, autoPlaced: false })
    expect(crowded(symbols)).toEqual([])
  })
})

describe("connectors at the edges", () => {
  const amplifier = (connectors: string): Circuit =>
    build(
      [
        connectors,
        `<chip name="U1" pinLabels={{ pin1: "IN", pin2: "OUT", pin3: "GND" }} pinAttributes={{ pin1: { isInput: true }, pin2: { isOutput: true }, pin3: { requiresGround: true } }} />`,
        traces([["J1.pin1", "U1.IN"], ["U1.OUT", "J2.pin1"], ["U1.GND", "net.GND"], ["J1.pin3", "net.GND"], ["J2.pin3", "net.GND"]]),
      ].join("\n"),
    )

  test("the connector that feeds a chip's input goes left, the one its output feeds goes right", () => {
    const { symbols } = layoutSchematic(amplifier([boxPart("J2", 3), boxPart("J1", 3)].join("\n")))
    const [j1, u1, j2] = ["J1", "U1", "J2"].map((name) => boxOf(symbolOf(symbols, name)))
    expect(j1!.maxX).toBeLessThan(u1!.minX)
    expect(j2!.minX).toBeGreaterThan(u1!.maxX)
  })

  test("a connector whose own pins drive goes left even when its name sorts last", () => {
    const circuit = build(
      [
        boxPart("J9", 3, "providesPower"),
        `<chip name="U1" pinLabels={{ pin1: "VIN", pin2: "VOUT", pin3: "GND" }} pinAttributes={{ pin1: { requiresPower: true }, pin2: { providesPower: true }, pin3: { requiresGround: true } }} />`,
        traces([["J9.pin1", "U1.VIN"], ["U1.GND", "net.GND"]]),
      ].join("\n"),
    )
    const { symbols } = layoutSchematic(circuit)
    expect(boxOf(symbolOf(symbols, "J9")).maxX).toBeLessThan(boxOf(symbolOf(symbols, "U1")).minX)
  })

  test("a decoupling capacitor sits beside its chip rather than the connector that drives the same supply", () => {
    const circuit = build(
      [
        boxPart("J1", 3, "providesPower"),
        `<chip name="U1" pinLabels={{ pin1: "VDD", pin2: "IO", pin3: "GND" }} pinAttributes={{ pin1: { isPassive: true }, pin2: { isInput: true }, pin3: { requiresGround: true } }} />`,
        `<capacitor name="C1" capacitance="100nF" />`,
        traces([["J1.pin1", "net.V3_3"], ["U1.VDD", "net.V3_3"], ["C1.pin1", "net.V3_3"], ["C1.pin2", "net.GND"], ["U1.GND", "net.GND"]]),
      ].join("\n"),
    )
    const { symbols } = layoutSchematic(circuit)
    const [j1, u1, c1] = ["J1", "U1", "C1"].map((name) => boxOf(symbolOf(symbols, name)))
    const centre = (c1!.minX + c1!.maxX) / 2
    const reach = (box: typeof c1) => Math.max(0, box!.minX - centre, centre - box!.maxX)
    expect(c1!.maxY).toBeLessThan(u1!.minY)
    expect(reach(u1)).toBeLessThan(reach(j1))
  })
})

describe("a box in series with a chip pin", () => {
  test("whose joined pin faces away from the chip stands far enough out for the wire to go round it", () => {
    const circuit = build(
      [
        `<chip name="U1" pinLabels={{ pin1: "A", pin2: "B", pin3: "C", pin4: "GND" }} pinAttributes={{ pin1: { isInput: true }, pin2: { isInput: true }, pin3: { isInput: true }, pin4: { requiresGround: true } }} />`,
        boxPart("JP1", 2),
        traces([["U1.pin2", "JP1.pin2"], ["JP1.pin1", "net.TERM"], ["U1.pin4", "net.GND"]]),
      ].join("\n"),
    )
    const { layout, diagnostics } = layoutSchematicWithDiagnostics(circuit)
    const [u1, jp1] = [boxOf(symbolOf(layout.symbols, "U1")), boxOf(symbolOf(layout.symbols, "JP1"))]
    expect(jp1.maxX).toBeLessThanOrEqual(u1.minX - 1 + EPSILON)
    expect(diagnostics).toEqual([])
  })
})

describe("chips that share nets", () => {
  test("stand next to each other in the row", () => {
    const chips = ["U1", "U2", "U3", "U4"].map((name) => boxPart(name, 3))
    const circuit = build([...chips, traces([["U1.pin1", "U3.pin1"], ["U2.pin1", "U4.pin1"], ["U1.pin2", "U3.pin2"], ["U2.pin2", "U4.pin2"]])].join("\n"))
    const { symbols } = layoutSchematic(circuit)
    const order = ["U1", "U2", "U3", "U4"].sort((a, b) => symbolOf(symbols, a).x - symbolOf(symbols, b).x)
    const at = (name: string) => order.indexOf(name)
    expect(Math.abs(at("U1") - at("U3"))).toBe(1)
    expect(Math.abs(at("U2") - at("U4"))).toBe(1)
  })
})

const cell = (name: string, width: number, height: number, reach = { left: 0, right: 0, up: 0, down: 0 }): Cell => ({
  name,
  bounds: { minX: -width / 2, maxX: width / 2, minY: -height / 2, maxY: height / 2 },
  reach,
})

describe("the grid", () => {
  test("rows stand 1.5 apart, each column clear of the widest cell before it", () => {
    const cells = [cell("A", 2, 2), cell("B", 1, 1), cell("C", 4, 1), cell("D", 1, 3)]
    const { origins } = gridOf(cells, 2, () => 0)
    expect(origins.get("A")).toEqual({ x: 1, y: 0 })
    expect(origins.get("B")!.y).toBe(0)
    expect(origins.get("C")).toEqual({ x: 2, y: -4 })
    expect(origins.get("D")).toEqual({ x: 5.5, y: -4 })
    expect(origins.get("B")!.x).toBe(5.5)
  })

  test("a part between two chips widens their gap", () => {
    const cells = [cell("A", 1, 1), cell("B", 1, 1)]
    const plain = gridOf(cells, 2, () => 0).origins.get("B")!.x
    expect(gridOf(cells, 2, (index) => (index === 0 ? 3 : 0)).origins.get("B")!.x).toBe(plain + 2)
  })

  test("a short row stays one row; a long one wraps evenly towards a landscape page", () => {
    const few = { core: [cell("A", 1, 1), cell("B", 1, 1)], left: [], right: [] }
    expect(columnsFor(few, () => 0)).toBe(2)
    const many = { core: Array.from({ length: 9 }, (_, i) => cell(`U${i}`, 2, 2)), left: [], right: [] }
    expect(columnsFor(many, () => 0)).toBe(3)
    const six = { core: Array.from({ length: 6 }, (_, i) => cell(`U${i}`, 2, 2)), left: [], right: [] }
    expect([2, 3, 6]).toContain(columnsFor(six, () => 0))
  })
})

describe("a column of connectors", () => {
  test("each stands at its wish, one under another when wishes collide, highest first", () => {
    const cells = [cell("J1", 1, 2), cell("J2", 1, 2), cell("J3", 1, 2)]
    const wishes: Record<string, number | undefined> = { J1: 0, J2: 5, J3: undefined }
    const { origins } = stackOf(cells, (name) => wishes[name])
    expect(origins.get("J2")!.y).toBe(5)
    expect(origins.get("J1")!.y).toBe(0)
    expect(origins.get("J3")!.y).toBe(-3)
  })

  test("stays inside the span it is given while it fits", () => {
    const cells = [cell("J1", 1, 2), cell("J2", 1, 2)]
    const { box } = stackOf(cells, () => 10, { top: 4, bottom: -4 })
    expect(box.maxY).toBeLessThanOrEqual(4 + EPSILON)
    expect(box.minY).toBeGreaterThanOrEqual(-4 - EPSILON)
  })
})
