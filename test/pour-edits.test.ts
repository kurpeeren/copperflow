import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { newBoardItemId, NOT_AT_TOP, UNSURE_BOARD_ID } from "../src/core/board-items.js"
import { applyEdits, EditError } from "../src/core/edit.js"
import type { Edit } from "../src/core/types.js"

const none = new Set<string>()

const BOARD = `export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0402" />
    <trace from=".R1 > .pin1" to="net.GND" />
  </board>
)
`

const WITH_POURS = `export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0402" />
    <copperpour net="GND" layer="bottom" />
    <copperpour net="GND" layer="top" outline={[{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]} priority={1} />
    <hole x={2} y={3} diameter={3.2} />
    <trace from=".R1 > .pin1" to="net.GND" />
  </board>
)
`

function editError(edits: Edit[], locked: ReadonlySet<string> = none, source = WITH_POURS): EditError {
  try {
    applyEdits(source, edits, locked)
  } catch (error) {
    expect(error).toBeInstanceOf(EditError)
    return error as EditError
  }
  throw new Error("expected an EditError")
}

const items = (source: string) => analyzeCircuit(source).boardItems ?? []

describe("the scan of pours and holes", () => {
  test("gives each pour and hole the engine's id, in source order, with its outline", () => {
    const found = items(WITH_POURS)
    expect(found.map((item) => item.id)).toEqual(["copperpour:1", "copperpour:2", "hole:1"])
    expect(found[1]?.outline).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ])
    expect(found.every((item) => item.editable)).toBe(true)
    expect(found[0]?.props["net"]?.literal).toBe("GND")
  })

  test("a pour after one the engine drops keeps its id and stays editable; one after a pour made in a callback is read-only", () => {
    const dropped = WITH_POURS.replace('<copperpour net="GND" layer="bottom" />', '<copperpour net={net} layer="bottom" />')
    expect(items(dropped).map((item) => [item.id, item.editable])).toEqual([
      ["copperpour:1", true],
      ["copperpour:2", true],
      ["hole:1", true],
    ])
    const mapped = WITH_POURS.replace('<copperpour net="GND" layer="bottom" />', '{["a"].map(() => <copperpour net="GND" layer="bottom" />)}')
    expect(items(mapped)[1]?.readonlyReason).toBe(UNSURE_BOARD_ID)
  })

  test("a pour inside a group is read-only", () => {
    const source = BOARD.replace("<trace", '<group pcbX={5}><hole x={1} y={1} diameter={2} /></group>\n    <trace')
    expect(items(source)[0]?.readonlyReason).toBe(NOT_AT_TOP)
  })
})

describe("addPour", () => {
  test("writes a whole-board pour before the board's first trace", () => {
    const out = applyEdits(BOARD, [{ kind: "addPour", net: "GND", layer: "bottom" }], none)
    expect(out).toBe(BOARD.replace('    <trace', '    <copperpour net="GND" layer="bottom" />\n    <trace'))
  })

  test("writes a drawn outline and the optional props", () => {
    const outline = [
      { x: 1, y: 1 },
      { x: 4.123456, y: 1 },
      { x: 4, y: 3 },
    ]
    const out = applyEdits(BOARD, [{ kind: "addPour", net: "GND", layer: "top", outline, props: { priority: 2, thermal: "solid" } }], none)
    expect(out).toContain('<copperpour net="GND" layer="top" outline={[{ x: 1, y: 1 }, { x: 4.1235, y: 1 }, { x: 4, y: 3 }]} priority={2} thermal="solid" />')
  })

  test("goes after the last pour, so the earlier ids stay", () => {
    const out = applyEdits(WITH_POURS, [{ kind: "addPour", net: "VCC", layer: "top" }], none)
    expect(out).toContain('<hole x={2} y={3} diameter={3.2} />\n    <copperpour net="VCC" layer="top" />\n    <trace')
    const late = WITH_POURS.replace('    <copperpour net="GND" layer="bottom" />\n', "").replace("  </board>", '    <copperpour net="GND" layer="bottom" />\n  </board>')
    const after = applyEdits(late, [{ kind: "addPour", net: "VCC", layer: "top" }], none)
    expect(after).toContain('<copperpour net="GND" layer="bottom" />\n    <copperpour net="VCC" layer="top" />\n  </board>')
    expect(items(out).map((item) => item.id)).toEqual(["copperpour:1", "copperpour:2", "hole:1", "copperpour:3"])
  })

  test("refuses a bad layer, an outline of two points and an unknown prop", () => {
    expect(editError([{ kind: "addPour", net: "GND", layer: "middle" }]).code).toBe("invalid")
    expect(editError([{ kind: "addPour", net: "GND", layer: "top", outline: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]).message).toMatch(/3/)
    expect(editError([{ kind: "addPour", net: "GND", layer: "top", props: { colour: "red" } }]).message).toMatch(/colour/)
    expect(editError([{ kind: "addPour", net: "", layer: "top" }]).message).toMatch(/net/)
    expect(editError([{ kind: "addPour", net: "GND", layer: "top", props: { clearance: -1 } }]).message).toMatch(/clearance/)
    expect(editError([{ kind: "addPour", net: "GND", layer: "top", props: { thermal: "warm" } }]).message).toMatch(/thermal/)
  })
})

describe("setPour", () => {
  test("refuses an outline that is not a simple polygon: repeated corners, no area, crossing edges", () => {
    const set = (outline: { x: number; y: number }[]) => editError([{ kind: "setPour", id: "copperpour:2", props: { outline } }]).message
    expect(set([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }])).toMatch(/same place/)
    expect(set([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }])).toMatch(/one line/)
    expect(set([{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }])).toMatch(/cross/)
    expect(editError([{ kind: "addPour", net: "GND", layer: "top", outline: [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }] }]).message).toMatch(/cross/)
  })

  test("sets props and the outline, one edit each", () => {
    const outline = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 6 },
    ]
    const out = applyEdits(WITH_POURS, [{ kind: "setPour", id: "copperpour:2", props: { outline, layer: "bottom", clearance: 0.3 } }], none)
    expect(out).toContain('<copperpour net="GND" layer="bottom" outline={[{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }]} priority={1} clearance={0.3} />')
  })

  test("null removes a prop: without its outline the pour fills the board", () => {
    const out = applyEdits(WITH_POURS, [{ kind: "setPour", id: "copperpour:2", props: { outline: null, priority: null } }], none)
    expect(out).toContain('    <copperpour net="GND" layer="top" />\n    <hole')
  })

  test("refuses a locked pour, a read-only one and a missing one", () => {
    expect(editError([{ kind: "setPour", id: "copperpour:1", props: { priority: 3 } }], new Set(["copperpour:1"])).code).toBe("locked")
    expect(editError([{ kind: "setPour", id: "copperpour:9", props: { priority: 3 } }]).code).toBe("not_found")
    const source = WITH_POURS.replace('layer="bottom" />', 'layer="bottom" {...extra} />')
    expect(editError([{ kind: "setPour", id: "copperpour:1", props: { priority: 3 } }], none, source).code).toBe("readonly")
    expect(editError([{ kind: "setPour", id: "copperpour:1", props: { priority: 1.5 } }]).message).toMatch(/priority/)
  })
})

