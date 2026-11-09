import { describe, expect, test } from "vitest"
import {
  INITIAL_LEFT,
  clickLeftStrip,
  clickStrip,
  selectLeftStrip,
  selectStrip,
  showDesignSub,
  showLibrary,
  toggleLeftOpen,
  toggleStripOpen,
  INITIAL_RIGHT,
  rightFor,
  rightTabIds,
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

describe("strip keys", () => {
  test("Enter or Space on the open tab keeps its panel open; on another tab it switches", () => {
    expect(selectStrip({ active: "a", open: true }, "a")).toEqual({ active: "a", open: true })
    expect(selectStrip({ active: "a", open: true }, "b")).toEqual({ active: "b", open: true })
    expect(selectStrip({ active: "a", open: false }, "a")).toEqual({ active: "a", open: true })
  })

  test("on the left strip it keeps the sub-tab", () => {
    expect(selectLeftStrip({ ...INITIAL_LEFT, sub: "net" }, "design")).toEqual({ strip: "design", sub: "net", open: true })
    expect(selectLeftStrip({ ...INITIAL_LEFT, open: false }, "library")).toEqual({ strip: "library", sub: "page", open: true })
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

describe("the Layer tab", () => {
  test("exists only while the PCB is open", () => {
    expect(rightTabIds("pcb")).toEqual(["properties", "layer", "filter"])
    expect(rightTabIds("schematic")).toEqual(["properties", "filter"])
  })

  test("is the right strip's tab on the PCB, and clicking it opens it and a second click collapses the panel", () => {
    const layer = clickStrip(INITIAL_RIGHT, "layer")
    expect(layer).toEqual({ active: "layer", open: true })
    expect(rightFor(layer, "pcb")).toBe(layer)
    expect(clickStrip(layer, "layer").open).toBe(false)
  })

  test("falls back to Properties, keeping the panel open or closed, when the schematic opens", () => {
    expect(rightFor({ active: "layer", open: true }, "schematic")).toEqual({ active: "properties", open: true })
    expect(rightFor({ active: "layer", open: false }, "schematic")).toEqual({ active: "properties", open: false })
    const properties = { active: "properties" as const, open: true }
    expect(rightFor(properties, "schematic")).toBe(properties)
  })
})

describe("the Filter tab", () => {
  test("it is on both views, after Properties and (on the PCB) Layer", () => {
    expect(rightTabIds("pcb")).toEqual(["properties", "layer", "filter"])
    expect(rightTabIds("schematic")).toEqual(["properties", "filter"])
  })

  test("it stays when the view changes; Layer falls back to Properties on the schematic", () => {
    expect(rightFor({ active: "filter", open: true }, "schematic")).toEqual({ active: "filter", open: true })
    expect(rightFor({ active: "filter", open: true }, "pcb")).toEqual({ active: "filter", open: true })
  })
})
