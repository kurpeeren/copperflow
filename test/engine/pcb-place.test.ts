import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../../src/engine/design.js"
import type { Point } from "../../src/engine/model.js"
import type { PlacedFootprint } from "../../src/engine/pcb.js"
import { boxOfPoints, tooClose } from "../../src/engine/pcb-place/geometry.js"
import { placeBoard, type Placement } from "../../src/engine/pcb-place/index.js"
import { construct } from "../../src/engine/pcb-place/constructive.js"
import { lcg, refine } from "../../src/engine/pcb-place/refine.js"
import { readProblem } from "../../src/engine/pcb-place/scope.js"
import type { State } from "../../src/engine/pcb-place/score.js"
import { canUnplaced, CAN_MAIN, withPositions } from "../helpers/place-fixtures.js"

const MAIN = "main.circuit.tsx"
const CLEARANCE = 0.25
const PLACEMENT_FINDINGS = new Set(["courtyard-overlap", "outside-board", "keepout", "unplaced"])

const source = (body: string, size = 'width="30mm" height="30mm"') => `export default () => (\n  <board ${size}>\n${body}\n  </board>\n)\n`
const build = (files: Record<string, string>, main = MAIN): Design => buildDesign(files, main)

/** The design rebuilt with the placement written into the source: what the board looks like once it is kept. */
function rebuilt(files: Record<string, string>, placement: Placement, main = MAIN): Design {
  return build({ ...files, [main]: withPositions(files[main] as string, placement.positions) }, main)
}

const partOf = (design: Design, name: string): PlacedFootprint => {
  const part = design.pcb.parts.find((p) => p.component === name)
  if (!part) throw new Error(`no part ${name}`)
  return part
}
const padOf = (design: Design, pin: string): Point => {
  const pad = design.pcb.parts.flatMap((p) => p.pads).find((p) => p.pin === pin)
  if (!pad) throw new Error(`no pad for ${pin}`)
  return pad
}
const placementFindings = (design: Design) => design.violations.filter((v) => PLACEMENT_FINDINGS.has(v.code)).map((v) => v.message)

/** No two courtyards closer than the clearance, none outside the outline less the edge clearance. */
function expectClearCourtyards(design: Design): void {
  const boxes = design.pcb.parts.map((p) => ({ name: p.component, box: boxOfPoints(p.courtyard) }))
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) expect(tooClose(a.box, b.box, CLEARANCE), `${a.name} and ${b.name}`).toBe(false)
  }
  const board = boxOfPoints(design.pcb.board?.outline ?? [])
  const edge = design.rules.fabrication.boardEdgeClearance
  for (const { name, box } of boxes) {
    expect(box.minX, name).toBeGreaterThanOrEqual(board.minX + edge - 1e-6)
    expect(box.maxX, name).toBeLessThanOrEqual(board.maxX - edge + 1e-6)
    expect(box.minY, name).toBeGreaterThanOrEqual(board.minY + edge - 1e-6)
    expect(box.maxY, name).toBeLessThanOrEqual(board.maxY - edge + 1e-6)
  }
}

/** A 32-pin QFP with a supply pin and a ground pin on each side, four decoupling capacitors and two pull-ups. */
const DECOUPLED = source(
  [
    `<chip name="U1" footprint="lqfp32" pinLabels={{ pin1: "VDD1", pin2: "GND1", pin9: "VDD2", pin10: "GND2", pin17: "VDD3", pin18: "GND3", pin25: "VDD4", pin26: "GND4", pin5: "SDA", pin6: "SCL" }}`,
    `  pinAttributes={{ pin1: { requiresPower: true }, pin9: { requiresPower: true }, pin17: { requiresPower: true }, pin25: { requiresPower: true }, pin2: { requiresGround: true }, pin10: { requiresGround: true }, pin18: { requiresGround: true }, pin26: { requiresGround: true } }} />`,
    ...[1, 2, 3, 4].map((n) => `<capacitor name="C${n}" capacitance="100nF" footprint="0402" />`),
    `<resistor name="R1" resistance="4.7k" footprint="0402" />`,
    `<resistor name="R2" resistance="4.7k" footprint="0402" />`,
    ...[1, 9, 17, 25].map((pin) => `<trace from="U1.pin${pin}" to="net.VDD" />`),
    ...[2, 10, 18, 26].map((pin) => `<trace from="U1.pin${pin}" to="net.GND" />`),
    ...[1, 2, 3, 4].flatMap((n) => [`<trace from="C${n}.pin1" to="net.VDD" />`, `<trace from="C${n}.pin2" to="net.GND" />`]),
    `<trace from="R1.pin1" to="net.VDD" />`,
    `<trace from="R1.pin2" to="U1.SDA" />`,
    `<trace from="R2.pin1" to="net.VDD" />`,
    `<trace from="R2.pin2" to="U1.SCL" />`,
  ].join("\n"),
)

