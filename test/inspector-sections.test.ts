import { describe, expect, test } from "vitest"
import { PLACED_ROW, GROUP_ACTIONS, groupActionEnabled, inspectorSections, boardSections, KIND_LABELS, kindRow, partLockButton, propertiesKind, propertiesView, type InspectorPart } from "../studio/src/inspector-sections.js"

const prop = (literal: string | number) => ({ literal, source: String(literal), editable: true })

const resistor: InspectorPart = {
  tag: "resistor",
  props: { resistance: prop("10k"), footprint: prop("0402"), pcbX: prop(3), pcbY: prop(4), pcbRotation: prop(90) },
}

describe("inspectorSections", () => {
  test("a part's sections come in the order Basic, Footprint, Position, Connections, Notes", () => {
    expect(inspectorSections(resistor, { library: false }).map((s) => s.title)).toEqual(["Basic", "Footprint", "Position", "Connections", "Notes"])
  })

  test("a library part gets a Library section between Connections and Notes", () => {
    expect(inspectorSections(resistor, { library: true }).map((s) => s.title)).toEqual(["Basic", "Footprint", "Position", "Connections", "Library", "Notes"])
  })

  test("Basic holds name, kind and the value props; the footprint has its own section; position props move to Position", () => {
    const [basic, footprint, position] = inspectorSections(resistor, { library: false })
    expect(basic?.rows).toEqual(["name", "kind", "prop:resistance"])
    expect(footprint?.rows).toEqual(["prop:footprint"])
    expect(position?.rows).toEqual(["prop:pcbX", "prop:pcbY", "prop:pcbRotation", "lock"])
  })

  test("usual props the part lacks are offered, the footprint in Footprint, position props never", () => {
    const bare: InspectorPart = { tag: "resistor", props: { pcbX: prop(1) } }
    const [basic, footprint, position] = inspectorSections(bare, { library: false })
    expect(basic?.rows).toEqual(["name", "kind", "suggest:resistance"])
    expect(footprint).toEqual({ title: "Footprint", rows: ["suggest:footprint"] })
    expect(position?.rows).toEqual(["prop:pcbX", "lock"])
  })

  test("a moved name, value or designator shows its offset in Position, not as a value prop", () => {
    const moved: InspectorPart = { tag: "resistor", props: { pcbX: prop(1), schNameAt: { literal: undefined, source: "{{ x: 1, y: 2 }}", editable: true } } }
    const [basic, , position] = inspectorSections(moved, { library: false })
    expect(basic?.rows).toEqual(["name", "kind", "suggest:resistance"])
    expect(position?.rows).toEqual(["prop:pcbX", "textAt:schNameAt", "lock"])
  })

  test("a part with no footprint and none to offer has no Footprint section", () => {
    const header: InspectorPart = { tag: "connector", props: { pinCount: prop(4) } }
    expect(inspectorSections(header, { library: false }).map((s) => s.title)).toEqual(["Basic", "Position", "Connections", "Notes"])
  })

  test("schematic position, side and layer props are positions too", () => {
    const part: InspectorPart = { tag: "diode", props: { layer: prop("bottom"), schY: prop(2), schX: prop(1), side: prop("top") } }
    const position = inspectorSections(part, { library: false }).find((s) => s.title === "Position")
    expect(position?.rows).toEqual(["prop:schX", "prop:schY", "prop:side", "prop:layer", "lock"])
  })

  test("a part with no props still has Position with the lock row", () => {
    const [basic, position] = inspectorSections({ tag: "net", props: {} }, { library: false })
    expect(basic?.rows).toEqual(["name", "kind"])
    expect(position?.rows).toEqual(["lock"])
  })

  test("a part Studio placed in the open view says so first in Position, until it is moved or kept", () => {
    const bare: InspectorPart = { tag: "resistor", props: {} }
    const position = (autoPlaced: boolean) => inspectorSections(bare, { library: false, autoPlaced }).find((s) => s.title === "Position")?.rows
    expect(position(true)).toEqual(["placed", "lock"])
    expect(position(false)).toEqual(["lock"])
    expect(PLACED_ROW).toEqual({ label: "Placement", value: "Placed by Studio" })
  })

  test("Connections, Library and Notes each hold one row", () => {
    const rest = inspectorSections(resistor, { library: true }).slice(3)
    expect(rest.map((s) => s.rows)).toEqual([["connections"], ["library"], ["notes"]])
  })
})

describe("boardSections", () => {
  test("with nothing selected: Build, Notes for the agent", () => {
    expect(boardSections().map((s) => s.title)).toEqual(["Build", "Notes for the agent"])
  })
})

