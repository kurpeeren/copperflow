import { describe, expect, test } from "vitest"
import type { CircuitModel } from "../src/core/types.js"
import { DEFAULT_LAYERS, pourRows, togglePour } from "../studio/src/pcb/layers.js"
import { commandOwner } from "../studio/src/shell/command-owners.js"
import { MENUS, menuItems } from "../studio/src/shell/menus.js"
import { canPick } from "../studio/src/pcb/pick.js"
import { ALL_PICKABLE, pickKindRows } from "../studio/src/pcb/pick-filter.js"
import { pcbPress } from "../studio/src/pcb/press-order.js"
import { Selection } from "../studio/src/selection.js"
import { boardItemCentre, holeAt, holeLabel, pourCornerAt, pourEdgeAt, pourFillAt, pourLabel, type PourDesign } from "../studio/src/pcb/pour-hit.js"
import { boardFieldEdit as fieldEdit, boardProperties } from "../studio/src/pcb/pour-props.js"
import { boardRemoval, defaultPourNet, holeDiameter, holeEdit, idlePourTool, pourCornerEdit, pourEdit, pourPreview, pourToolStep, type PourToolState } from "../studio/src/pcb/pour-tool.js"
import { loadPourFill, POUR_FILL_KEY, pourFillToggles, savePourFill } from "../studio/src/pcb/pour-view.js"

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
]

const SOURCE = { file: "a.tsx", line: 1, column: 1, offset: 0 }
const base = { priority: 0, minWidth: 0.25, thermal: "relief" as const, thermalWidth: 0.3, thermalGap: 0.25, source: SOURCE }

/** A 30 × 20 board with a whole-board GND pour on the bottom, a drawn VCC pour on top and a hole. */
const DESIGN = {
  circuit: {
    nets: [
      { id: "net:1", names: ["VCC"] },
      { id: "net:2", names: ["GND"] },
    ],
  },
  pcb: {
    board: {
      outline: square(0, 0, 30).map((p) => ({ x: p.x, y: Math.min(p.y, 20) })),
      layers: 2,
      thickness: 1.6,
      keepouts: [],
      pours: [
        { id: "copperpour:1", net: "net:2", layer: "bottom", ...base },
        { id: "copperpour:2", net: "net:1", layer: "top", outline: square(5, 5, 10), ...base, priority: 1, clearance: 0.3 },
      ],
    },
    pours: [
      { id: "copperpour:1", net: "net:2", layer: "bottom", polygons: [{ outer: square(0.5, 0.5, 19), holes: [square(2, 2, 2)] }], area: 357 },
      { id: "copperpour:2", net: "net:1", layer: "top", polygons: [{ outer: square(5, 5, 10), holes: [] }], area: 100 },
    ],
    holes: [{ id: "hole:1", x: 25, y: 15, diameter: 3.2, source: SOURCE }],
  },
} as unknown as PourDesign

const none = new Set<string>()
const SCALE = 10 // CSS pixels per mm: 6 px of reach is 0.6 mm

