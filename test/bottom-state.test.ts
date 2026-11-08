import { describe, expect, test } from "vitest"
import { BOTTOM_TABS, INITIAL_BOTTOM, clickBottom, openBottomTab, toggleBottom } from "../studio/src/shell/bottom-state.js"

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
