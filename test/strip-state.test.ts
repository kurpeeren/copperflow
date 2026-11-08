import { describe, expect, test } from "vitest"
import {
  INITIAL_LEFT,
  clickLeftStrip,
  clickStrip,
  showDesignSub,
  showLibrary,
  toggleLeftOpen,
  toggleStripOpen,
  INITIAL_RIGHT,
} from "../studio/src/shell/strip-state.js"

describe("strip toggle rule", () => {
  test("clicking the active tab of an open panel collapses it", () => {
    expect(clickStrip({ active: "a", open: true }, "a")).toEqual({ active: "a", open: false })
  })

  test("clicking another tab switches to it and opens the panel", () => {
    expect(clickStrip({ active: "a", open: true }, "b")).toEqual({ active: "b", open: true })
    expect(clickStrip({ active: "a", open: false }, "b")).toEqual({ active: "b", open: true })
  })

  test("clicking the active tab of a collapsed panel opens it", () => {
    expect(clickStrip({ active: "a", open: false }, "a")).toEqual({ active: "a", open: true })
  })
})

describe("left panel state", () => {
  test("starts on the Page sub-tab of Project Design, open", () => {
    expect(INITIAL_LEFT).toEqual({ strip: "design", sub: "page", open: true })
  })

  test("the strip click keeps the chosen sub-tab", () => {
    const library = clickLeftStrip({ ...INITIAL_LEFT, sub: "net" }, "library")
    expect(library).toEqual({ strip: "library", sub: "net", open: true })
    expect(clickLeftStrip(library, "design")).toEqual({ strip: "design", sub: "net", open: true })
    expect(clickLeftStrip(INITIAL_LEFT, "design").open).toBe(false)
  })

  test("showing a sub-tab goes to Project Design and opens the panel", () => {
    const state = showDesignSub("component")
    expect(state).toEqual({ strip: "design", sub: "component", open: true })
  })

  test("Shift+F opens Common Library even from a collapsed panel", () => {
    expect(showLibrary({ ...INITIAL_LEFT, open: false })).toEqual({ strip: "library", sub: "page", open: true })
  })

  test("[ toggles the panel and keeps the strip and sub-tab", () => {
    const closed = toggleLeftOpen({ ...INITIAL_LEFT, sub: "object" })
    expect(closed).toEqual({ strip: "design", sub: "object", open: false })
    expect(toggleLeftOpen(closed).open).toBe(true)
  })
})

describe("right strip state", () => {
  test("starts on Properties, open, and follows the same click rule", () => {
    expect(INITIAL_RIGHT).toEqual({ active: "properties", open: true })
    const closed = clickStrip(INITIAL_RIGHT, "properties")
    expect(closed.open).toBe(false)
    expect(clickStrip(closed, "properties").open).toBe(true)
  })

  test("] toggles the panel and keeps the active tab", () => {
    expect(toggleStripOpen(INITIAL_RIGHT)).toEqual({ active: "properties", open: false })
  })
})