describe("what lies under the pointer", () => {
  test("a pour is picked on its outline, the drawn one or the board's for a whole-board pour, not inside its fill", () => {
    expect(pourEdgeAt(DESIGN, { x: 10, y: 5.2 }, SCALE, DEFAULT_LAYERS, none)).toBe("copperpour:2")
    expect(pourEdgeAt(DESIGN, { x: 10, y: 10 }, SCALE, DEFAULT_LAYERS, none)).toBeUndefined()
    expect(pourEdgeAt(DESIGN, { x: 0.1, y: 10 }, SCALE, DEFAULT_LAYERS, none)).toBe("copperpour:1")
  })

  test("a hidden layer or a pour hidden in the Layer panel is not picked", () => {
    expect(pourEdgeAt(DESIGN, { x: 10, y: 5 }, SCALE, { ...DEFAULT_LAYERS, top: false }, none)).toBeUndefined()
    expect(pourEdgeAt(DESIGN, { x: 10, y: 5 }, SCALE, DEFAULT_LAYERS, new Set(["copperpour:2"]))).toBeUndefined()
  })

  test("a corner is found within reach; a hole inside its disc; the fill under the pointer for the label", () => {
    expect(pourCornerAt(square(5, 5, 10), { x: 15.3, y: 5.2 }, SCALE)).toBe(1)
    expect(pourCornerAt(square(5, 5, 10), { x: 10, y: 5 }, SCALE)).toBeUndefined()
    expect(holeAt(DESIGN.pcb.holes, { x: 26, y: 15 }, SCALE, DEFAULT_LAYERS)).toBe("hole:1")
    expect(holeAt(DESIGN.pcb.holes, { x: 26, y: 15 }, SCALE, { ...DEFAULT_LAYERS, hole: false })).toBeUndefined()
    expect(pourFillAt(DESIGN, { x: 10, y: 10 }, DEFAULT_LAYERS, none, "top")).toBe("copperpour:2")
    expect(pourFillAt(DESIGN, { x: 10, y: 10 }, DEFAULT_LAYERS, none, "bottom")).toBe("copperpour:1")
    expect(pourFillAt(DESIGN, { x: 3, y: 3 }, DEFAULT_LAYERS, none, "bottom")).toBeUndefined()
  })

  test("the labels name the net and layer, and the hole's diameter", () => {
    expect(pourLabel(DESIGN, { net: "net:2", layer: "bottom" })).toBe("pour GND · bottom")
    expect(holeLabel({ diameter: 3.2 })).toBe("hole 3.2 mm")
  })

  test("a check about a pour or hole is ringed at its outline's middle or the hole's centre", () => {
    expect(boardItemCentre(DESIGN, "copperpour:2")).toEqual({ x: 10, y: 10 })
    expect(boardItemCentre(DESIGN, "hole:1")).toEqual({ x: 25, y: 15 })
    expect(boardItemCentre(DESIGN, "copperpour:9")).toBeUndefined()
  })
})

