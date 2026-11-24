import { describe, expect, test } from "vitest"
import type { ProtoRecord } from "../../../src/core/layout-proto.js"
import { buildDesign } from "../../../src/engine/design.js"
import { boardState, cloneState, FREE } from "../../../src/engine/proto/board-state.js"
import { neededCuts } from "../../../src/engine/proto/cuts.js"

const MAIN = "main.circuit.tsx"

function stateOf(body: readonly string[], records: readonly ProtoRecord[] = [], board = 'kind="stripboard" columns={10} rows={6}') {
  const circuit = `export default () => (\n  <board ${board}>\n${body.join("\n")}\n  </board>\n)\n`
  const built = buildDesign({ [MAIN]: circuit, "main.circuit.layout.json": records.map((r) => JSON.stringify(r)).join("\n") }, MAIN)
  const grid = built.pcb.board?.proto
  if (!grid) throw new Error("no grid")
  return boardState(grid, built.pcb.parts, built.pcb.proto ?? [], { names: [], indexOf: new Map() })
}

// J1 in C2–C4: pin 1 on A, pin 2 on no net, pin 3 on B.
const J1 = ['<pinheader name="J1" pinCount={3} pitch="2.54mm" pcbX={-6.35} pcbY={1.27} />', '<trace from="J1.pin1" to="net.A" />', '<trace from="J1.pin3" to="net.B" />']

describe("cuts", () => {
  test("neighbouring holes of different nets are cut between", () => {
    expect(neededCuts(stateOf(J1))).toEqual([{ between: ["C2", "C3"] }, { between: ["C3", "C4"] }])
  })

  test("a gap is drilled at its middle free hole", () => {
    const body = ['<pinheader name="J1" pinCount={1} pitch="2.54mm" pcbX={-8.89} pcbY={1.27} />', '<pinheader name="J2" pinCount={1} pitch="2.54mm" pcbX={3.81} pcbY={1.27} />', '<trace from="J1.pin1" to="net.A" />', '<trace from="J2.pin1" to="net.B" />']
    expect(neededCuts(stateOf(body))).toEqual([{ at: "C4" }])
  })

  test("a cut already there is not made again", () => {
    const records: ProtoRecord[] = [{ t: "cut", id: "x1", between: ["C2", "C3"], locked: false, by: "human" }]
    expect(neededCuts(stateOf(J1, records))).toEqual([{ between: ["C3", "C4"] }])
  })

  test("holes of one net along a strip carry it and need no cut", () => {
    const body = ['<pinheader name="J1" pinCount={1} pitch="2.54mm" pcbX={-8.89} pcbY={1.27} />', '<pinheader name="J2" pinCount={1} pitch="2.54mm" pcbX={3.81} pcbY={1.27} />', '<trace from="J1.pin1" to="net.A" />', '<trace from="J2.pin1" to="net.A" />']
    const state = stateOf(body)
    expect(neededCuts(state)).toEqual([])
    // The strip between them took net A, and the two pins are joined.
    expect(state.owner[2 * 10 + 4]).not.toBe(FREE)
    expect(state.conn.find(2 * 10 + 1)).toBe(state.conn.find(2 * 10 + 6))
  })

  test("a perfboard needs none", () => {
    expect(neededCuts(stateOf(J1, [], 'kind="perfboard" columns={10} rows={6}'))).toEqual([])
  })

  test("a copy of the state changes apart from the original", () => {
    const state = stateOf(J1)
    const copy = cloneState(state)
    copy.owner[0] = 5
    copy.conn.join(0, 59)
    expect(state.owner[0]).toBe(FREE)
    expect(state.conn.find(59)).not.toBe(state.conn.find(0))
  })
})
