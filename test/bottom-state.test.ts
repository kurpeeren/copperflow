import { describe, expect, test } from "vitest"
import { BOTTOM_TABS, INITIAL_BOTTOM, bottomTabAfterKey, clickBottom, openBottomTab, toggleBottom } from "../studio/src/shell/bottom-state.js"

describe("bottom panel state", () => {
  test("starts closed on the DRC tab", () => {
    expect(INITIAL_BOTTOM).toEqual({ open: false, tab: "drc" })
  })

  test("the tabs run Library, Log, DRC, Find Results", () => {
    expect(BOTTOM_TABS.map((t) => t.id)).toEqual(["library", "log", "drc", "find"])
  })

  test("clicking a tab of a closed panel opens it on that tab", () => {
    expect(clickBottom(INITIAL_BOTTOM, "log")).toEqual({ open: true, tab: "log" })
  })

  test("clicking the open tab closes the panel and keeps the tab", () => {
    expect(clickBottom({ open: true, tab: "log" }, "log")).toEqual({ open: false, tab: "log" })
  })

  test("clicking another tab of an open panel switches to it", () => {
    expect(clickBottom({ open: true, tab: "log" }, "library")).toEqual({ open: true, tab: "library" })
  })

  test("clicking the remembered tab of a closed panel reopens it", () => {
    expect(clickBottom({ open: false, tab: "log" }, "log")).toEqual({ open: true, tab: "log" })
  })

  test("the backslash toggles and keeps the last tab", () => {
    const closed = toggleBottom({ open: true, tab: "find" })
    expect(closed).toEqual({ open: false, tab: "find" })
    expect(toggleBottom(closed)).toEqual({ open: true, tab: "find" })
  })

  test("openTab opens that tab and stays open when it already is", () => {
    expect(openBottomTab(INITIAL_BOTTOM, "drc")).toEqual({ open: true, tab: "drc" })
    expect(openBottomTab({ open: true, tab: "drc" }, "drc")).toEqual({ open: true, tab: "drc" })
    expect(openBottomTab({ open: true, tab: "log" }, "drc")).toEqual({ open: true, tab: "drc" })
  })
})

describe("bottom tab keys", () => {
  test("arrows wrap around, Home and End jump to the ends, other keys do nothing", () => {
    expect(bottomTabAfterKey("ArrowRight", "log")).toBe("drc")
    expect(bottomTabAfterKey("ArrowRight", "find")).toBe("library")
    expect(bottomTabAfterKey("ArrowLeft", "library")).toBe("find")
    expect(bottomTabAfterKey("Home", "drc")).toBe("library")
    expect(bottomTabAfterKey("End", "drc")).toBe("find")
    expect(bottomTabAfterKey("a", "drc")).toBeNull()
  })
})

describe("bottom panel focus", () => {
  test("a pointer click blurs the button; Enter or Space on a check row keeps focus", async () => {
    const { blursAfterClick } = await import("../studio/src/checks-panel-state.js")
    expect(blursAfterClick({ detail: 1 })).toBe(true)
    expect(blursAfterClick({ detail: 0 })).toBe(false)
  })
})