describe("the copper pour and hole tools", () => {
  const press = (state: PourToolState, x: number, y: number, double = false) => pourToolStep(state, { type: "press", at: { x, y }, double })

  test("corners are clicked and Enter closes the pour", () => {
    let state = idlePourTool("pour")
    for (const [x, y] of [
      [0, 0],
      [4, 0],
      [4, 3],
    ] as const) {
      const step = press(state, x, y)
      expect(step.outline).toBeUndefined()
      state = step.state as PourToolState
    }
    expect(pourPreview(state, { x: 0, y: 3 })).toHaveLength(4)
    const closed = pourToolStep(state, { type: "finish" })
    expect(closed.outline).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
    ])
    expect(closed.state).toEqual(idlePourTool("pour"))
  })

  test("a double click or a click on the first corner closes it; two corners or a straight line wait for more", () => {
    let state = idlePourTool("pour")
    state = press(state, 0, 0).state as PourToolState
    state = press(state, 4, 0).state as PourToolState
    expect(pourToolStep(state, { type: "finish" }).outline).toBeUndefined()
    expect(press(state, 8, 0, true).outline).toBeUndefined()
    state = press(state, 4, 3).state as PourToolState
    expect(press(state, 4, 3, true).outline).toHaveLength(3)
    expect(press(state, 0, 0).outline).toHaveLength(3)
  })

  test("Backspace removes a corner and Esc cancels, then puts the tool away", () => {
    const state = press(press(idlePourTool("pour"), 0, 0).state as PourToolState, 1, 0).state as PourToolState
    expect(pourToolStep(state, { type: "removeCorner" }).state?.points).toHaveLength(1)
    expect(pourToolStep(state, { type: "cancel" }).state).toEqual(idlePourTool("pour"))
    expect(pourToolStep(idlePourTool("pour"), { type: "cancel" }).state).toBeNull()
  })

  test("the hole tool places a hole on each click and stays armed", () => {
    const step = press(idlePourTool("hole"), 3, 4)
    expect(step.hole).toEqual({ x: 3, y: 4 })
    expect(step.state?.tool).toBe("hole")
    expect(holeEdit({ x: 3, y: 4 }, 3.2)).toEqual({ kind: "addHole", x: 3, y: 4, diameter: 3.2 })
    expect(holeDiameter("2.5 mm")).toBe(2.5)
    expect(holeDiameter("0")).toHaveProperty("message")
    expect(holeDiameter("abc")).toHaveProperty("message")
  })

  test("a new pour is of GND when the circuit has it, on the active layer; whole board without an outline", () => {
    expect(defaultPourNet(DESIGN)).toBe("GND")
    expect(defaultPourNet({ circuit: { nets: [{ id: "n", names: ["VBUS"] }] } } as unknown as PourDesign)).toBe("VBUS")
    expect(pourEdit("GND", "bottom")).toEqual({ kind: "addPour", net: "GND", layer: "bottom" })
    expect(pourEdit("GND", "top", square(0, 0, 1))).toEqual({ kind: "addPour", net: "GND", layer: "top", outline: square(0, 0, 1) })
  })

  test("a dragged corner writes the outline with that corner moved", () => {
    const change = pourCornerEdit("copperpour:2", square(5, 5, 10), 2, { x: 18, y: 16 })
    expect(change).toMatchObject({ edit: { kind: "setPour", id: "copperpour:2", props: { outline: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 18, y: 16 }, { x: 5, y: 15 }] } } })
  })

  test("a corner dragged onto another, onto the line of the rest, or across an edge writes nothing and says why", () => {
    const triangle = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }]
    expect(pourCornerEdit("copperpour:1", triangle, 2, { x: 4, y: 0 })).toEqual({ message: "Not moved: the outline would not be a simple polygon (two corners in a row are at the same place)" })
    expect(pourCornerEdit("copperpour:1", triangle, 2, { x: 8, y: 0 })).toHaveProperty("message", expect.stringContaining("one line"))
    expect(pourCornerEdit("copperpour:1", square(0, 0, 4), 2, { x: 4, y: -2 })).toHaveProperty("message", expect.stringContaining("cross"))
  })

  test("the pour tool refuses to close an outline whose edges cross, keeping its corners", () => {
    let state: PourToolState = idlePourTool("pour")
    for (const [x, y] of [[0, 0], [4, 4], [4, 0], [0, 4]] as const) state = press(state, x, y).state as PourToolState
    const step = pourToolStep(state, { type: "finish" })
    expect(step.outline).toBeUndefined()
    expect(step.refused).toBe("Not closed: two of its edges cross")
    expect(step.state?.points).toHaveLength(4)
  })

  test("Delete removes the later ids first, and names the locked and read-only ones", () => {
    const item = (id: string, editable = true) => ({ id, tag: id.startsWith("hole") ? "hole" : "copperpour", props: {}, line: 1, editable, ...(editable ? {} : { readonlyReason: "spread" }), start: 0, end: 0 })
    const model = { boardItems: [item("copperpour:1"), item("copperpour:2"), item("hole:1"), item("hole:2", false)] } as unknown as CircuitModel
    const removal = boardRemoval(model, new Set(["hole:1"]))(["copperpour:1", "copperpour:2", "hole:1", "hole:2"])
    expect(removal.edits).toEqual([
      { kind: "removePour", id: "copperpour:2" },
      { kind: "removePour", id: "copperpour:1" },
    ])
    expect(removal.removed).toEqual(["copperpour:1", "copperpour:2"])
    expect(removal.skipped).toEqual(["hole:1 is locked", "hole:2 is read-only (spread)"])
  })
})

