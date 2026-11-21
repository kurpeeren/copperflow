import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../../src/engine/design.js"
import type { PlacedFootprint } from "../../src/engine/pcb.js"
import { boxOfPoints, inArea, segmentEntersBox, tooClose, turn, type Box } from "../../src/engine/pcb-place/geometry.js"
import { placeBoard, type Placement } from "../../src/engine/pcb-place/index.js"
import { withPositions } from "../helpers/place-fixtures.js"

const MAIN = "main.circuit.tsx"
const CLEARANCE = 0.25

const board = (size: string, body: string) => `export default () => (\n  <board ${size}>\n${body}\n  </board>\n)\n`
const build = (files: Record<string, string>): Design => buildDesign(files, MAIN)
const partOf = (design: Design, name: string): PlacedFootprint => {
  const part = design.pcb.parts.find((p) => p.component === name)
  if (!part) throw new Error(`no part ${name}`)
  return part
}

/** Each placed part's courtyard bounds where `positions` puts it, from its footprint. */
function placedBoxes(design: Design, placement: Placement): { name: string; box: Box }[] {
  return [...placement.positions].map(([name, at]) => {
    const footprint = partOf(design, name).footprint
    if (!footprint) throw new Error(`${name} has no footprint`)
    const quarter = Math.round(at.rotation / 90)
    const box = boxOfPoints(footprint.courtyard.map((p) => turn(p, quarter)).map((p) => ({ x: p.x + at.x, y: p.y + at.y })))
    return { name, box }
  })
}

const SIXTEEN = Array.from({ length: 16 }, (_, i) => i + 1)
const chain = [
  ...SIXTEEN.map((n) => `<resistor name="R${n}" resistance="1k" footprint="0805" />`),
  ...SIXTEEN.slice(1).map((n) => `<trace from="R${n - 1}.pin2" to="R${n}.pin1" />`),
].join("\n")

describe("a board too small for its parts", () => {
  for (const size of [8, 9, 10]) {
    test(`16 x 0805 on a ${size} mm board: the placed courtyards never overlap, the rest are unplaced with a reason`, () => {
      const files = { [MAIN]: board(`width="${size}mm" height="${size}mm"`, chain) }
      const design = build(files)
      const placement = placeBoard(design)
      expect(placement.unplaced.length).toBeGreaterThan(0)
      expect(placement.positions.size + placement.unplaced.length).toBe(16)
      for (const { name, reason } of placement.unplaced) {
        expect(placement.positions.has(name)).toBe(false)
        expect(placement.moved).not.toContain(name)
        expect(reason).toMatch(/^no free spot for its \d+\.\d x \d+\.\d mm courtyard with 0.25 mm around it: the \d+\.\d x \d+\.\d mm area/)
      }
      const boxes = placedBoxes(design, placement)
      for (const [i, a] of boxes.entries()) {
        for (const b of boxes.slice(i + 1)) expect(tooClose(a.box, b.box, CLEARANCE), `${a.name} and ${b.name}`).toBe(false)
      }
      // Written and rebuilt, the build packs the unplaced parts round the placed ones without overlap.
      const after = build({ [MAIN]: withPositions(files[MAIN], placement.positions) })
      expect(after.violations.filter((v) => v.code === "courtyard-overlap")).toEqual([])
    })
  }

  test("a single part larger than the free area comes back unplaced, quickly, and out of positions", () => {
    const files = { [MAIN]: board('width="8mm" height="8mm"', `<chip name="U1" footprint="lqfp64" />\n<resistor name="R1" resistance="1k" footprint="0402" />`) }
    const started = performance.now()
    const placement = placeBoard(build(files))
    expect(performance.now() - started).toBeLessThan(2000)
    expect(placement.unplaced.map((u) => u.name)).toEqual(["U1"])
    expect(placement.unplaced[0]?.reason).toMatch(/^no free spot for its 13\.4 x 13\.4 mm courtyard with 0.25 mm around it: the 7\.6 x 7\.6 mm area/)
    expect([...placement.positions.keys()]).toEqual(["R1"])
    expect(placement.moved).not.toContain("U1")
  })
})

const BLOCK = `export default function Block() {
  return (
    <sheet>
      <resistor name="R1" resistance="1k" footprint="0603" />
      <resistor name="R2" resistance="1k" footprint="0603" />
      <trace from="R1.pin2" to="R2.pin1" />
    </sheet>
  )
}
`

