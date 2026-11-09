import { describe, expect, test } from "vitest"
import { historyRow } from "../studio/src/history-rows.js"

describe("Log rows", () => {
  test("a change in effect has an Undo button and no mark", () => {
    expect(historyRow({ undone: false, redone: false })).toEqual({ className: "", undoable: true })
  })

  test("an undone change is struck through, without an Undo button", () => {
    expect(historyRow({ undone: true, redone: false })).toEqual({ className: "undone", undoable: false })
  })

  test("an undo has no Undo button; one that a redo took back is marked redone", () => {
    expect(historyRow({ undone: false, redone: false, undoOf: "c0001" })).toEqual({ className: "", undoable: false })
    expect(historyRow({ undone: false, redone: true, undoOf: "c0001" })).toEqual({ className: "redone", note: "redone", undoable: false })
  })

  test("a redo is an ordinary change: it has an Undo button until it is undone", () => {
    expect(historyRow({ undone: false, redone: false, redoOf: "c0002" })).toEqual({ className: "", undoable: true })
    expect(historyRow({ undone: true, redone: false, redoOf: "c0002" })).toEqual({ className: "undone", undoable: false })
  })
})
