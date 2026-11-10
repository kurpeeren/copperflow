import { describe, expect, test } from "vitest"
import type { PlanDesign } from "../src/engine/fillet-plan.js"
import type { Net, Point } from "../src/engine/model.js"
import type { PcbTrack, PlacedFootprint } from "../src/engine/pcb.js"
import { loadRules } from "../src/engine/rules/load.js"
import { shapeChange, shapeScope, straightenTrack } from "../studio/src/pcb/fillet.js"
import { contextItems } from "../studio/src/shell/context-menu.js"
import { keyAction, type KeyInput } from "../studio/src/pcb/canvas-keys.js"
import { COMMAND_KEY_ACTIONS, MENUS, menuItems, shortcutList } from "../studio/src/shell/menus.js"
import { commandOwner, COPPER_COMMANDS } from "../studio/src/shell/command-owners.js"

const pt = (x: number, y: number): Point => ({ x, y })
const NETS: Net[] = [{ id: "net.A", names: ["VBUS"], pins: [] }]
const track = (id: string, points: Point[], overrides: Partial<PcbTrack> = {}): PcbTrack => ({ id, net: "net.A", layer: "top", width: 0.25, points, locked: false, by: "human", pads: [], ...overrides })
const L = track("t0001", [pt(0, 0), pt(10, 0), pt(10, 10)])
const Z = track("t0002", [pt(-20, -20), pt(-10, -20), pt(-10, -10), pt(0, -10)])

function designOf(tracks: PcbTrack[]): PlanDesign {
  const part: PlacedFootprint = { component: "U1", x: 0, y: 0, rotation: 0, side: "top", autoPlaced: false, pads: [], courtyard: [], silkscreen: [], fabrication: [] }
  return { circuit: { nets: NETS }, pcb: { parts: [part], tracks, vias: [], ratsnest: [] }, rules: loadRules({}).rules }
}

const press = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({ key, code: `Key${key.toUpperCase()}`, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, typing: false, ...extra })

describe("shapeScope", () => {
  test("acts on the selected tracks, leaving vias and parts out", () => {
    expect(shapeScope("filletTracks", [L, Z], { copper: ["t0002", "v0001"], total: 3 })).toEqual({ ids: ["t0002"] })
  })

  test("with nothing selected, every track of the board after a confirm that names the count", () => {
    expect(shapeScope("filletTracks", [L, Z], { copper: [], total: 0 })).toEqual({ confirm: "Fillet all 2 tracks of the board?" })
    expect(shapeScope("straightenTracks", [L], { copper: [], total: 0 })).toEqual({ confirm: "Straighten the board's one track?" })
  })

  test("says why when the selection holds no track, or the board has none", () => {
    expect(shapeScope("filletTracks", [L], { copper: ["v0001"], total: 1 })).toEqual({ message: "Select tracks to fillet, or nothing for every track of the board." })
    expect(shapeScope("straightenTracks", [], { copper: [], total: 0 })).toEqual({ message: "The board has no tracks." })
  })
})

describe("shapeChange", () => {
  test("fillet sends one change of setTrack edits, with the summary and the shapes to draw meanwhile", () => {
    const change = shapeChange("filletTracks", designOf([L, Z]), undefined, new Set())
    if ("message" in change) throw new Error(change.message)
    expect(change.summary).toBe("Rounded 3 corners on 2 tracks")
    expect(change.edits.map((edit) => [edit.kind, "id" in edit ? edit.id : ""])).toEqual([["setTrack", "t0001"], ["setTrack", "t0002"]])
    expect(change.shapes.tracks.get("t0001")).toEqual(change.edits[0] && "points" in change.edits[0] ? change.edits[0].points : undefined)
    expect(straightenTrack(change.shapes.tracks.get("t0001") ?? []).points).toEqual(L.points)
  })

  test("straighten puts the corners back on the tracks named", () => {
    const rounded = shapeChange("filletTracks", designOf([L]), ["t0001"], new Set())
    if ("message" in rounded) throw new Error(rounded.message)
    const back = shapeChange("straightenTracks", designOf([{ ...L, points: [...(rounded.shapes.tracks.get("t0001") ?? [])] }]), ["t0001"], new Set())
    if ("message" in back) throw new Error(back.message)
    expect(back.summary).toBe("Straightened 1 corner on 1 track")
    expect(back.edits).toEqual([{ kind: "setTrack", id: "t0001", points: L.points }])
  })

  test("tells the summary when nothing changes, naming locked tracks", () => {
    expect(shapeChange("straightenTracks", designOf([L]), undefined, new Set())).toEqual({ message: "No rounded corners to straighten" })
    expect(shapeChange("filletTracks", designOf([{ ...L, locked: true }]), ["t0001"], new Set())).toEqual({ message: "No tracks to round; t0001 is locked" })
  })
})

describe("the menus, the keys and the context menu", () => {
  test("Edit holds Fillet tracks (U) and Straighten tracks (Shift+U), after a separator", () => {
    const edit = MENUS.find((menu) => menu.title === "Edit")?.entries ?? []
    expect(edit.slice(-3)).toEqual(["separator", { label: "Fillet tracks", command: "filletTracks", shortcut: "U" }, { label: "Straighten tracks", command: "straightenTracks", shortcut: "Shift+U" }])
    expect(COMMAND_KEY_ACTIONS.filletTracks).toBe("filletTracks")
    expect(COMMAND_KEY_ACTIONS.straightenTracks).toBe("straightenTracks")
  })

  test("U and Shift+U are free keys, the PCB's only, and Help → Keys lists them", () => {
    const others = shortcutList().filter((row) => !/tracks$/.test(row.label)).map((row) => row.keys.split(" ")[0])
    expect(others.filter((keys) => keys === "U" || keys === "Shift+U")).toEqual([])
    expect(MENUS.flatMap(menuItems).filter((item) => item.shortcut === "U" || item.shortcut === "Shift+U").map((item) => item.label)).toEqual(["Fillet tracks", "Straighten tracks"])
    expect(keyAction(press("u"), { view: "pcb" })?.action).toBe("filletTracks")
    expect(keyAction(press("U", { shiftKey: true }), { view: "pcb" })?.action).toBe("straightenTracks")
    expect(keyAction(press("u"), { view: "schematic" })).toBeNull()
    expect(keyAction(press("u", { typing: true }), { view: "pcb" })).toBeNull()
    expect(shortcutList()).toContainEqual({ keys: "U", label: "Fillet tracks" })
    expect(shortcutList()).toContainEqual({ keys: "Shift+U", label: "Straighten tracks" })
  })

  test("both are the PCB's commands", () => {
    expect(COPPER_COMMANDS).toEqual(["filletTracks", "straightenTracks"])
    expect(COPPER_COMMANDS.map(commandOwner)).toEqual(["pcb", "pcb"])
  })

  test("a track's context menu offers both; a via's does not", () => {
    const labels = (id: string) => contextItems({ kind: "copper", id }, { allLocked: false, selected: 0 }).flatMap((entry) => (entry === "separator" ? [] : [entry.label]))
    expect(labels("t0001")).toEqual(["Properties", "Fillet tracks", "Straighten tracks", "Lock", "Delete"])
    expect(labels("v0001")).toEqual(["Properties", "Lock", "Delete"])
  })
})
