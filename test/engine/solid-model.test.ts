import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { arcPoints } from "../../src/engine/dxf/board.js"
import { boardVolume, loopArea, partVolume, solidModel, type Segment } from "../../src/engine/solid/model.js"

const MAIN = "main.circuit.tsx"
const build = (body: string, board = `width="20mm" height="10mm"`) => buildDesign({ [MAIN]: `export default () => (<board ${board}>${body}</board>)` }, MAIN)
const close = (a: number, b: number, digits = 9) => expect(a).toBeCloseTo(b, digits)

/** The corners a loop of segments passes through, in order. */
const corners = (loop: readonly Segment[]) => loop.map((segment) => segment.from)

describe("the board solid", () => {
  test("a rectangle: four straight edges counter-clockwise, at the board's thickness, with nothing through it", () => {
    const model = solidModel(build(""))
    expect(model.board?.thickness).toBe(1.6)
    expect(model.board?.outline.map((s) => s.kind)).toEqual(["line", "line", "line", "line"])
    expect(loopArea(model.board?.outline ?? [])).toBeCloseTo(200, 9)
    expect(model.board?.holes).toEqual([])
    close(boardVolume(model.board!), 320)
  })

  test("the thickness the board gives is used", () => {
    expect(solidModel(build("", `width="20mm" height="10mm" thickness="1mm"`)).board?.thickness).toBe(1)
  })

  test("an outline given clockwise is turned counter-clockwise", () => {
    const model = solidModel(build("", `outline={[{x:0,y:0},{x:0,y:10},{x:20,y:10},{x:20,y:0}]}`))
    close(loopArea(model.board!.outline), 200)
  })

  test("an outline with rounded corners keeps every edge it holds", () => {
    const arc = arcPoints({ x: 18, y: 8 }, 2, 0, Math.PI / 2)
    const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, ...arc, { x: 0, y: 10 }]
    const text = points.map((p) => `{x:${p.x},y:${p.y}}`).join(",")
    const model = solidModel(build("", `outline={[${text}]}`))
    expect(model.board?.outline).toHaveLength(points.length)
    expect(corners(model.board!.outline)[0]).toEqual({ x: 0, y: 0 })
  })

  test("mounting holes and through-hole drills go through as circles; vias do not", () => {
    const model = solidModel(build(`<hole x={-6} y={0} diameter={3} /><pinheader name="J1" pinCount={2} footprint="pinrow2" pcbX={4} pcbY={0} />`))
    const holes = model.board!.holes
    expect(holes).toHaveLength(3)
    for (const hole of holes) {
      expect(hole.map((s) => s.kind)).toEqual(["arc", "arc"])
      expect(loopArea(hole)).toBeLessThan(0)
    }
    expect(loopArea(holes[0]!)).toBeCloseTo(-Math.PI * 1.5 ** 2, 9)
    close(boardVolume(model.board!), (200 - Math.PI * (1.5 ** 2 + 2 * 0.5 ** 2)) * 1.6)
  })
})

describe("an oval drill", () => {
  test("is a slot: two half circles joined by straight sides, clockwise, of the slot's area", () => {
    const footprint = ["pads:", '  - number: "1"', "    shape: oval", "    x: 0", "    y: 0", "    width: 3", "    height: 2", "    rotation: 90", "    layers: through", "    drill:", "      width: 2", "      height: 1"].join("\n")
    const part = ["export const Slot = (props: { name: string }) => (", '  <chip footprint={"parts/Slot/footprint.yaml"} pinLabels={{ pin1: "A" }} {...props} />', ")", ""].join("\n")
    const main = `import { Slot } from "./parts/Slot/Slot"\nexport default () => (<board width="20mm" height="10mm"><Slot name="J1" pcbX={0} pcbY={0} /></board>)`
    const design = buildDesign({ [MAIN]: main, "parts/Slot/Slot.tsx": part, "parts/Slot/footprint.yaml": footprint }, MAIN)
    const holes = solidModel(design).board!.holes
    expect(holes).toHaveLength(1)
    expect(holes[0]!.map((s) => s.kind)).toEqual(["line", "arc", "line", "arc"])
    close(loopArea(holes[0]!), -(Math.PI * 0.5 ** 2 + 1 * 1))
    // Turned 90 degrees, the slot's long side runs along y.
    const ys = holes[0]!.map((s) => s.from.y)
    close(Math.max(...ys) - Math.min(...ys), 1)
  })
})

describe("the part solids", () => {
  const one = (part: string) => solidModel(build(part)).parts[0]!

  test("a part is a box on its courtyard's bounds, on top of the board, as tall as its package", () => {
    const r1 = one(`<resistor name="R1" resistance="1k" footprint="0603" pcbX={2} pcbY={1} />`)
    expect(r1).toMatchObject({ name: "R1", side: "top", height: 0.9, assumed: false })
    close(r1.bottom, 1.6)
    close(r1.top, 2.5)
    const xs = r1.corners.map((c) => c.x)
    const ys = r1.corners.map((c) => c.y)
    close((Math.min(...xs) + Math.max(...xs)) / 2, 2)
    close((Math.min(...ys) + Math.max(...ys)) / 2, 1)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys))
  })

  test("a part turned 90 degrees has its box turned with it", () => {
    const flat = one(`<resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />`)
    const turned = one(`<resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} pcbRotation={90} />`)
    const span = (points: readonly { x: number; y: number }[], axis: "x" | "y") => Math.max(...points.map((p) => p[axis])) - Math.min(...points.map((p) => p[axis]))
    close(span(turned.corners, "x"), span(flat.corners, "y"))
    close(span(turned.corners, "y"), span(flat.corners, "x"))
    close(partVolume(turned), partVolume(flat))
  })

  test("a part turned 45 degrees keeps its box's sides and area, not the bounds of the turned box", () => {
    const flat = one(`<resistor name="R1" resistance="1k" footprint="0805" pcbX={0} pcbY={0} />`)
    const turned = one(`<resistor name="R1" resistance="1k" footprint="0805" pcbX={0} pcbY={0} pcbRotation={45} />`)
    const side = (c: readonly { x: number; y: number }[], i: number) => Math.hypot(c[(i + 1) % 4]!.x - c[i]!.x, c[(i + 1) % 4]!.y - c[i]!.y)
    close(side(turned.corners, 0) * side(turned.corners, 1), side(flat.corners, 0) * side(flat.corners, 1))
    const a = turned.corners[1]!
    const b = turned.corners[0]!
    close(Math.abs(Math.atan2(a.y - b.y, a.x - b.x)) % (Math.PI / 2), Math.PI / 4)
    close(partVolume(turned), partVolume(flat))
  })

  test("a part on the bottom hangs below the board, its corners counter-clockwise", () => {
    const part = one(`<resistor name="R1" resistance="1k" footprint="0603" pcbX={3} pcbY={0} layer="bottom" />`)
    expect(part.side).toBe("bottom")
    close(part.top, 0)
    close(part.bottom, -0.9)
    const area = part.corners.reduce((sum, p, i) => {
      const q = part.corners[(i + 1) % 4]!
      return sum + p.x * q.y - q.x * p.y
    }, 0)
    expect(area).toBeGreaterThan(0)
  })

  test("a part without a footprint is a 1 mm square, its height assumed", () => {
    const part = one(`<chip name="U1" pcbX={0} pcbY={0} />`)
    expect(part).toMatchObject({ name: "U1", height: 1, assumed: true })
    close(partVolume(part), 1)
  })
})