describe("the instance scope", () => {
  const files = {
    [MAIN]: `import Block from "./Block.sheet"\n${board(
      'width="40mm" height="30mm"',
      [
        `<Block name="PS1" pcbX={10} pcbY={5} />`,
        `<Block name="PS2" pcbX={-10} pcbY={-5} />`,
        `<resistor name="R9" resistance="1k" footprint="0603" />`,
      ].join("\n"),
    )}`,
    "Block.sheet.tsx": BLOCK,
  }
  const design = build(files)

  test("moves only that instance's parts, in board coordinates round the instance's own place", () => {
    const ps1 = design.circuit.components.filter((c) => c.instance === "PS1").map((c) => c.id)
    expect(ps1).toHaveLength(2)
    const placement = placeBoard(design, { scope: { kind: "instance", instance: "PS1" } })
    expect([...placement.positions.keys()]).toEqual(ps1)
    for (const at of placement.positions.values()) expect(Math.hypot(at.x - 10, at.y - 5)).toBeLessThan(3)
    const other = placeBoard(design, { scope: { kind: "instance", instance: "PS2" } })
    for (const at of other.positions.values()) expect(Math.hypot(at.x + 10, at.y + 5)).toBeLessThan(3)
  })
})

/** A connector with its two pads at the back of a deep courtyard (the plug side forward), as many sockets are. */
const SOCKET_FOOTPRINT = [
  "pads:",
  "  - { number: '1', shape: rect, x: -1.25, y: -2, width: 1, height: 1.5 }",
  "  - { number: '2', shape: rect, x: 1.25, y: -2, width: 1, height: 1.5 }",
  "courtyard: [[-3, -3], [3, -3], [3, 4], [-3, 4]]",
  "",
].join("\n")

describe("connectors", () => {
  const socket = `<connector name="J1" footprint="parts/sock/footprint.yaml" pinLabels={{ pin1: "A", pin2: "B" }} />`
  const chip = `<chip name="U1" footprint="soic8" pcbX={10} pcbY={0} pinLabels={{ pin1: "A", pin2: "B" }} />`
  const traces = `<trace from="J1.pin1" to="U1.pin1" />\n<trace from="J1.pin2" to="U1.pin2" />`

  test("an asymmetric connector faces its pins inward from the edge", () => {
    const files = { [MAIN]: board('width="40mm" height="30mm"', [socket, chip, traces].join("\n")), "parts/sock/footprint.yaml": SOCKET_FOOTPRINT }
    const placement = placeBoard(build(files))
    expect(placement.notes).toEqual([])
    const after = build({ ...files, [MAIN]: withPositions(files[MAIN], placement.positions) })
    const j1 = partOf(after, "J1")
    const box = boxOfPoints(j1.courtyard)
    expect(box.maxX).toBeCloseTo(20 - after.rules.fabrication.boardEdgeClearance, 6)
    // The pads sit on the board side of the courtyard, 2.5 mm in from its middle; the plug side is at the edge.
    for (const pad of j1.pads) expect(pad.x).toBeCloseTo((box.minX + box.maxX) / 2 - 2.5, 6)
  })

  test("with no edge free, the connector goes inside the board and a note says so", () => {
    const frame = [
      `<keepout pcbX={0} pcbY={13.5} width={40} height={3} />`,
      `<keepout pcbX={0} pcbY={-13.5} width={40} height={3} />`,
      `<keepout pcbX={18.5} pcbY={0} width={3} height={30} />`,
      `<keepout pcbX={-18.5} pcbY={0} width={3} height={30} />`,
    ]
    const files = { [MAIN]: board('width="40mm" height="30mm"', [socket, chip, traces, ...frame].join("\n")), "parts/sock/footprint.yaml": SOCKET_FOOTPRINT }
    const placement = placeBoard(build(files))
    expect(placement.notes).toEqual(["J1 is a connector, but no board edge has room for it, so it is placed inside the board"])
    expect(placement.positions.has("J1")).toBe(true)
    expect(placement.score.edgeTouches).toBe(0)
  })
})