describe("propertiesView", () => {
  const named = (name: string, part: InspectorPart = resistor) => ({ ...part, name })

  test("with nothing selected: the board's sections under Selected objects: 0", () => {
    expect(propertiesView([], { library: false })).toEqual({ header: "Selected objects: 0", sections: boardSections() })
  })

  test("with one part: that part's sections under Selected objects: 1", () => {
    expect(propertiesView([named("R1")], { library: true })).toEqual({ header: "Selected objects: 1", sections: inspectorSections(resistor, { library: true }) })
  })

  test("with three parts: one Selection section listing them in the order they were picked", () => {
    const view = propertiesView([named("R2"), named("C1", { tag: "capacitor", props: {} }), named("R1")], { library: false })
    expect(view).toEqual({ header: "Selected objects: 3", sections: [{ title: "Selection", rows: ["part:R2", "part:C1", "part:R1"] }] })
  })

  test("with parts and wires: the count of both, and the Selection section with the counts by kind before the parts", () => {
    const view = propertiesView([named("R2"), named("R1")], { library: false }, 3)
    expect(view).toEqual({ header: "Selected objects: 5", sections: [{ title: "Selection", rows: ["kind:parts:2", "kind:wires:3", "part:R2", "part:R1"] }] })
    expect(propertiesView([], { library: false }, 2)).toEqual({ header: "Selected objects: 2", sections: [{ title: "Selection", rows: ["kind:wires:2"] }] })
  })

  test("a kind row is read back as its kind and count; other rows are not kind rows", () => {
    expect(kindRow("kind:wires:3")).toEqual({ kind: "wires", count: 3 })
    expect(kindRow("kind:parts:2")).toEqual({ kind: "parts", count: 2 })
    expect(kindRow("part:R1")).toBeUndefined()
    expect(kindRow("kind:labels:1")).toEqual({ kind: "labels", count: 1 })
    expect(kindRow("kind:notes:1")).toBeUndefined()
    expect(KIND_LABELS).toEqual({ parts: "Parts", wires: "Wires", labels: "Net labels and flags", drawings: "Drawings", copper: "Tracks and vias", texts: "Names and values", pours: "Copper pours and holes" })
    expect(kindRow("kind:pours:2")).toEqual({ kind: "pours", count: 2 })
    expect(kindRow("kind:copper:2")).toEqual({ kind: "copper", count: 2 })
    expect(kindRow("kind:drawings:2")).toEqual({ kind: "drawings", count: 2 })
  })

  test("with labels in the mix the header counts them and the section counts each kind present", () => {
    const view = propertiesView([named("R1")], { library: false }, 1, 2)
    expect(view).toEqual({ header: "Selected objects: 4", sections: [{ title: "Selection", rows: ["kind:parts:1", "kind:wires:1", "kind:labels:2", "part:R1"] }] })
    expect(propertiesView([], { library: false }, 0, 3)).toEqual({ header: "Selected objects: 3", sections: [{ title: "Selection", rows: ["kind:labels:3"] }] })
  })

  test("with drawings in the mix the header counts them and the section counts each kind present", () => {
    const view = propertiesView([named("R1")], { library: false }, 0, 0, 2)
    expect(view).toEqual({ header: "Selected objects: 3", sections: [{ title: "Selection", rows: ["kind:parts:1", "kind:drawings:2", "part:R1"] }] })
    expect(propertiesView([], { library: false }, 1, 0, 1)).toEqual({ header: "Selected objects: 2", sections: [{ title: "Selection", rows: ["kind:wires:1", "kind:drawings:1"] }] })
  })

  test("with copper in the mix the header counts it and the section counts tracks and vias together", () => {
    const view = propertiesView([named("R1")], { library: false }, 0, 0, 0, 2)
    expect(view).toEqual({ header: "Selected objects: 3", sections: [{ title: "Selection", rows: ["kind:parts:1", "kind:copper:2", "part:R1"] }] })
  })

  test("several parts get Rotate, Lock, Unlock and Delete, each run as the menu's command", () => {
    expect(GROUP_ACTIONS.map((action) => [action.label, action.command])).toEqual([
      ["Rotate", "rotate"],
      ["Lock", "lock"],
      ["Unlock", "unlock"],
      ["Delete", "delete"],
    ])
  })
})

