import { describe, expect, test } from "vitest"
import type { NetLabel } from "../src/engine/schematic.js"
import { allLocked, contextItems, contextShape, contextSelection, contextSize, placeMenu, WIRE_IN_GROUP, type ContextEntry } from "../studio/src/shell/context-menu.js"
import { ENGINE } from "../studio/src/shell/menus.js"
import { commandOwner } from "../studio/src/shell/command-owners.js"
import { createTargetActions, latestHandler } from "../studio/src/shell/target-actions.js"
import { Selection } from "../studio/src/selection.js"

const label = { id: "l1", net: "net.VCC", text: "VCC", at: { x: 0, y: 0 }, side: "left", style: "label" } as NetLabel
const names = (entries: ContextEntry[]) => entries.map((e) => (e === "separator" ? "-" : e.label))
const part = { kind: "part", name: "R1" } as const
const wire = { kind: "wire", id: "wire:R1.pin2|R2.pin1" } as const
const FREE_WIRE = { remove: null, removeCorners: null }
const STUDIO_WIRE = "This wire has no trace of its own: Studio draws it for net GND"

describe("context menu items", () => {
  test("a part gets Properties, Rotate, Lock, Highlight its nets and Delete", () => {
    expect(names(contextItems(part, { allLocked: false, selected: 1 }))).toEqual(["Properties", "-", "Rotate", "Lock", "Highlight its nets", "-", "Delete"])
  })

  test("two or more selected parts add the align items, and distribute waits for three", () => {
    const two = contextItems(part, { allLocked: false, selected: 2 })
    expect(names(two)).toEqual([
      "Properties", "-", "Rotate", "Lock", "Highlight its nets", "-",
      "Align left", "Align right", "Align top", "Align bottom", "Align horizontal centres", "Align vertical centres", "-",
      "Distribute horizontally", "Distribute vertically", "-", "Delete",
    ])
    const spread = two.find((e) => e !== "separator" && e.label === "Distribute horizontally")
    expect(spread).toMatchObject({ command: "distributeH", pending: "Select three or more parts", shortcut: "Ctrl+Shift+H" })
    const three = contextItems(part, { allLocked: false, selected: 3 })
    expect(three.find((e) => e !== "separator" && e.label === "Distribute vertically")).toEqual({ label: "Distribute vertically", command: "distributeV" })
    expect(two.find((e) => e !== "separator" && e.label === "Align left")).toEqual({ label: "Align left", command: "alignLeft", shortcut: "Ctrl+Shift+L" })
  })

  test("Lock becomes Unlock when every selected part is locked", () => {
    const items = contextItems(part, { allLocked: true, selected: 1 })
    expect(names(items)).toContain("Unlock")
    expect(names(items)).not.toContain("Lock")
  })

  test("empty canvas gets Fit all, Grid style, zoom and a pending Paste", () => {
    const items = contextItems({ kind: "canvas" }, { allLocked: false, selected: 1 })
    expect(names(items)).toEqual(["Fit all", "Grid style", "-", "Zoom in", "Zoom out", "-", "Paste"])
    expect(items.at(-1)).toMatchObject({ label: "Paste", pending: ENGINE })
    expect(contextShape(items).at(-1)).toBe("disabled")
  })

  test("a net label gets Rename and Highlight net", () => {
    expect(names(contextItems({ kind: "label", label }, { allLocked: false, selected: 1 }))).toEqual(["Rename", "Highlight net"])
  })

  test("a wire gets Properties, Highlight net, Remove corners and Delete, on the menus' own commands", () => {
    const items = contextItems(wire, { allLocked: false, selected: 0, wire: FREE_WIRE })
    expect(names(items)).toEqual(["Properties", "-", "Highlight net", "Remove corners", "-", "Delete"])
    expect(items[0]).toEqual({ label: "Properties", special: "properties" })
    expect(items).toContainEqual({ label: "Highlight net", command: "highlight", shortcut: "H" })
    expect(items).toContainEqual({ label: "Remove corners", command: "removeCorners" })
    expect(items).toContainEqual({ label: "Delete", command: "delete", shortcut: "Delete" })
  })

  test("a wire selected with other things: Delete acts on all of them, Remove corners waits for the wire alone", () => {
    const items = contextItems(wire, { allLocked: false, selected: 1, wire: WIRE_IN_GROUP })
    expect(items).toContainEqual({ label: "Delete", command: "delete", shortcut: "Delete" })
    expect(items).toContainEqual({ label: "Remove corners", command: "removeCorners", pending: "Select this wire alone to remove its corners" })
  })

  test("a wire's Remove corners and Delete are disabled with the reason they cannot run", () => {
    const items = contextItems(wire, { allLocked: false, selected: 0, wire: { remove: STUDIO_WIRE, removeCorners: STUDIO_WIRE } })
    expect(items).toContainEqual({ label: "Remove corners", command: "removeCorners", pending: STUDIO_WIRE })
    expect(items).toContainEqual({ label: "Delete", command: "delete", shortcut: "Delete", pending: STUDIO_WIRE })
    expect(contextShape(items)).toEqual(["item", "separator", "item", "disabled", "separator", "disabled"])
    const locked = contextItems(wire, { allLocked: false, selected: 0, wire: { remove: "R1 is locked", removeCorners: "R1 is locked" } })
    expect(locked.find((e) => e !== "separator" && e.label === "Delete")).toMatchObject({ pending: "R1 is locked" })
  })

  test("every command item has someone to run it", () => {
    for (const target of [part, wire, { kind: "canvas" }] as const) {
      for (const locked of [false, true]) {
        for (const entry of contextItems(target, { allLocked: locked, selected: 3, wire: FREE_WIRE })) {
          if (entry !== "separator" && entry.command) expect(commandOwner(entry.command)).toBeDefined()
        }
      }
    }
  })

  test("the shape marks separators", () => {
    expect(contextShape(contextItems(part, { allLocked: false, selected: 1 }))).toEqual(["item", "separator", "item", "item", "item", "separator", "item"])
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
  test("a wire is selected alone, and the parts go", () => {
    const current = Selection.none.add(["R1", "R2"])
    const after = contextSelection(current, wire)
    expect(after.wires).toEqual([wire.id])
    expect(after.names).toEqual([])
    expect(contextSelection(after, wire)).toBe(after)
  })
  test("a wire selected with parts or other wires keeps the whole selection, as a selected part does", () => {
    const current = Selection.none.add(["R1"]).addWires([wire.id])
    expect(contextSelection(current, wire)).toBe(current)
  })
  test("empty canvas leaves the selection alone", () => {
    const current = Selection.none.add(["R1"])
    expect(contextSelection(current, { kind: "canvas" })).toBe(current)
  })
  test("a label outside the selection is selected alone; a selected one keeps the whole selection", () => {
    const current = Selection.none.add(["R1"])
    expect(contextSelection(current, { kind: "label", label })).toMatchObject({ names: [], labels: [label.id] })
    const group = current.addLabels([label.id])
    expect(contextSelection(group, { kind: "label", label })).toBe(group)
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
