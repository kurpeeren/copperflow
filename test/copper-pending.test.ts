import { describe, expect, test } from "vitest"
import { addPending, inFlight, markPending, pendingMoving, pendingShapes, settlePending, dropPending, type PendingCopper } from "../studio/src/pcb/copper-pending.js"

const p = (x: number, y: number) => ({ x, y })
const shapes = (id: string, at: { x: number; y: number }) => ({ tracks: new Map(), vias: new Map([[id, at]]) })

describe("copper edits waiting for their build", () => {
  test("an edit's shapes show until a build that started after its write mark is shown", () => {
    let list: PendingCopper[] = addPending([], 1, { shapes: shapes("v0001", p(1, 1)) })
    expect(inFlight(list)).toBe(true)
    list = markPending(list, 1, 7)
    expect(inFlight(list)).toBe(false)
    expect(pendingShapes(list, 7).vias.get("v0001")).toEqual(p(1, 1))
    expect(settlePending(list, 7)).toHaveLength(1)
    expect(settlePending(list, 8)).toEqual([])
    expect(pendingShapes(list, 8).vias.size).toBe(0)
  })

  test("a later edit's shape of the same record wins; a failed edit drops only its own shapes", () => {
    let list = addPending([], 1, { shapes: shapes("v0001", p(1, 1)) })
    list = addPending(list, 2, { shapes: shapes("v0002", p(2, 2)) })
    list = addPending(list, 3, { shapes: shapes("v0001", p(3, 3)) })
    expect(pendingShapes(list, undefined).vias.get("v0001")).toEqual(p(3, 3))
    list = dropPending(list, 2)
    expect(pendingShapes(list, undefined).vias.has("v0002")).toBe(false)
    expect(pendingShapes(list, undefined).vias.get("v0001")).toEqual(p(3, 3))
  })

  test("an edit still waiting for its answer stays, whatever build is shown", () => {
    const list = addPending([], 1, { shapes: shapes("v0001", p(1, 1)) })
    expect(settlePending(list, 99)).toHaveLength(1)
  })

  test("a group move's parts are drawn moved until their build lands", () => {
    const list = markPending(addPending([], 1, { shapes: shapes("v0001", p(1, 1)), parts: { names: ["R1"], offset: p(1, 0) } }), 1, 4)
    expect(pendingMoving(list, 4)).toEqual({ names: ["R1"], offset: p(1, 0) })
    expect(pendingMoving(list, 5)).toBeUndefined()
  })
})
