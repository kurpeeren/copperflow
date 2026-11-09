import { describe, expect, test } from "vitest"
import { applyEdits } from "../src/core/edit.js"
import { buildDesign } from "../src/engine/design.js"
import { memberKey } from "../studio/src/pcb/bus-pick.js"
import { endAt, memberEnd, wireEdits, type WireEnd } from "../studio/src/pcb/wire-tool.js"

const FILE = "main.circuit.tsx"
const SOURCE = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={4} schY={0} />
    <bus name="D[0:7]" points={[{ x: -2, y: 3 }, { x: 6, y: 3 }, { x: 6, y: 5 }]} />
    <bus name="CLK" points={[{ x: -2, y: -3 }, { x: 6, y: -3 }]} />
  </board>
)`
const design = buildDesign({ [FILE]: SOURCE }, FILE)

function pin(id: string): WireEnd {
  const at = design.schematic.symbols.find((s) => s.pinEnds[id])?.pinEnds[id]
  const end = at && endAt(design, at, 0.01)
  if (!end) throw new Error(`no end at ${id}`)
  return end
}

function busEndAt(x: number, y: number): WireEnd {
  const end = endAt(design, { x, y }, 0.2)
  if (!end?.members) throw new Error(`no bus at ${x}, ${y}`)
  return end
}

describe("a bus as a wire end", () => {
  test("a point near a bus segment gives the bus, its members and the meeting point on it", () => {
    expect(endAt(design, { x: 1.23, y: 3.1 }, 0.2)).toEqual({
      selector: "bus:D[0:7]",
      at: { x: 1.23, y: 3 },
      label: "D[0:7]",
      members: ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"],
    })
    expect(busEndAt(6.1, 4).at).toEqual({ x: 6, y: 4 })
  })

  test("a plain name is a one-member bus", () => {
    expect(busEndAt(0, -3.05).members).toEqual(["CLK"])
  })

  test("a pin comes before a bus", () => {
    const at = design.schematic.symbols.find((s) => s.pinEnds["R1.pin1"])?.pinEnds["R1.pin1"]
    if (!at) throw new Error("no pin")
    const near = buildDesign({ [FILE]: SOURCE.replace("{ x: -2, y: 3 }, { x: 6, y: 3 }", `{ x: -2, y: ${at.y} }, { x: 6, y: ${at.y} }`) }, FILE)
    expect(endAt(near, at, 0.2)?.selector).toBe("R1.pin1")
  })

  test("a member picked is the net end at the meeting point", () => {
    expect(memberEnd(busEndAt(1.23, 3.1), "D3")).toEqual({ selector: "net.D3", at: { x: 1.23, y: 3 }, label: "D3", net: "D3" })
  })
})

describe("the wire to a bus member", () => {
  test("a trace from the pin to net.D3, with the corners as hints and the meeting point on the bus last", () => {
    const start = pin("R1.pin2")
    const edits = wireEdits(design, start, memberEnd(busEndAt(1.5, 3), "D3"), [{ x: 1, y: 1 }])
    expect(edits).toEqual([
      {
        kind: "addTrace",
        from: "R1.pin2",
        to: "net.D3",
        schematicRouteHints: [
          { x: 1, y: start.at.y },
          { x: 1, y: 1 },
          { x: 1.5, y: 1 },
          { x: 1.5, y: 3 },
        ],
      },
    ])
  })

  test("the engine draws the D3 label where the wire meets the bus, and the pin is on D3", () => {
    const edits = wireEdits(design, pin("R1.pin2"), memberEnd(busEndAt(1.5, 3), "D3"), [])
    const built = buildDesign({ [FILE]: applyEdits(SOURCE, edits, new Set()) }, FILE)
    expect(built.schematic.labels.find((label) => label.text === "D3")?.at).toEqual({ x: 1.5, y: 3 })
    expect(built.circuit.nets.find((net) => net.names.includes("D3"))?.pins).toContain("R1.pin2")
  })

  test("a wire that starts on the bus is the same trace the other way round", () => {
    const edits = wireEdits(design, memberEnd(busEndAt(4.2, 3), "D5"), pin("R2.pin1"), [])
    expect(edits).toMatchObject([{ kind: "addTrace", from: "net.D5", to: "R2.pin1" }])
    expect((edits[0] as { schematicRouteHints: unknown[] }).schematicRouteHints[0]).toEqual({ x: 4.2, y: 3 })
  })

  test("a bus whose member is not picked yet writes nothing", () => {
    expect(wireEdits(design, pin("R1.pin2"), busEndAt(1.5, 3), [])).toEqual([])
  })
})

describe("the member list's keys", () => {
  test("arrows move round the list, Enter picks, Esc cancels, other keys do nothing", () => {
    expect(memberKey(0, 8, "ArrowDown")).toEqual({ index: 1 })
    expect(memberKey(7, 8, "ArrowDown")).toEqual({ index: 0 })
    expect(memberKey(0, 8, "ArrowUp")).toEqual({ index: 7 })
    expect(memberKey(3, 8, "Home")).toEqual({ index: 0 })
    expect(memberKey(3, 8, "End")).toEqual({ index: 7 })
    expect(memberKey(3, 8, "Enter")).toEqual({ pick: 3 })
    expect(memberKey(3, 8, "Escape")).toEqual({ cancel: true })
    expect(memberKey(3, 8, "a")).toBeUndefined()
  })
})