describe("Properties of a pour and a hole", () => {
  test("a pour shows net, layer, priority, clearance, min width, thermal, outline and fill area", () => {
    const shown = boardProperties(DESIGN, "copperpour:2")
    expect(shown?.title).toBe("Copper pour")
    expect(shown?.rows.map((row) => [row.label, row.value])).toEqual([
      ["Net", "VCC"],
      ["Layer", "top"],
      ["Priority", "1"],
      ["Clearance (mm)", "0.3"],
      ["Min width (mm)", "0.25"],
      ["Thermal", "relief"],
      ["Outline", "4 corners"],
      ["Fill area", "100.00 mm²"],
    ])
    expect(boardProperties(DESIGN, "copperpour:1")?.rows.find((row) => row.label === "Outline")?.value).toBe("Whole board")
    expect(boardProperties(DESIGN, "copperpour:1")?.rows.find((row) => row.label === "Clearance (mm)")?.value).toBe("")
  })

  test("a hole shows its position and diameter", () => {
    expect(boardProperties(DESIGN, "hole:1")?.rows.map((row) => row.value)).toEqual(["25", "15", "3.2"])
  })

  test("each changed row is one edit; an unchanged one none; a bad value a message", () => {
    const boardFieldEdit = (...args: Parameters<typeof fieldEdit>) => fieldEdit(...args) as { edit: unknown } | undefined
    expect(boardFieldEdit(DESIGN, "copperpour:2", "net", "GND")?.edit).toEqual({ kind: "setPour", id: "copperpour:2", props: { net: "GND" } })
    expect(boardFieldEdit(DESIGN, "copperpour:2", "priority", "3")?.edit).toEqual({ kind: "setPour", id: "copperpour:2", props: { priority: 3 } })
    expect(boardFieldEdit(DESIGN, "copperpour:2", "clearance", "")?.edit).toEqual({ kind: "setPour", id: "copperpour:2", props: { clearance: null } })
    expect(boardFieldEdit(DESIGN, "copperpour:2", "thermal", "solid")?.edit).toEqual({ kind: "setPour", id: "copperpour:2", props: { thermal: "solid" } })
    expect(boardFieldEdit(DESIGN, "copperpour:2", "priority", "1")).toBeUndefined()
    expect(boardFieldEdit(DESIGN, "copperpour:2", "priority", "1.5")).toHaveProperty("message")
    expect(boardFieldEdit(DESIGN, "copperpour:2", "minWidth", "-1")).toHaveProperty("message")
    expect(boardFieldEdit(DESIGN, "hole:1", "diameter", "2")?.edit).toEqual({ kind: "setHole", id: "hole:1", props: { diameter: 2 } })
    expect(boardFieldEdit(DESIGN, "hole:1", "x", "-3")?.edit).toEqual({ kind: "setHole", id: "hole:1", props: { x: -3 } })
  })
})

describe("View → Pour fill", () => {
  const memory = () => {
    const kept = new Map<string, string>()
    return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value) }
  }

  test("solid until another is chosen, then remembered; one menu item checked", () => {
    const store = memory()
    expect(loadPourFill(() => store)).toBe("solid")
    expect(savePourFill(() => store, "hatched")).toBe(true)
    expect(store.getItem(POUR_FILL_KEY)).toBe("hatched")
    expect(loadPourFill(() => store)).toBe("hatched")
    expect(pourFillToggles("outline")).toEqual({ pourSolid: false, pourHatched: false, pourOutline: true })
  })

  test("an unknown stored value or a blocked storage reads as solid", () => {
    const store = memory()
    store.setItem(POUR_FILL_KEY, "plaid")
    expect(loadPourFill(() => store)).toBe("solid")
    expect(
      loadPourFill(() => {
        throw new Error("blocked")
      }),
    ).toBe("solid")
    expect(savePourFill(() => undefined, "solid")).toBe(false)
  })
})

describe("pours and holes in the selection and the Filter tab", () => {
  test("a pour or hole is selected alone, toggled with others, and counted", () => {
    const one = Selection.none.onlyBoard("copperpour:1")
    expect(one.soleBoard).toBe("copperpour:1")
    expect(one.total).toBe(1)
    const two = one.toggleBoard("hole:1").toggle("R1")
    expect(two.board).toEqual(["copperpour:1", "hole:1"])
    expect(two.total).toBe(3)
    expect(two.soleBoard).toBeUndefined()
    expect(two.withoutBoard(["copperpour:1"]).board).toEqual(["hole:1"])
    expect(two.keepBoard(["hole:1"]).board).toEqual(["hole:1"])
    expect(one.toggleBoard("copperpour:1")).toBe(Selection.none)
  })

  test("the Filter tab's Copper pours and holes row stops both being picked, on the PCB only", () => {
    const context = { selection: Selection.none, armed: null, filter: { ...ALL_PICKABLE, pours: false } }
    expect(canPick({ kind: "pour", id: "copperpour:1" }, context)).toBe(false)
    expect(canPick({ kind: "hole", id: "hole:1" }, context)).toBe(false)
    expect(canPick({ kind: "pour", id: "copperpour:1" }, { ...context, filter: ALL_PICKABLE })).toBe(true)
    expect(pickKindRows("pcb").map((row) => row.kind)).toContain("pours")
    expect(pickKindRows("schematic").map((row) => row.kind)).not.toContain("pours")
  })
})