describe("removePour", () => {
  test("removes the pour's line", () => {
    const out = applyEdits(WITH_POURS, [{ kind: "removePour", id: "copperpour:1" }], none)
    expect(out).not.toContain('layer="bottom" />')
    expect(items(out).map((item) => item.id)).toEqual(["copperpour:1", "hole:1"])
  })

  test("refuses to renumber a locked pour after it", () => {
    expect(editError([{ kind: "removePour", id: "copperpour:1" }], new Set(["copperpour:2"])).code).toBe("locked")
  })

  test("removes the later of two first, so both ids still name their pours", () => {
    const out = applyEdits(WITH_POURS, [{ kind: "removePour", id: "copperpour:2" }, { kind: "removePour", id: "copperpour:1" }], none)
    expect(items(out).map((item) => item.id)).toEqual(["hole:1"])
  })
})

describe("holes", () => {
  test("addHole writes x, y and diameter after the last hole", () => {
    const out = applyEdits(WITH_POURS, [{ kind: "addHole", x: 10, y: 12.5, diameter: 3.2 }], none)
    expect(out).toContain('<hole x={2} y={3} diameter={3.2} />\n    <hole x={10} y={12.5} diameter={3.2} />')
  })

  test("addHole on a board without one goes before the first trace", () => {
    const out = applyEdits(BOARD, [{ kind: "addHole", x: 1, y: 1, diameter: 2 }], none)
    expect(out).toContain('    <hole x={1} y={1} diameter={2} />\n    <trace')
  })

  test("setHole moves and resizes; removeHole removes", () => {
    const moved = applyEdits(WITH_POURS, [{ kind: "setHole", id: "hole:1", props: { x: 4, diameter: 2.5 } }], none)
    expect(moved).toContain("<hole x={4} y={3} diameter={2.5} />")
    const gone = applyEdits(WITH_POURS, [{ kind: "removeHole", id: "hole:1" }], none)
    expect(gone).not.toContain("<hole")
  })

  test("refuses a diameter that is not positive, an unknown prop and a locked hole", () => {
    expect(editError([{ kind: "addHole", x: 1, y: 1, diameter: 0 }]).message).toMatch(/diameter/)
    expect(editError([{ kind: "setHole", id: "hole:1", props: { radius: 1 } }]).message).toMatch(/radius/)
    expect(editError([{ kind: "removeHole", id: "hole:1" }], new Set(["hole:1"])).code).toBe("locked")
  })
})

describe("a new pour or hole after every one of its tag", () => {
  test("a grouped pour later in the file does not refuse the new one, which goes before </board> and takes the next id", () => {
    const source = BOARD.replace("  </board>", '    <group pcbX={5}>\n      <copperpour net="GND" layer="top" />\n    </group>\n  </board>')
    const out = applyEdits(source, [{ kind: "addPour", net: "VCC", layer: "bottom" }], none)
    expect(out).toContain('    </group>\n    <copperpour net="VCC" layer="bottom" />\n  </board>')
    const found = items(out)
    expect(found.map((item) => item.id)).toEqual(["copperpour:1", "copperpour:2"])
    expect(found[1]?.props["net"]?.literal).toBe("VCC")
    expect(newBoardItemId(items(source), "copperpour")).toBe("copperpour:2")
    expect(newBoardItemId(items(source), "hole")).toBe("hole:1")
  })
})
