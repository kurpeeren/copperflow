import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../../src/engine/design.js"
import { boxOfPoints, tooClose } from "../../src/engine/pcb-place/geometry.js"
import { placeBoard, type Placement } from "../../src/engine/pcb-place/index.js"
import { DEFAULT_COURTYARD_CLEARANCE } from "../../src/engine/pcb-place/scope.js"
import { filesIn, withPositions } from "../helpers/place-fixtures.js"

const MAIN = "lm2596.circuit.tsx"
/** The LM2596 buck module on its 43 x 21 mm board with no part placed: by connections alone C2 finds no room. */
const FILES = filesIn(join(import.meta.dirname, "..", "fixtures", "lm2596-module"))

/** The board as placed: the files with the positions written, built. */
function placedDesign(files: Record<string, string>, placement: Placement): Design {
  return buildDesign({ ...files, [MAIN]: withPositions(files[MAIN] as string, placement.positions) }, MAIN)
}

/** The LM2596 files with each wire pad's chosen edge. */
function withEdges(edges: Record<string, string>): Record<string, string> {
  let main = FILES[MAIN] as string
  for (const [part, edge] of Object.entries(edges)) main = main.replace(`name="${part}"`, `name="${part}" pcbEdge="${edge}"`)
  return { ...FILES, [MAIN]: main }
}

describe("a crowded board", () => {
  test("the parts are packed against each other and the edges until all fit, and a note says so", () => {
    const placement = placeBoard(buildDesign(FILES, MAIN))
    expect(placement.unplaced).toEqual([])
    expect(placement.positions.size).toBe(13)
    expect(placement.notes).toEqual(["The parts did not all fit by their connections, so they were packed against each other and the board edges (1 part had no room before)"])
  })

  test("the packed courtyards keep the clearance apart, inside the edge clearance, with no overlap found", () => {
    const after = placedDesign(FILES, placeBoard(buildDesign(FILES, MAIN)))
    const boxes = after.pcb.parts.map((p) => ({ name: p.component, box: boxOfPoints(p.courtyard) }))
    for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(tooClose(a.box, b.box, DEFAULT_COURTYARD_CLEARANCE - 1e-6), `${a.name} ${b.name}`).toBe(false)
    expect(after.violations.filter((v) => v.code === "courtyard-overlap" || v.code === "outside-board")).toEqual([])
  })

  test("with pack: false (a caller that grows the board instead) C2 is left with no room", () => {
    const placement = placeBoard(buildDesign(FILES, MAIN), { pack: false })
    expect(placement.unplaced.map((u) => u.name)).toEqual(["C2"])
    expect(placement.notes).toEqual([])
  })

  test("the same board packs the same way every time", () => {
    const once = placeBoard(buildDesign(FILES, MAIN))
    const twice = placeBoard(buildDesign(FILES, MAIN))
    expect([...twice.positions]).toEqual([...once.positions])
  })

  test("packing keeps each wire pad on the edge it names", () => {
    const files = withEdges({ J1: "left", J2: "left", J3: "right", J4: "right" })
    const placement = placeBoard(buildDesign(files, MAIN))
    expect(placement.unplaced).toEqual([])
    const after = placedDesign(files, placement)
    const edge = after.rules.fabrication.boardEdgeClearance
    const box = (name: string) => boxOfPoints(after.pcb.parts.find((p) => p.component === name)?.courtyard ?? [])
    for (const name of ["J1", "J2"]) expect(box(name).minX, name).toBeCloseTo(-21.5 + edge, 6)
    for (const name of ["J3", "J4"]) expect(box(name).maxX, name).toBeCloseTo(21.5 - edge, 6)
  })
})
