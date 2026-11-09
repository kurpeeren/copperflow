import { describe, expect, test } from "vitest"
import { isPointerClick, pointerClicked } from "../studio/src/shell/focus.js"
import { tabAfterKey } from "../studio/src/shell/tab-keys.js"

describe("tab keys, shared by every tab list", () => {
  const ids = ["a", "b", "c"] as const

  test("the arrow keys step forward and back, both ways round, and wrap at the ends", () => {
    expect(tabAfterKey(ids, "a", "ArrowRight")).toBe("b")
    expect(tabAfterKey(ids, "a", "ArrowDown")).toBe("b")
    expect(tabAfterKey(ids, "c", "ArrowRight")).toBe("a")
    expect(tabAfterKey(ids, "b", "ArrowLeft")).toBe("a")
    expect(tabAfterKey(ids, "a", "ArrowUp")).toBe("c")
  })

  test("Home and End jump to the first and the last tab", () => {
    expect(tabAfterKey(ids, "b", "Home")).toBe("a")
    expect(tabAfterKey(ids, "b", "End")).toBe("c")
  })

  test("other keys, Enter and Space included, are left to the tab itself", () => {
    for (const key of ["Enter", " ", "a", "Tab", "Escape"]) expect([key, tabAfterKey(ids, "b", key)]).toEqual([key, null])
  })

  test("a one-tab strip stays on its tab, and an empty list has none", () => {
    expect(tabAfterKey(["properties"], "properties", "ArrowDown")).toBe("properties")
    expect(tabAfterKey([], "x", "ArrowDown")).toBeNull()
  })

  test("a current tab that is not in the list counts as the first", () => {
    expect(tabAfterKey(ids, "z" as never, "ArrowRight")).toBe("b")
  })
})

describe("focus after a click", () => {
  test("a pointer click gives the focus up, so Space goes back to rotating the part", () => {
    expect(isPointerClick({ detail: 1 })).toBe(true)
    expect(isPointerClick({ detail: 2 })).toBe(true)
  })

  test("Enter or Space on a focused control clicks with detail 0 and keeps the focus", () => {
    expect(isPointerClick({ detail: 0 })).toBe(false)
  })

  test("a button or checkbox clicked with the pointer gives the focus up; one pressed with Space keeps it", () => {
    expect(pointerClicked("button", 1, false)).toBe(true)
    expect(pointerClicked("checkbox", 1, true)).toBe(true)
    expect(pointerClicked("button", 0, true)).toBe(false)
    expect(pointerClicked("checkbox", 0, true)).toBe(false)
  })

  test("a click a label forwards to its checkbox may have detail 0; the pointer focus (no focus ring) still gives it up", () => {
    expect(pointerClicked("checkbox", 0, false)).toBe(true)
    expect(pointerClicked("button", 0, false)).toBe(false)
  })
})