describe("placeBoard on small boards", () => {
  test("a chip with four decoupling capacitors gets each one beside its own supply pin", () => {
    const files = { [MAIN]: DECOUPLED }
    const placement = placeBoard(build(files))
    expect(placement.unplaced).toEqual([])
    const after = rebuilt(files, placement)
    expect(placementFindings(after)).toEqual([])
    expectClearCourtyards(after)
    const supplies = [1, 9, 17, 25].map((pin) => padOf(after, `U1.pin${pin}`))
    const caps = [1, 2, 3, 4].map((n) => partOf(after, `C${n}`))
    // Each capacitor's centre within 3 mm of a supply pad, and each supply pad with its own capacitor.
    const nearest = caps.map((cap) => {
      const distances = supplies.map((pad) => Math.hypot(pad.x - cap.x, pad.y - cap.y))
      const best = Math.min(...distances)
      expect(best, cap.component).toBeLessThan(3)
      return distances.indexOf(best)
    })
    expect(new Set(nearest).size).toBe(4)
  })

  test("a connector goes against the board edge nearest its chip, its pin row along the edge", () => {
    const files = {
      [MAIN]: source(
        [
          `<chip name="U1" footprint="soic8" pcbX={12} pcbY={0} pinLabels={{ pin1: "A", pin2: "B", pin3: "C", pin4: "D" }} />`,
          `<pinheader name="J1" pinCount={4} pitch="2.54mm" />`,
          ...[1, 2, 3, 4].map((n) => `<trace from="J1.pin${n}" to="U1.pin${n}" />`),
        ].join("\n"),
        'width="40mm" height="30mm"',
      ),
    }
    const design = build(files)
    const placement = placeBoard(design)
    expect([...placement.positions.keys()]).toEqual(["J1"])
    const after = rebuilt(files, placement)
    expect(placementFindings(after)).toEqual([])
    const j1 = partOf(after, "J1")
    const edge = design.rules.fabrication.boardEdgeClearance
    // The right edge: the courtyard touches the edge clearance.
    expect(Math.max(...j1.courtyard.map((p) => p.x))).toBeCloseTo(20 - edge, 6)
    const xs = j1.pads.map((p) => p.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-6)
    expect(placement.score.edgeTouches).toBe(1)
  })

  test("locked and hand-placed parts stay, and nothing comes near a keepout or a hole", () => {
    const files = {
      [MAIN]: source(
        [
          `<chip name="U1" footprint="soic8" pcbX={0} pcbY={0} />`,
          `<keepout pcbX={-7} pcbY={0} width={4} height={10} />`,
          `<hole x={5} y={0} diameter={3} />`,
          ...[1, 2, 3, 4, 5, 6].map((n) => `<resistor name="R${n}" resistance="1k" footprint="0603" />`),
          ...[1, 2, 3, 4, 5, 6].map((n) => `<trace from="R${n}.pin1" to="U1.pin${n}" />`),
          `<trace from="R1.pin2" to="R2.pin2" />`,
        ].join("\n"),
        'width="24mm" height="16mm"',
      ),
    }
    const design = build(files)
    const r6 = boxOfPoints(partOf(design, "R6").courtyard)
    const placement = placeBoard(design, { locked: ["R6"] })
    expect([...placement.positions.keys()]).toEqual(["R1", "R2", "R3", "R4", "R5"])
    const after = rebuilt(files, placement)
    expect(partOf(after, "U1")).toMatchObject({ x: 0, y: 0, rotation: 0 })
    // R6 is locked but never placed by hand, so the build still packs it: the only placement finding.
    expect(placementFindings(after)).toEqual(["These parts have no position and were placed automatically"])
    const keepout = boxOfPoints(after.pcb.board?.keepouts[0]?.outline ?? [])
    const hole = { minX: 3.5, minY: -1.5, maxX: 6.5, maxY: 1.5 }
    for (const name of placement.positions.keys()) {
      const box = boxOfPoints(partOf(after, name).courtyard)
      expect(tooClose(box, keepout, CLEARANCE), name).toBe(false)
      expect(tooClose(box, hole, CLEARANCE), name).toBe(false)
      expect(tooClose(box, r6, CLEARANCE), name).toBe(false)
      expect(tooClose(box, boxOfPoints(partOf(after, "U1").courtyard), CLEARANCE), name).toBe(false)
    }
  })

  test("the parts scope moves only the named parts, the instance scope only that instance's parts", () => {
    const files = { [MAIN]: DECOUPLED }
    const design = build(files)
    expect([...placeBoard(design, { scope: { kind: "parts", parts: ["R2", "C1"] } }).positions.keys()]).toEqual(["C1", "R2"])
    expect(placeBoard(design, { scope: { kind: "instance", instance: "PS1" } }).positions.size).toBe(0)
  })

  test("a part with no room left keeps the build's spot and is reported", () => {
    const files = { [MAIN]: source(`<chip name="U1" footprint="lqfp64" />\n<resistor name="R1" resistance="1k" footprint="0402" />`, 'width="8mm" height="8mm"') }
    const placement = placeBoard(build(files))
    expect(placement.unplaced).toEqual(["U1"])
    expect(placement.moved).not.toContain("U1")
  })
})

