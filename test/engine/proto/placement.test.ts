import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../../../src/engine/design.js"
import { holePoint } from "../../../src/engine/proto/grid.js"
import { pinHoles, protoPartChecks, snappedPosition } from "../../../src/engine/proto/placement.js"

const MAIN = "main.circuit.tsx"

/** A circuit on a 10 x 6 board of the given kind (A1 at -11.43, 6.35). */
function design(body: string, board = 'kind="perfboard" columns={10} rows={6}'): Design {
  return buildDesign({ [MAIN]: `export default () => (\n  <board ${board}>\n${body}\n  </board>\n)\n` }, MAIN)
}

const codes = (built: Design) => built.violations.filter((v) => v.code.startsWith("proto-")).map((v) => v.code)

describe("the board", () => {
  test("a perfboard takes its outline from its holes", () => {
    const built = design("")
    const grid = built.pcb.board?.proto
    expect(grid).toMatchObject({ kind: "perfboard", columns: 10, rows: 6, pitch: 2.54 })
    const xs = (built.pcb.board?.outline ?? []).map((p) => p.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(25.4)
  })

  test("a stripboard's strips run along the rows unless turned", () => {
    expect(design("", 'kind="stripboard" columns={10} rows={6}').pcb.board?.proto?.strips).toBe("rows")
    expect(design("", 'kind="stripboard" columns={10} rows={6} strips="columns"').pcb.board?.proto?.strips).toBe("columns")
  })

  test("is centred on pcbX and pcbY", () => {
    const grid = design("", 'kind="perfboard" columns={3} rows={3} pcbX={10} pcbY={-5}').pcb.board?.proto
    expect(grid && holePoint(grid, { col: 1, row: 1 })).toEqual({ x: 10, y: -5 })
  })

  test("width and height beside a grid are ignored with a warning", () => {
    const built = design("", 'kind="perfboard" columns={10} rows={6} width="50mm" height="40mm"')
    expect(built.diagnostics.map((d) => d.message)).toContain("board: a perfboard takes its size from columns and rows; width, height ignored")
  })

  test("a bad kind, hole count or strip direction is a warning and leaves a plain board", () => {
    const bad = (board: string) => {
      const built = design("", board)
      return { proto: built.pcb.board?.proto, messages: built.diagnostics.map((d) => d.message) }
    }
    expect(bad('kind="veroboard" width="10mm" height="10mm"').messages[0]).toMatch(/kind must be/)
    expect(bad('kind="perfboard" columns={1} rows={6}').messages[0]).toMatch(/needs columns and rows/)
    expect(bad('kind="perfboard" columns={10.5} rows={6}').proto).toBeUndefined()
    expect(bad('kind="stripboard" columns={4} rows={4} strips="diagonal"').messages[0]).toMatch(/strips must be/)
    expect(bad('kind="perfboard" columns={4} rows={4} strips="rows"').messages[0]).toMatch(/strips is for a stripboard/)
    expect(bad('kind="pcb" width="10mm" height="10mm"').proto).toBeUndefined()
  })
})

describe("parts on the grid", () => {
  test("a header on the holes is fine and its pins are found in their holes", () => {
    // pcbX -6.35 puts the 3-pin header's pins at columns 2, 3 and 4 of row C.
    const built = design('<pinheader name="J1" pinCount={3} pitch="2.54mm" pcbX={-6.35} pcbY={1.27} />')
    expect(codes(built)).toEqual([])
    const grid = built.pcb.board?.proto
    if (!grid) throw new Error("no grid")
    const holes = [...pinHoles(grid, built.pcb.parts).values()].map((one) => `${one.pad.component}.${one.pad.number}@${one.hole.col},${one.hole.row}`)
    expect(holes.sort()).toEqual(["J1.1@1,2", "J1.2@2,2", "J1.3@3,2"])
  })

  test("a surface part is refused with the reason", () => {
    const built = design('<resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />')
    const found = built.violations.find((v) => v.code === "proto-smd")
    expect(found?.message).toBe("R1 has surface pads (1, 2); a perfboard takes through-hole parts only, so give it a through-hole footprint")
    expect(found?.severity).toBe("error")
  })

  test("a part off the grid is refused, naming the hole and why", () => {
    const built = design('<pinheader name="J1" pinCount={2} pitch="2.54mm" pcbX={-7.62} pcbY={2.27} />')
    const found = built.violations.filter((v) => v.code === "proto-off-grid")
    expect(found).toHaveLength(2)
    expect(found[0]?.message).toMatch(/^J1 pin 1 is 1\.00 mm from hole C2: it lies between holes, so J1 cannot sit on the grid$/)
  })

  test("a part whose pins are not 2.54 mm apart is refused", () => {
    // A 3.5 mm screw terminal with pin 1 in hole C2: pin 2 lies 0.96 mm short of C3.
    const built = design('<connector name="J2" pinCount={2} footprint="screw2_p3.5" pcbX={-7.14} pcbY={1.27} />')
    const found = built.violations.find((v) => v.code === "proto-off-grid")
    expect(found?.message).toMatch(/^J2 pin 2 is .* mm from hole C\d+: it is 3\.50 x 0\.00 mm from pin 1, not a whole number of 2\.54 mm steps, so J2 cannot sit on the grid$/)
  })

  test("a pin outside the holes is named", () => {
    const built = design('<pinheader name="J1" pinCount={2} pitch="2.54mm" pcbX={30} pcbY={1.27} />')
    expect(codes(built)).toContain("proto-outside")
  })

  test("two pins in one hole", () => {
    const body = ['<pinheader name="J1" pinCount={1} pitch="2.54mm" pcbX={0} pcbY={1.27} />', '<pinheader name="J2" pinCount={1} pitch="2.54mm" pcbX={0.1} pcbY={1.27} />'].join("\n")
    const built = design(body, 'kind="perfboard" columns={11} rows={6}')
    expect(built.violations.find((v) => v.code === "proto-hole-shared")?.message).toBe("J2 pin 1 and J1 pin 1 are both in hole C6")
  })

  test("a plain PCB has none of these findings", () => {
    const built = buildDesign({ [MAIN]: 'export default () => (\n  <board width="20mm" height="20mm">\n<resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />\n  </board>\n)\n' }, MAIN)
    expect(codes(built)).toEqual([])
    expect(protoPartChecks(built.pcb)).toEqual([])
  })
})

describe("snapping", () => {
  const grid = design("").pcb.board?.proto
  if (!grid) throw new Error("no grid")

  test("moves the part so its first pin is on the nearest hole", () => {
    const part = { x: 1, y: 1, pads: [{ layers: "through" as const, x: 0.2, y: 1.3 }, { layers: "through" as const, x: 2.74, y: 1.3 }] }
    const moved = snappedPosition(grid, part as never)
    const hole = holePoint(grid, { col: 5, row: 2 })
    expect(moved?.x).toBeCloseTo(1 + (hole.x - 0.2))
    expect(moved?.y).toBeCloseTo(1 + (hole.y - 1.3))
  })

  test("leaves a part with no through pin", () => {
    expect(snappedPosition(grid, { x: 0, y: 0, pads: [{ layers: "top", x: 0, y: 0 }] } as never)).toBeUndefined()
  })
})