describe("propertiesKind", () => {
  test("the board with nothing, a part's own with one part, a wire's own with one wire alone, the group otherwise", () => {
    expect(propertiesKind(0, 0)).toBe("board")
    expect(propertiesKind(1, 0)).toBe("part")
    expect(propertiesKind(0, 1)).toBe("wire")
    expect(propertiesKind(2, 0)).toBe("group")
    expect(propertiesKind(1, 1)).toBe("group")
    expect(propertiesKind(0, 2)).toBe("group")
  })

  test("a drawing's own with one drawing alone; with anything else, the group", () => {
    expect(propertiesKind(0, 0, 0, 1)).toBe("drawing")
    expect(propertiesKind(1, 0, 0, 1)).toBe("group")
    expect(propertiesKind(0, 0, 1, 1)).toBe("group")
    expect(propertiesKind(0, 0, 0, 2)).toBe("group")
  })

  test("a track's or via's own with one alone; with anything else, the group", () => {
    expect(propertiesKind(0, 0, 0, 0, 1)).toBe("copper")
    expect(propertiesKind(1, 0, 0, 0, 1)).toBe("group")
    expect(propertiesKind(0, 0, 0, 0, 2)).toBe("group")
  })

  test("a label's own with one label alone; with anything else, the group", () => {
    expect(propertiesKind(0, 0, 1)).toBe("label")
    expect(propertiesKind(1, 0, 1)).toBe("group")
    expect(propertiesKind(0, 1, 1)).toBe("group")
    expect(propertiesKind(0, 0, 2)).toBe("group")
  })
})

describe("groupActionEnabled", () => {
  const parts = [
    { name: "R1", editable: true },
    { name: "R2", editable: true },
    { name: "U1", editable: false },
  ]
  const enabled = (locked: string[], violated: string[] = [], of = parts) =>
    GROUP_ACTIONS.map(({ command }) => [command, groupActionEnabled(command, of, { locked: new Set(locked), violated: new Set(violated) })])

  test("with nothing locked: Rotate, Lock and Delete on, Unlock off", () => {
    expect(enabled([])).toEqual([["rotate", true], ["lock", true], ["unlock", false], ["delete", true]])
  })

  test("with some locked every action has a part to change", () => {
    expect(enabled(["R1"])).toEqual([["rotate", true], ["lock", true], ["unlock", true], ["delete", true]])
  })

  test("with every editable part locked: only Unlock, and Lock while one of them was changed outside the editor", () => {
    expect(enabled(["R1", "R2", "U1"])).toEqual([["rotate", false], ["lock", false], ["unlock", true], ["delete", false]])
    expect(enabled(["R1", "R2", "U1"], ["R2"])).toEqual([["rotate", false], ["lock", true], ["unlock", true], ["delete", false]])
  })

  test("with wires selected Delete is on, while Rotate, Lock and Unlock act on the parts alone", () => {
    const actions = (of: { name: string; editable: boolean }[], wires: number) =>
      GROUP_ACTIONS.map(({ command }) => [command, groupActionEnabled(command, of, { locked: new Set(["R1"]), violated: new Set() }, wires)])
    expect(actions([], 2)).toEqual([["rotate", false], ["lock", false], ["unlock", false], ["delete", true]])
    expect(actions([{ name: "R1", editable: true }], 1)).toEqual([["rotate", false], ["lock", false], ["unlock", true], ["delete", true]])
  })

  test("read-only parts alone cannot be rotated or deleted, but can be locked", () => {
    const readOnly = [{ name: "U1", editable: false }, { name: "U2", editable: false }]
    expect(enabled([], [], readOnly)).toEqual([["rotate", false], ["lock", true], ["unlock", false], ["delete", false]])
  })
})

describe("partLockButton", () => {
  const locks = (locked: string[], violated: string[] = []) => ({ locked: new Set(locked), violated: new Set(violated) })

  test("an unlocked part offers Lock; a locked one shows Locked and runs Unlock", () => {
    expect(partLockButton("R1", locks([]))).toMatchObject({ command: "lock", label: "Lock", pressed: false })
    expect(partLockButton("R1", locks(["R1"]))).toMatchObject({ command: "unlock", label: "Locked", pressed: true })
  })

  test("a locked part changed outside the editor offers Lock again, which accepts the change", () => {
    expect(partLockButton("R1", locks(["R1"], ["R1"]))).toMatchObject({ command: "lock", label: "Lock again", pressed: true })
  })

  test("the command it runs is one the group's buttons would enable for that part", () => {
    for (const state of [locks([]), locks(["R1"]), locks(["R1"], ["R1"])]) {
      expect(groupActionEnabled(partLockButton("R1", state).command, [{ name: "R1", editable: true }], state)).toBe(true)
    }
  })
})

describe("names and values in Properties", () => {
  test("one alone has its own view; with others it is counted in the Selection section", () => {
    expect(propertiesKind(0, 0, 0, 0, 0, 1)).toBe("text")
    expect(propertiesKind(1, 0, 0, 0, 0, 1)).toBe("group")
    const view = propertiesView([{ name: "R1", ...resistor }], { library: false }, 0, 0, 0, 0, 2)
    expect(view.header).toBe("Selected objects: 3")
    expect(view.sections[0]?.rows).toEqual(["kind:parts:1", "kind:texts:2", "part:R1"])
    expect(kindRow("kind:texts:2")).toEqual({ kind: "texts", count: 2 })
    expect(KIND_LABELS.texts).toBe("Names and values")
  })
})
