import { describe, expect, test } from "vitest"
import type { NetLabel } from "../src/engine/schematic.js"
import { allLocked, contextItems, contextShape, contextSelection, contextSize, placeMenu, type ContextEntry } from "../studio/src/shell/context-menu.js"
import { ENGINE } from "../studio/src/shell/menus.js"
import { commandOwner } from "../studio/src/shell/command-owners.js"
import { createTargetActions, latestHandler } from "../studio/src/shell/target-actions.js"
import { Selection } from "../studio/src/selection.js"

const label = { id: "l1", net: "net.VCC", text: "VCC", at: { x: 0, y: 0 }, side: "left", style: "label" } as NetLabel
const names = (entries: ContextEntry[]) => entries.map((e) => (e === "separator" ? "-" : e.label))
const part = { kind: "part", name: "R1" } as const

describe("context menu items", () => {
  test("a part gets Properties, Rotate, Lock, Highlight its nets and Delete", () => {
    expect(names(contextItems(part, { allLocked: false }))).toEqual(["Properties", "-", "Rotate", "Lock", "Highlight its nets", "-", "Delete"])
  })

  test("Lock becomes Unlock when every selected part is locked", () => {
    const items = contextItems(part, { allLocked: true })
    expect(names(items)).toContain("Unlock")
    expect(names(items)).not.toContain("Lock")
  })

  test("empty canvas gets Fit all, Grid style, zoom and a pending Paste", () => {
    const items = contextItems({ kind: "canvas" }, { allLocked: false })
    expect(names(items)).toEqual(["Fit all", "Grid style", "-", "Zoom in", "Zoom out", "-", "Paste"])
    expect(items.at(-1)).toMatchObject({ label: "Paste", pending: ENGINE })
    expect(contextShape(items).at(-1)).toBe("disabled")
  })

  test("a net label gets Rename and Highlight net", () => {
    expect(names(contextItems({ kind: "label", label }, { allLocked: false }))).toEqual(["Rename", "Highlight net"])
  })

  test("every command item has someone to run it", () => {
    for (const target of [part, { kind: "canvas" }] as const) {
      for (const locked of [false, true]) {
        for (const entry of contextItems(target, { allLocked: locked })) {
          if (entry !== "separator" && entry.command) expect(commandOwner(entry.command)).toBeDefined()
        }
      }
    }
  })

  test("the shape marks separators", () => {
    expect(contextShape(contextItems(part, { allLocked: false }))).toEqual(["item", "separator", "item", "item", "item", "separator", "item"])
  })
})

describe("context menu placement", () => {
  const menu = { width: 240, height: 100 }
  const win = { width: 800, height: 600 }
  test("opens at the pointer when it fits", () => {
    expect(placeMenu({ x: 100, y: 50 }, menu, win)).toEqual({ x: 100, y: 50 })
  })
  test("flips left and up near the right and bottom edges", () => {
    expect(placeMenu({ x: 700, y: 550 }, menu, win)).toEqual({ x: 460, y: 450 })
  })
  test("never leaves the top-left corner", () => {
    expect(placeMenu({ x: 100, y: 50 }, { width: 240, height: 700 }, win)).toEqual({ x: 100, y: 0 })
  })
  test("its size counts items and separators", () => {
    expect(contextSize(["separator"]).height).toBeLessThan(contextSize([{ label: "A" }]).height)
  })
})

describe("the selection on right click", () => {
  test("a part outside the selection is selected alone", () => {
    const current = Selection.none.add(["R1", "R2"])
    expect(contextSelection(current, { kind: "part", name: "C1" }).names).toEqual(["C1"])
  })
  test("a selected part keeps the whole selection", () => {
    const current = Selection.none.add(["R1", "R2"])
    expect(contextSelection(current, { kind: "part", name: "R2" })).toBe(current)
  })
  test("a label or empty canvas leaves the selection alone", () => {
    const current = Selection.none.add(["R1"])
    expect(contextSelection(current, { kind: "canvas" })).toBe(current)
    expect(contextSelection(current, { kind: "label", label })).toBe(current)
  })
})

describe("allLocked", () => {
  const locked = new Set(["R1", "R2"])
  test("true only when something is selected and all of it is locked", () => {
    expect(allLocked(["R1", "R2"], locked)).toBe(true)
    expect(allLocked(["R1", "C1"], locked)).toBe(false)
    expect(allLocked([], locked)).toBe(false)
  })
})

describe("target actions", () => {
  test("a rename started after the circuit changed uses the new circuit", () => {
    const circuits: string[] = []
    const latest = latestHandler(() => circuits.push("circuit 1"))
    latest.set(() => circuits.push("circuit 2"))
    latest.call({ kind: "renameLabel", labelId: "l1" })
    expect(circuits).toEqual(["circuit 2"])
  })
  test("the newest answer gets the action, so it reads the current circuit", () => {
    const bus = createTargetActions()
    const seen: string[] = []
    const stop = bus.answer(() => seen.push("old circuit"))
    bus.answer(() => seen.push("new circuit"))
    expect(bus.send({ kind: "renameLabel", labelId: "l1" })).toBe(true)
    expect(seen).toEqual(["new circuit"])
    stop()
    expect(bus.send({ kind: "renameLabel", labelId: "l1" })).toBe(true)
  })
  test("nobody answering is reported", () => {
    expect(createTargetActions().send({ kind: "renameLabel", labelId: "l1" })).toBe(false)
  })
})