describe("placeBoard on the CAN module", () => {
  const files = canUnplaced()
  const design = build(files, CAN_MAIN)
  const placement = placeBoard(design)

  test("measures the build's packing as the ratsnest does, and places with less wire", () => {
    const ratsnest = design.pcb.ratsnest.reduce((sum, l) => sum + Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y), 0)
    expect(placement.before.wireLength).toBeCloseTo(ratsnest, 6)
    expect(placement.score.wireLength).toBeLessThan(placement.before.wireLength)
    expect(placement.moved).toHaveLength(12)
    expect(placement.unplaced).toEqual([])
  })

  test("the placed board has no courtyard overlaps and nothing off the board, and its ratsnest is the score", () => {
    const after = rebuilt(files, placement, CAN_MAIN)
    expect(placementFindings(after)).toEqual([])
    expectClearCourtyards(after)
    const ratsnest = after.pcb.ratsnest.reduce((sum, l) => sum + Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y), 0)
    expect(ratsnest).toBeCloseTo(placement.score.wireLength, 3)
  })

  test("the connectors lie against the edge clearance", () => {
    const after = rebuilt(files, placement, CAN_MAIN)
    const area = boxOfPoints(after.pcb.board?.outline ?? [])
    const edge = after.rules.fabrication.boardEdgeClearance
    for (const name of ["J1", "J2", "J3"]) {
      const box = boxOfPoints(partOf(after, name).courtyard)
      const gaps = [box.minX - area.minX, area.maxX - box.maxX, box.minY - area.minY, area.maxY - box.maxY]
      expect(Math.min(...gaps), name).toBeCloseTo(edge, 6)
    }
  })

  test("the same design places the same way twice", () => {
    const again = placeBoard(build(canUnplaced(), CAN_MAIN))
    expect([...again.positions]).toEqual([...placement.positions])
    expect(again.score).toEqual(placement.score)
  })

  test("the refinement never lengthens the wiring: each best is shorter, and the end is no longer than the start", () => {
    const problem = readProblem(design)
    const n = problem.movables.length
    const state: State = { x: new Float64Array(n), y: new Float64Array(n), rot: new Uint8Array(n) }
    construct(problem, state)
    const refined = refine(problem, state, new Set())
    expect(refined.trace[0]).toBe(refined.before)
    for (let k = 1; k < refined.trace.length; k++) expect(refined.trace[k]).toBeLessThan(refined.trace[k - 1] as number)
    expect(refined.after).toBeLessThanOrEqual(refined.before)
    expect(refined.after).toBeCloseTo(refined.trace.at(-1) as number, 6)
    const constructed = placeBoard(design, { refine: false })
    expect(placement.score.wireLength).toBeLessThanOrEqual(constructed.score.wireLength)
  })

  test("a spent time budget stops the refinement and still gives a valid board", () => {
    let now = 0
    const clock = () => (now += 1000)
    const hurried = placeBoard(design, { budgetMs: 1, clock })
    expect(hurried.budgetSpent).toBe(true)
    expect(placementFindings(rebuilt(files, hurried, CAN_MAIN))).toEqual([])
    expect(placement.budgetSpent).toBe(false)
  })
})

test("the move sequence is a fixed function of its seed", () => {
  const a = lcg(7)
  const b = lcg(7)
  const first = Array.from({ length: 5 }, () => a())
  expect(Array.from({ length: 5 }, () => b())).toEqual(first)
  expect(first.every((v) => v >= 0 && v < 1)).toBe(true)
  expect(lcg(8)()).not.toBe(first[0])
})