describe("the menus and the Layer panel", () => {
  test("Place has Copper pour, its whole-board form and Hole, run by the PCB; View has the three Pour fill items, checked by the setting", () => {
    const place = menuItems(MENUS.find((menu) => menu.title === "Place") as never)
    expect(place.filter((item) => ["placePour", "placePourBoard", "placeHole"].includes(item.command ?? "")).map((item) => item.label)).toEqual(["Copper pour", "Copper pour: Whole board", "Hole"])
    for (const command of ["placePour", "placePourBoard", "placeHole"] as const) expect(commandOwner(command)).toBe("pcb")
    const view = menuItems(MENUS.find((menu) => menu.title === "View") as never)
    expect(view.filter((item) => item.command?.startsWith("pour")).map((item) => [item.label, item.toggle])).toEqual([
      ["Pour fill: Solid", "pourSolid"],
      ["Pour fill: Hatched", "pourHatched"],
      ["Pour fill: Outline only", "pourOutline"],
    ])
    for (const command of ["pourSolid", "pourHatched", "pourOutline"] as const) expect(commandOwner(command)).toBe("app")
  })

  test("the Layer panel lists the pours under their layer, top first, each with its eye", () => {
    const pours = [
      { id: "copperpour:1", net: "net:2", layer: "bottom" },
      { id: "copperpour:2", net: "net:1", layer: "top" },
      { id: "copperpour:3", net: "net:2", layer: "top" },
    ]
    const hidden = togglePour(new Set(), "copperpour:3")
    expect(pourRows(pours, (net) => (net === "net:2" ? "GND" : "VCC"), hidden)).toEqual([
      {
        layer: "top",
        name: "Top Layer",
        pours: [
          { id: "copperpour:2", net: "VCC", layer: "top", shown: true },
          { id: "copperpour:3", net: "GND", layer: "top", shown: false },
        ],
      },
      { layer: "bottom", name: "Bottom Layer", pours: [{ id: "copperpour:1", net: "GND", layer: "bottom", shown: true }] },
    ])
    expect(togglePour(hidden, "copperpour:3").size).toBe(0)
  })
})

describe("the order a press on the PCB is offered", () => {
  const PRESS = { button: 0, shiftKey: false, ctrlKey: false, metaKey: false }
  function takers(took: Partial<Record<"pourTool" | "route" | "pourCorner" | "copper" | "pour", boolean>>, text = false) {
    const asked: string[] = []
    const taker = (name: keyof typeof took) => () => {
      asked.push(name)
      return took[name] === true
    }
    return { asked, press: pcbPress({ pourTool: taker("pourTool"), route: taker("route"), pourCorner: taker("pourCorner"), text: () => text, copper: taker("copper"), pour: taker("pour") }) }
  }

  test("a track or via under a pour's outline takes the press first; the pour only when no copper does", () => {
    const both = takers({ copper: true, pour: true })
    expect(both.press(PRESS, { x: 0, y: 0 })).toBe(true)
    expect(both.asked).toEqual(["pourTool", "route", "pourCorner", "copper"])
    const pourOnly = takers({ pour: true })
    expect(pourOnly.press(PRESS, { x: 0, y: 0 })).toBe(true)
    expect(pourOnly.asked.at(-1)).toBe("pour")
  })

  test("an armed pour tool takes every press; a designator keeps the copper and pours under it from taking one", () => {
    const tool = takers({ pourTool: true, copper: true })
    tool.press(PRESS, { x: 0, y: 0 })
    expect(tool.asked).toEqual(["pourTool"])
    const text = takers({ copper: true, pour: true }, true)
    expect(text.press(PRESS, { x: 0, y: 0 })).toBe(false)
    expect(text.asked).toEqual(["pourTool", "route", "pourCorner"])
  })
})