describe("a chosen edge (pcbEdge)", () => {
  const chip = `<chip name="U1" footprint="soic8" pcbX={10} pcbY={0} pinLabels={{ pin1: "A", pin2: "B" }} />`
  const header = (edge: string) => `<pinheader name="J1" pinCount={2} pitch="2.54mm" footprint="pinrow2" pcbEdge="${edge}" />`
  const traces = `<trace from="J1.pin1" to="U1.pin1" />\n<trace from="J1.pin2" to="U1.pin2" />`
  /** J1's courtyard bounds on the placed 40 x 30 mm board, and the edge clearance. */
  function placedJ1(body: string): { box: Box; edge: number; placement: Placement } {
    const files = { [MAIN]: board('width="40mm" height="30mm"', body) }
    const placement = placeBoard(build(files))
    const after = build({ ...files, [MAIN]: withPositions(files[MAIN], placement.positions) })
    return { box: boxOfPoints(partOf(after, "J1").courtyard), edge: after.rules.fabrication.boardEdgeClearance, placement }
  }

  test("a connector goes against the edge it names, not the one nearest its chip", () => {
    const left = placedJ1([chip, header("left"), traces].join("\n"))
    expect(left.placement.notes).toEqual([])
    expect(left.box.minX).toBeCloseTo(-20 + left.edge, 6)
    const top = placedJ1([chip, header("top"), traces].join("\n"))
    expect(top.box.maxY).toBeCloseTo(15 - top.edge, 6)
    const bottom = placedJ1([chip, header("bottom"), traces].join("\n"))
    expect(bottom.box.minY).toBeCloseTo(-15 + bottom.edge, 6)
  })

  test("its pin row runs along the chosen edge", () => {
    const { box } = placedJ1([chip, header("left"), traces].join("\n"))
    expect(box.maxY - box.minY).toBeGreaterThan(box.maxX - box.minX)
  })

  test("any part that names an edge goes against it, a connector or not", () => {
    const led = `<led name="J1" color="red" footprint="0805" pcbEdge="bottom" />`
    const { box, edge } = placedJ1([chip, led, `<trace from="J1.anode" to="U1.pin1" />`].join("\n"))
    expect(box.minY).toBeCloseTo(-15 + edge, 6)
  })

  test("with no room on the chosen edge it goes on another, and a note says so", () => {
    const wall = `<keepout pcbX={-18.5} pcbY={0} width={3} height={30} />`
    const { box, edge, placement } = placedJ1([chip, header("left"), traces, wall].join("\n"))
    expect(placement.notes).toEqual(["J1 asks for the left edge (pcbEdge), but it has no room there; it went on the right edge"])
    expect(box.maxX).toBeCloseTo(20 - edge, 6)
  })

  test("a value that is not an edge is a warning and the part is placed as before", () => {
    const files = { [MAIN]: board('width="40mm" height="30mm"', [chip, header("front"), traces].join("\n")) }
    const design = build(files)
    expect(design.diagnostics.map((d) => d.message)).toContain("J1: pcbEdge must be left, right, top or bottom")
    expect(placeBoard(design).positions.has("J1")).toBe(true)
  })
})

describe("the outline test", () => {
  test("a narrow notch whose corners all lie outside a box still keeps it out", () => {
    // A 20 mm square with a 0.4 mm slot cut from the top down to y = 2, through the middle.
    const outline = [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 10, y: 10 },
      { x: 0.2, y: 10 },
      { x: 0.2, y: 2 },
      { x: -0.2, y: 2 },
      { x: -0.2, y: 10 },
      { x: -10, y: 10 },
    ]
    const area = { box: { minX: -9.8, minY: -9.8, maxX: 9.8, maxY: 9.8 }, polygon: outline, edge: 0.2 }
    // Corners at x = -2 and 2, y from 3 to 5: all inside the outline, but the slot runs through the box.
    expect(inArea({ minX: -1.8, minY: 3.2, maxX: 1.8, maxY: 4.8 }, area)).toBe(false)
    expect(inArea({ minX: 1, minY: 3.2, maxX: 4, maxY: 4.8 }, area)).toBe(true)
    expect(segmentEntersBox({ x: 0, y: -5 }, { x: 0, y: 5 }, { minX: -1, minY: -1, maxX: 1, maxY: 1 })).toBe(true)
    expect(segmentEntersBox({ x: 1, y: -5 }, { x: 1, y: 5 }, { minX: -1, minY: -1, maxX: 1, maxY: 1 })).toBe(false)
  })
})
