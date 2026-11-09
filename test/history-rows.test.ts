import { describe, expect, test } from "vitest"
import { historyRow } from "../studio/src/history-rows.js"

describe("Log rows", () => {
  test("a change in effect has an Undo button and no mark", () => {
    expect(historyRow({ undone: false })).toEqual({ className: "", undoable: true })
  })

  test("an undone change is struck through, without an Undo button", () => {
    expect(historyRow({ undone: true })).toEqual({ className: "undone", undoable: false })
  })

  test("an undo has no Undo button; one that a redo took back is muted and names the redo", () => {
    expect(historyRow({ undone: false, undoOf: "c0001" })).toEqual({ className: "", undoable: false })
    expect(historyRow({ undone: false, undoOf: "c0001", redoneAs: "c0003" })).toEqual({ className: "redone", note: "redone as c0003", undoable: false })
  })

  test("a change a redo brought back is not struck through: it names the redo, whose row has the Undo button", () => {
    expect(historyRow({ undone: false, redoneAs: "c0003" })).toEqual({ className: "", note: "redone as c0003", undoable: false })
  })

  test("a redo is an ordinary change: it has an Undo button until it is undone", () => {
    expect(historyRow({ undone: false, redoOf: "c0002" })).toEqual({ className: "", undoable: true })
    expect(historyRow({ undone: true, redoOf: "c0002" })).toEqual({ className: "undone", undoable: false })
  })
})
